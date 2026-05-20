import type { SupabaseClient } from '@supabase/supabase-js';
import type { FilmDnaNode, FilmDnaTree } from '../types/filmDna';

/** 片库条目：用于按标题/年份/imdbId 回填 Film DNA 节点海报。 */
export type FilmDnaLibraryMovie = {
  id: string;
  title: string;
  year: number;
  posterUrl: string;
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
function normalizeFilmTitleKey(title: string): string {
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
  byIdentity: Map<string, string>;
  byImdbId: Map<string, string>;
};

/**
 * 由当前片库构建海报查找表（标题+年份、imdb `tt…` id）。
 *
 * @param movies 片库影片列表
 */
export function buildLibraryPosterLookup(
  movies: FilmDnaLibraryMovie[],
): LibraryPosterLookup {
  const byIdentity = new Map<string, string>();
  const byImdbId = new Map<string, string>();

  for (const movie of movies) {
    const url = movie.posterUrl?.trim();
    if (!url || !url.startsWith('http')) continue;

    const titleKey = normalizeFilmTitleKey(movie.title);
    if (titleKey && Number.isFinite(movie.year) && movie.year > 0) {
      byIdentity.set(`${titleKey}|${movie.year}`, url);
    }

    const imdb = movie.id.trim().toLowerCase();
    if (/^tt\d+$/.test(imdb)) {
      byImdbId.set(imdb, url);
    }
  }

  return { byIdentity, byImdbId };
}

/**
 * 在片库中按标题/年份查找海报 URL。
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

  if (typeof node.year === 'number' && node.year > 0) {
    const exact = lookup.byIdentity.get(`${titleKey}|${node.year}`);
    if (exact) return exact;
  }

  let fallback: string | undefined;
  for (const [key, url] of lookup.byIdentity) {
    if (!key.startsWith(`${titleKey}|`)) continue;
    if (fallback && fallback !== url) {
      return undefined;
    }
    fallback = url;
  }
  return fallback;
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
  if (normalized.posterUrl?.trim()) return normalized;

  if (lookup) {
    const fromLibrary = lookupLibraryPosterUrl(normalized, lookup);
    if (fromLibrary) {
      return { ...normalized, posterUrl: fromLibrary };
    }
  }

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

  return fallback;
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
