import type { SupabaseClient } from '@supabase/supabase-js';
import type { FilmDnaNode, FilmDnaTree } from '../types/filmDna';

/** 片库条目：用于按标题/年份/imdbId 回填 Film DNA 节点海报。 */
export type FilmDnaLibraryMovie = {
  id: string;
  title: string;
  year: number;
  posterUrl: string;
  /** 存在时表示该片使用用户上传海报（Storage 路径），优先级高于 TMDB/节点自带海报。 */
  posterStoragePath?: string;
};

const POSTER_FIELD_KEYS = ['posterUrl', 'poster_url', 'poster', 'imageUrl'] as const;

type SearchMoviesHit = {
  title?: string;
  year?: number | null;
  posterUrl?: string | null;
  imdbId?: string | null;
};

/**
 * 规范化标题用于片库匹配（与 App `normalizeTitleForIdentity` 一致）。
 *
 * @param title 原始片名
 */
export function normalizeFilmTitleKey(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从原始对象读取海报 URL（合并常见别名字段）。
 *
 * @param raw 节点或 API 原始对象
 */
export function resolvePosterUrlFromRaw(
  raw: FilmDnaNode | Record<string, unknown>,
): string {
  const o = raw as Record<string, unknown>;
  for (const key of POSTER_FIELD_KEYS) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * 将别名字段合并为规范的 `posterUrl`。
 *
 * @param node Film DNA 节点
 */
export function withNormalizedPosterUrl(node: FilmDnaNode): FilmDnaNode {
  const posterUrl = resolvePosterUrlFromRaw(node);
  if (!posterUrl) return node;
  return { ...node, posterUrl };
}

export type LibraryPosterLookup = {
  /** titleKey|year → posterUrl; only contains movies with year > 0. */
  byIdentity: Map<string, string>;
  /** titleKey → posterUrl; contains ALL movies including year=0.
   *  Used as fallback when byIdentity has no entry for the title. */
  byTitle: Map<string, string>;
  /** Title keys whose entries in byTitle or uploadOnly (title-only) resolve to different
   *  poster URLs across library movies — title-only fallback is suppressed for these. */
  ambiguousTitles: Set<string>;
  byImdbId: Map<string, string>;
  /** Uploaded/custom posters only (posterStoragePath present), same key scheme as byIdentity.
   *  Keyed by titleKey|year for year > 0, or titleKey alone for year = 0. */
  uploadOnly: Map<string, string>;
};

/**
 * 由当前片库构建海报查找表（标题+年份、仅标题、imdb `tt…` id）。
 *
 * `byTitle` covers movies whose `year` is 0 or unknown so they are not silently
 * dropped from the lookup when Film DNA nodes carry a known year.
 *
 * @param movies 片库影片列表
 */
export function buildLibraryPosterLookup(
  movies: FilmDnaLibraryMovie[],
): LibraryPosterLookup {
  const byIdentity = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const ambiguousTitles = new Set<string>();
  const byImdbId = new Map<string, string>();
  const uploadOnly = new Map<string, string>();

  for (const movie of movies) {
    const url = movie.posterUrl?.trim();
    if (!url || !url.startsWith('http')) continue;

    const titleKey = normalizeFilmTitleKey(movie.title);
    if (!titleKey) continue;

    // Always index by title alone — covers year=0 / pending-metadata movies.
    // Track conflicting URLs so the title-only fallback can be suppressed for ambiguous titles.
    const existingTitle = byTitle.get(titleKey);
    if (existingTitle !== undefined && existingTitle !== url) {
      ambiguousTitles.add(titleKey);
    }
    byTitle.set(titleKey, url);

    if (Number.isFinite(movie.year) && movie.year > 0) {
      byIdentity.set(`${titleKey}|${movie.year}`, url);
      if (movie.posterStoragePath) {
        uploadOnly.set(`${titleKey}|${movie.year}`, url);
      }
    } else if (movie.posterStoragePath) {
      // year=0 uploaded poster: index by title-only so priority-1 check can find it.
      // Track conflicts the same way as byTitle to stay consistent.
      const existingUpload = uploadOnly.get(titleKey);
      if (existingUpload !== undefined && existingUpload !== url) {
        ambiguousTitles.add(titleKey);
      }
      uploadOnly.set(titleKey, url);
    }

    const imdb = movie.id.trim().toLowerCase();
    if (/^tt\d+$/.test(imdb)) {
      byImdbId.set(imdb, url);
    }
  }

  return { byIdentity, byTitle, ambiguousTitles, byImdbId, uploadOnly };
}

/**
 * 在片库中按标题/年份查找海报 URL。
 *
 * Lookup order:
 * 1. Exact normalizedTitle|year match (when node has a known year).
 * 2. Prefix scan of byIdentity for any year>0 entry with the same title.
 * 3. byTitle title-only match — handles library movies whose year is 0 or unknown.
 *
 * @param node 关系节点
 * @param lookup 片库查找表
 */
function lookupLibraryPosterUrl(
  node: FilmDnaNode,
  lookup: LibraryPosterLookup,
): string | undefined {
  const titleKey = normalizeFilmTitleKey(node.title);
  if (!titleKey) return undefined;

  // Step 1: exact title+year match.
  if (typeof node.year === 'number' && node.year > 0) {
    const exact = lookup.byIdentity.get(`${titleKey}|${node.year}`);
    if (exact) return exact;
  }

  // Step 2: prefix scan — handles node.year=null and covers year>0 library entries
  // when the node year differs (e.g. regional release year offset).
  // Returns undefined if two distinct URLs map to the same title (ambiguous).
  let prefixMatch: string | undefined;
  for (const [key, url] of lookup.byIdentity) {
    if (!key.startsWith(`${titleKey}|`)) continue;
    if (prefixMatch && prefixMatch !== url) return undefined;
    prefixMatch = url;
  }
  if (prefixMatch) return prefixMatch;

  // Step 3: title-only fallback — only reached when byIdentity has no entry for
  // this title at all, meaning the library movie has year=0 (pending metadata).
  // Suppressed for titles with conflicting URLs across library movies.
  if (lookup.ambiguousTitles.has(titleKey)) return undefined;
  return lookup.byTitle.get(titleKey);
}

/**
 * 为单节点写入 `posterUrl`（字段归一化 → 片库 → 保持原样）。
 *
 * @param node 原始节点
 * @param lookup 可选片库查找表
 */
function hydrateFilmDnaNode(
  node: FilmDnaNode,
  lookup?: LibraryPosterLookup,
): FilmDnaNode {
  const normalized = withNormalizedPosterUrl(node);

  // Priority 1: user-uploaded poster from library (overrides TMDB/node posterUrl).
  if (lookup?.uploadOnly.size) {
    const titleKey = normalizeFilmTitleKey(normalized.title);
    if (titleKey) {
      // Prefer exact title+year key; fall back to title-only key for year=0 library movies.
      // Title-only upload fallback is suppressed for ambiguous titles.
      const titleOnlyUpload = lookup.ambiguousTitles.has(titleKey)
        ? undefined
        : lookup.uploadOnly.get(titleKey);
      const uploadedKey =
        typeof normalized.year === 'number' && normalized.year > 0
          ? lookup.uploadOnly.get(`${titleKey}|${normalized.year}`) ?? titleOnlyUpload
          : titleOnlyUpload;
      if (uploadedKey) return { ...normalized, posterUrl: uploadedKey };
    }
  }

  // Priority 2: stored library posterUrl (non-uploaded) — preferred over node's backend poster
  // so library data is consistent with what the user sees elsewhere in the app.
  if (lookup) {
    const fromLibrary = lookupLibraryPosterUrl(normalized, lookup);
    if (fromLibrary) return { ...normalized, posterUrl: fromLibrary };
  }

  // Priority 3: node's own posterUrl (TMDB/backend) — used for non-library nodes.
  if (normalized.posterUrl?.trim()) return normalized;

  return normalized;
}

/**
 * 归一化整棵树各槽位的海报字段（不写片库/TMDb）。
 *
 * @param tree Film DNA 树
 */
export function normalizeFilmDnaTreePosterFields(tree: FilmDnaTree): FilmDnaTree {
  return {
    center: withNormalizedPosterUrl(tree.center),
    left: tree.left.map(withNormalizedPosterUrl),
    right: tree.right.map(withNormalizedPosterUrl),
    ...(tree.seriesPrevious?.length
      ? { seriesPrevious: tree.seriesPrevious.map(withNormalizedPosterUrl) }
      : {}),
    ...(tree.seriesNext?.length
      ? { seriesNext: tree.seriesNext.map(withNormalizedPosterUrl) }
      : {}),
  };
}

/**
 * 用片库数据同步回填缺失的 `posterUrl`（Influence/Legacy/Series）。
 *
 * @param tree Film DNA 树
 * @param movies 当前片库
 */
export function hydrateFilmDnaTreeFromLibrary(
  tree: FilmDnaTree,
  movies: FilmDnaLibraryMovie[],
): FilmDnaTree {
  const lookup = buildLibraryPosterLookup(movies);
  return {
    center: hydrateFilmDnaNode(tree.center, lookup),
    left: tree.left.map((n) => hydrateFilmDnaNode(n, lookup)),
    right: tree.right.map((n) => hydrateFilmDnaNode(n, lookup)),
    ...(tree.seriesPrevious?.length
      ? {
          seriesPrevious: tree.seriesPrevious.map((n) =>
            hydrateFilmDnaNode(n, lookup),
          ),
        }
      : {}),
    ...(tree.seriesNext?.length
      ? { seriesNext: tree.seriesNext.map((n) => hydrateFilmDnaNode(n, lookup)) }
      : {}),
  };
}

/**
 * 收集仍缺海报的侧栏/系列节点（去重查询键）。
 *
 * @param tree Film DNA 树
 */
function collectNodesNeedingRemotePoster(
  tree: FilmDnaTree,
): Array<{ key: string; title: string; year: number | null }> {
  const slots: FilmDnaNode[] = [
    ...tree.left,
    ...tree.right,
    ...(tree.seriesPrevious ?? []),
    ...(tree.seriesNext ?? []),
  ];
  const seen = new Set<string>();
  const out: Array<{ key: string; title: string; year: number | null }> = [];

  for (const node of slots) {
    if (node.posterUrl?.trim()) continue;
    const title = node.title.trim();
    if (!title) continue;
    const year =
      typeof node.year === 'number' && node.year > 0 ? node.year : null;
    const key = `${normalizeFilmTitleKey(title)}|${year ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title, year });
  }

  return out;
}

/**
 * 调用 `search-movies` 为单片名解析海报 URL。
 *
 * @param supabase Supabase 客户端
 * @param title 片名
 * @param year 上映年份（可选）
 */
async function fetchPosterUrlViaSearchMovies(
  supabase: SupabaseClient,
  title: string,
  year: number | null,
): Promise<string | null> {
  const body: { query: string; year?: number } = { query: title };
  if (year != null && year > 0) body.year = year;

  const { data, error } = await supabase.functions.invoke('search-movies', {
    body,
  });
  if (error || !data || typeof data !== 'object') return null;

  const raw = data as { results?: SearchMoviesHit[]; error?: string };
  if (raw.error || !Array.isArray(raw.results)) return null;

  const titleKey = normalizeFilmTitleKey(title);
  let fallback: string | null = null;

  for (const hit of raw.results) {
    const poster = hit.posterUrl?.trim();
    if (!poster) continue;
    if (!fallback) fallback = poster;

    const hitTitleKey = normalizeFilmTitleKey(hit.title ?? '');
    if (hitTitleKey !== titleKey) continue;
    if (year != null && year > 0 && hit.year != null && hit.year !== year) {
      continue;
    }
    return poster;
  }

  if (fallback) return fallback;

  // Year-qualified search returned zero results with posters — retry title-only.
  // Handles future/sequel entries where the year in the node differs from TMDB.
  if (year != null && year > 0) {
    const { data: rd, error: re } = await supabase.functions.invoke('search-movies', {
      body: { query: title },
    });
    if (!re && rd && typeof rd === 'object') {
      const retryRaw = rd as { results?: SearchMoviesHit[]; error?: string };
      if (!retryRaw.error && Array.isArray(retryRaw.results)) {
        for (const hit of retryRaw.results) {
          const poster = hit.posterUrl?.trim();
          if (poster) return poster;
        }
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Film DNA] poster lookup exhausted for "${title}" (year ${year})`);
    }
  }

  return null;
}

/**
 * 将远程解析的海报写回树中匹配 title/year 的节点。
 *
 * @param tree Film DNA 树
 * @param posterByKey 查询键 → 海报 URL
 */
function applyRemotePosterMap(
  tree: FilmDnaTree,
  posterByKey: Map<string, string>,
): FilmDnaTree {
  const applySlot = (nodes: FilmDnaNode[] | undefined) =>
    nodes?.map((node) => {
      if (node.posterUrl?.trim()) return node;
      const year =
        typeof node.year === 'number' && node.year > 0 ? node.year : null;
      const key = `${normalizeFilmTitleKey(node.title)}|${year ?? ''}`;
      const posterUrl = posterByKey.get(key);
      return posterUrl ? { ...node, posterUrl } : node;
    });

  return {
    ...tree,
    left: applySlot(tree.left) ?? tree.left,
    right: applySlot(tree.right) ?? tree.right,
    ...(tree.seriesPrevious?.length
      ? { seriesPrevious: applySlot(tree.seriesPrevious) }
      : {}),
    ...(tree.seriesNext?.length
      ? { seriesNext: applySlot(tree.seriesNext) }
      : {}),
  };
}

/**
 * 完整海报回填：字段归一化 → 片库 → `search-movies`（Edge TMDb 失败时的客户端兜底）。
 *
 * @param supabase Supabase 客户端
 * @param tree Edge 返回的 Film DNA 树
 * @param options 片库与中止信号
 */
export async function hydrateFilmDnaTreePosters(
  supabase: SupabaseClient,
  tree: FilmDnaTree,
  options?: {
    libraryMovies?: FilmDnaLibraryMovie[];
    signal?: AbortSignal;
  },
): Promise<FilmDnaTree> {
  let result = normalizeFilmDnaTreePosterFields(tree);

  if (options?.libraryMovies?.length) {
    result = hydrateFilmDnaTreeFromLibrary(result, options.libraryMovies);
  }

  const pending = collectNodesNeedingRemotePoster(result);
  if (!pending.length || options?.signal?.aborted) return result;

  const posterByKey = new Map<string, string>();
  await Promise.all(
    pending.map(async ({ key, title, year }) => {
      if (options?.signal?.aborted) return;
      try {
        const poster = await fetchPosterUrlViaSearchMovies(
          supabase,
          title,
          year,
        );
        if (poster) posterByKey.set(key, poster);
      } catch {
        /* 单节点失败不阻断整树 */
      }
    }),
  );

  if (options?.signal?.aborted) return result;
  return applyRemotePosterMap(result, posterByKey);
}
