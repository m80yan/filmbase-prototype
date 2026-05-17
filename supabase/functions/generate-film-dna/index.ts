/// <reference lib="deno.ns" />
/**
 * Supabase Edge Function：根据影片元数据生成 Film DNA 左—中—右树（OpenAI，仅服务端）。
 *
 * Secrets（Dashboard → Edge Functions → Secrets）：
 * - `OPENAI_API_KEY`：不得暴露给前端
 * - `TMDB_READ_ACCESS_TOKEN`：海报 enrichment + 系列 collection 检测
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const MAX_INFLUENCE_NODES = 3;
const MAX_LEGACY_NODES = 3;
const MAX_SERIES_PREVIOUS = 10;
const MAX_SERIES_NEXT = 10;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const LOG_PREFIX = "[generate-film-dna]";

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

type FilmDnaRequestBody = {
  title?: string;
  year?: number;
  director?: string;
  writer?: string;
  genres?: string[];
  plot?: string;
  tagline?: string;
};

type FilmDnaNode = {
  title: string;
  year: number | null;
  note: string;
  posterUrl?: string;
};

type FilmDnaTree = {
  center: FilmDnaNode;
  left: FilmDnaNode[];
  right: FilmDnaNode[];
  seriesPrevious?: FilmDnaNode[];
  seriesNext?: FilmDnaNode[];
};

type TmdbSearchMovieResult = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  popularity?: number;
};

type TmdbSearchMovieResponse = {
  results?: TmdbSearchMovieResult[];
};

type TmdbBelongsToCollection = {
  id: number;
  name?: string;
};

type TmdbMovieDetails = {
  id: number;
  belongs_to_collection?: TmdbBelongsToCollection | null;
};

type TmdbCollectionPart = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
};

type TmdbCollectionDetails = {
  id: number;
  name?: string;
  parts?: TmdbCollectionPart[];
};

/** TMDb collection 系列检测结果。 */
type TmdbSeriesDetection = {
  movieId: number | null;
  collectionName: string | null;
  matchedInCollection: boolean;
  seriesPrevious: FilmDnaNode[];
  seriesNext: FilmDnaNode[];
};

const SERIES_PREV_NOTE = "Previous entry in the same series.";
const SERIES_NEXT_NOTE = "Next entry in the same series.";

type OpenAiChatResponse = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  error?: { message?: string; type?: string; code?: string };
};

type ErrorJsonBody = {
  error: string;
  message?: string;
  details?: string;
};

/**
 * 截断并去除可能含密钥的片段（仅用于日志/客户端 details）。
 *
 * @param text 原始文本
 * @param maxLen 最大长度
 */
function sanitizeForClient(text: string, maxLen = 500): string {
  const trimmed = text
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

/**
 * 统一 JSON 错误响应（始终带 CORS）。
 *
 * @param status HTTP 状态码
 * @param body 错误体
 */
function jsonError(status: number, body: ErrorJsonBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

/**
 * 规范化 LLM 返回的单个节点。
 *
 * @param raw 原始对象
 */
function normalizeNode(raw: unknown): FilmDnaNode | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return null;
  let year: number | null = null;
  if (typeof o.year === "number" && Number.isFinite(o.year)) {
    year = Math.round(o.year);
  } else if (typeof o.year === "string" && /^\d{4}$/.test(o.year.trim())) {
    year = Number(o.year.trim());
  }
  const note = typeof o.note === "string" ? o.note.trim() : "";
  const node: FilmDnaNode = { title, year, note };
  if (typeof o.posterUrl === "string" && o.posterUrl.trim()) {
    node.posterUrl = o.posterUrl.trim();
  }
  return node;
}

/**
 * 解析系列节点数组（前作 / 续作分别受上限约束）。
 *
 * @param raw JSON 字段
 * @param maxCount 该侧最大节点数
 */
function parseSeriesNodes(raw: unknown, maxCount: number): FilmDnaNode[] {
  if (!Array.isArray(raw)) return [];
  const out: FilmDnaNode[] = [];
  for (const item of raw) {
    const n = normalizeNode(item);
    if (n) out.push(n);
    if (out.length >= maxCount) break;
  }
  return out;
}

/**
 * 调用 TMDb v3（Bearer Read Access Token）。
 */
async function tmdbFetch(pathWithQuery: string, token: string): Promise<Response> {
  const url = new URL(`${TMDB_BASE}${pathWithQuery}`);
  return fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * 规范化标题用于 TMDb 搜索匹配。
 */
function normalizeTitleForMatch(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function releaseYearFromDate(rd: string | undefined): number {
  if (!rd || rd.length < 4) return NaN;
  const y = parseInt(rd.slice(0, 4), 10);
  return Number.isFinite(y) ? y : NaN;
}

/**
 * 在 TMDb `/search/movie` 结果中选取最可信的条目；不确定时返回 `null`。
 */
function pickTmdbMovieFromSearch(
  results: TmdbSearchMovieResult[],
  rowTitle: string,
  rowYear: number | null,
): TmdbSearchMovieResult | null {
  if (!results?.length) return null;
  const nt = normalizeTitleForMatch(rowTitle);
  if (!nt) return null;

  const rowY = rowYear != null && rowYear > 0 ? rowYear : 0;

  let pool = results;
  if (rowY > 0) {
    const band = results.filter((r) => {
      const y = releaseYearFromDate(r.release_date);
      return Number.isFinite(y) && Math.abs(y - rowY) <= 1;
    });
    if (band.length) pool = band;
  }

  const exactTitle = (r: TmdbSearchMovieResult) => {
    const t1 = r.title ? normalizeTitleForMatch(r.title) : "";
    const t2 = r.original_title ? normalizeTitleForMatch(r.original_title) : "";
    return t1 === nt || t2 === nt;
  };

  const looseTitle = (r: TmdbSearchMovieResult) => {
    const t1 = r.title ? normalizeTitleForMatch(r.title) : "";
    const t2 = r.original_title ? normalizeTitleForMatch(r.original_title) : "";
    if (!t1 && !t2) return false;
    return (
      t1 === nt ||
      t2 === nt ||
      t1.includes(nt) ||
      nt.includes(t1) ||
      (!!t2 && (t2.includes(nt) || nt.includes(t2)))
    );
  };

  const exact = pool.filter(exactTitle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    exact.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return exact[0];
  }

  if (pool.length === 1) {
    const r = pool[0];
    const y = releaseYearFromDate(r.release_date);
    const yOk =
      rowY <= 0 || (Number.isFinite(y) && Math.abs(y - rowY) <= 1);
    if (yOk && looseTitle(r)) return r;
  }

  return null;
}

/**
 * 由 `poster_path` 生成 w500 海报 URL。
 */
function posterUrlFromPath(path: string | null | undefined): string | null {
  if (typeof path !== "string" || !path.trim()) return null;
  return `${POSTER_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * 按 title + year 搜索 TMDb 并返回最佳匹配条目。
 */
async function searchTmdbMovie(
  title: string,
  year: number | null,
  token: string,
): Promise<TmdbSearchMovieResult | null> {
  const q = encodeURIComponent(title.trim());
  if (!q) return null;

  const y = year != null && year > 0 ? Math.round(year) : 0;
  const path =
    y > 0 ? `/search/movie?query=${q}&year=${y}` : `/search/movie?query=${q}`;

  const res = await tmdbFetch(path, token);
  if (!res.ok) {
    console.warn(`${LOG_PREFIX} TMDb search failed`, {
      title,
      year: y || null,
      status: res.status,
    });
    return null;
  }

  const json = (await res.json()) as TmdbSearchMovieResponse;
  return pickTmdbMovieFromSearch(json.results ?? [], title, y > 0 ? y : null);
}

/**
 * 按 title + year 搜索 TMDb 并返回海报 URL；无匹配或无图则 `null`。
 */
async function fetchTmdbPosterUrl(
  title: string,
  year: number | null,
  token: string,
): Promise<string | null> {
  const hit = await searchTmdbMovie(title, year, token);
  if (!hit) return null;
  return posterUrlFromPath(hit.poster_path ?? null);
}

/**
 * Collection part → Film DNA 节点。
 */
function filmDnaNodeFromCollectionPart(
  part: TmdbCollectionPart,
  note: string,
): FilmDnaNode | null {
  const title = (part.title ?? part.original_title ?? "").trim();
  if (!title) return null;
  const y = releaseYearFromDate(part.release_date);
  const node: FilmDnaNode = {
    title,
    year: Number.isFinite(y) ? y : null,
    note,
  };
  const posterUrl = posterUrlFromPath(part.poster_path ?? null);
  if (posterUrl) node.posterUrl = posterUrl;
  return node;
}

/**
 * 在 collection `parts` 中定位当前影片索引（优先 id，其次标题+年份）。
 */
function findCollectionPartIndex(
  parts: TmdbCollectionPart[],
  movieId: number,
  centerTitle: string,
  centerYear: number | null,
): number {
  const byId = parts.findIndex((p) => p.id === movieId);
  if (byId !== -1) return byId;

  const key = normalizeTitleForMatch(centerTitle);
  const cy = centerYear != null && centerYear > 0 ? centerYear : null;

  return parts.findIndex((p) => {
    const t1 = p.title ? normalizeTitleForMatch(p.title) : "";
    const t2 = p.original_title ? normalizeTitleForMatch(p.original_title) : "";
    if (t1 !== key && t2 !== key) return false;
    if (cy == null) return true;
    const py = releaseYearFromDate(p.release_date);
    return Number.isFinite(py) && Math.abs(py - cy) <= 1;
  });
}

/**
 * 用 TMDb `belongs_to_collection` 检测中心影片的系列前/后作。
 */
async function detectTmdbSeriesForCenter(
  centerTitle: string,
  centerYear: number | null,
  token: string,
): Promise<TmdbSeriesDetection> {
  const empty: TmdbSeriesDetection = {
    movieId: null,
    collectionName: null,
    matchedInCollection: false,
    seriesPrevious: [],
    seriesNext: [],
  };

  const hit = await searchTmdbMovie(centerTitle, centerYear, token);
  if (!hit?.id) return empty;

  const movieRes = await tmdbFetch(`/movie/${hit.id}`, token);
  if (!movieRes.ok) {
    console.warn(`${LOG_PREFIX} TMDb movie details failed`, {
      movieId: hit.id,
      status: movieRes.status,
    });
    return { ...empty, movieId: hit.id };
  }

  const movie = (await movieRes.json()) as TmdbMovieDetails;
  const collectionRef = movie.belongs_to_collection;
  if (!collectionRef?.id) {
    return { ...empty, movieId: hit.id };
  }

  const collRes = await tmdbFetch(`/collection/${collectionRef.id}`, token);
  if (!collRes.ok) {
    console.warn(`${LOG_PREFIX} TMDb collection failed`, {
      collectionId: collectionRef.id,
      status: collRes.status,
    });
    return {
      ...empty,
      movieId: hit.id,
      collectionName: collectionRef.name ?? null,
    };
  }

  const collection = (await collRes.json()) as TmdbCollectionDetails;
  const collectionName = collection.name ?? collectionRef.name ?? null;

  const sorted = (collection.parts ?? [])
    .filter((p) => p.id && typeof p.release_date === "string" && p.release_date)
    .sort((a, b) =>
      (a.release_date ?? "").localeCompare(b.release_date ?? ""),
    );

  if (sorted.length < 2) {
    return {
      movieId: hit.id,
      collectionName,
      matchedInCollection: false,
      seriesPrevious: [],
      seriesNext: [],
    };
  }

  const idx = findCollectionPartIndex(sorted, hit.id, centerTitle, centerYear);
  if (idx === -1) {
    console.warn(`${LOG_PREFIX} center not found in collection parts`, {
      movieId: hit.id,
      collectionId: collectionRef.id,
      partCount: sorted.length,
    });
    return {
      movieId: hit.id,
      collectionName,
      matchedInCollection: false,
      seriesPrevious: [],
      seriesNext: [],
    };
  }

  const previousParts = sorted.slice(
    Math.max(0, idx - MAX_SERIES_PREVIOUS),
    idx,
  );
  const nextParts = sorted.slice(
    idx + 1,
    idx + 1 + MAX_SERIES_NEXT,
  );

  return {
    movieId: hit.id,
    collectionName,
    matchedInCollection: true,
    seriesPrevious: previousParts
      .map((part) => filmDnaNodeFromCollectionPart(part, SERIES_PREV_NOTE))
      .filter((n): n is FilmDnaNode => n !== null),
    seriesNext: nextParts
      .map((part) => filmDnaNodeFromCollectionPart(part, SERIES_NEXT_NOTE))
      .filter((n): n is FilmDnaNode => n !== null),
  };
}

/**
 * TMDb collection 结果覆盖 GPT 系列槽位；无 collection 时保留 GPT 回退。
 */
async function applyTmdbSeriesToTree(
  tree: FilmDnaTree,
  centerTitle: string,
  centerYear: number | null,
  token: string,
): Promise<FilmDnaTree> {
  const detection = await detectTmdbSeriesForCenter(
    centerTitle,
    centerYear,
    token,
  );

  console.log(`${LOG_PREFIX} TMDb series detection`, {
    movieId: detection.movieId,
    collectionName: detection.collectionName,
    matchedInCollection: detection.matchedInCollection,
    seriesPreviousCount: detection.seriesPrevious.length,
    seriesNextCount: detection.seriesNext.length,
    seriesPrevious: detection.seriesPrevious.map((n) => ({
      title: n.title,
      year: n.year,
    })),
    seriesNext: detection.seriesNext.map((n) => ({
      title: n.title,
      year: n.year,
    })),
  });

  if (!detection.matchedInCollection) {
    return reconcileSeriesAndLegacy(tree);
  }

  const next: FilmDnaTree = { ...tree };
  if (detection.seriesPrevious.length) {
    next.seriesPrevious = detection.seriesPrevious;
  } else {
    delete next.seriesPrevious;
  }
  if (detection.seriesNext.length) {
    next.seriesNext = detection.seriesNext;
  } else {
    delete next.seriesNext;
  }

  return reconcileSeriesAndLegacy(next);
}

/**
 * 为单个关联节点附加 `posterUrl`（保留原文案字段）。
 */
async function enrichNodePoster(
  node: FilmDnaNode,
  token: string,
): Promise<FilmDnaNode> {
  if (node.posterUrl?.trim()) return node;

  const posterUrl = await fetchTmdbPosterUrl(node.title, node.year, token);
  if (!posterUrl) return node;

  return { ...node, posterUrl };
}

/**
 * 为 Influence / Legacy / Series 节点批量 enrichment（受数量上限约束）。
 */
async function enrichFilmDnaTreePosters(
  tree: FilmDnaTree,
  token: string,
): Promise<FilmDnaTree> {
  const left = await Promise.all(
    tree.left
      .slice(0, MAX_INFLUENCE_NODES)
      .map((node) => enrichNodePoster(node, token)),
  );

  const right = await Promise.all(
    tree.right
      .slice(0, MAX_LEGACY_NODES)
      .map((node) => enrichNodePoster(node, token)),
  );

  let seriesPrevious = tree.seriesPrevious;
  if (seriesPrevious?.length) {
    seriesPrevious = await Promise.all(
      seriesPrevious
        .slice(0, MAX_SERIES_PREVIOUS)
        .map((node) => enrichNodePoster(node, token)),
    );
  }

  let seriesNext = tree.seriesNext;
  if (seriesNext?.length) {
    seriesNext = await Promise.all(
      seriesNext
        .slice(0, MAX_SERIES_NEXT)
        .map((node) => enrichNodePoster(node, token)),
    );
  }

  return {
    ...tree,
    left,
    right,
    ...(seriesPrevious?.length ? { seriesPrevious } : {}),
    ...(seriesNext?.length ? { seriesNext } : {}),
  };
}

/**
 * 解析并校验 OpenAI JSON 输出为 Film DNA 树。
 *
 * @param parsed 已 `JSON.parse` 的对象
 * @param fallbackTitle 请求中的片名（用于补全 center）
 * @param fallbackYear 请求年份
 */
function parseFilmDnaTree(
  parsed: unknown,
  fallbackTitle: string,
  fallbackYear: number | null,
): FilmDnaTree | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;

  const centerRaw = root.center;
  const center =
    normalizeNode(centerRaw) ??
    ({
      title: fallbackTitle,
      year: fallbackYear,
      note: "",
    } satisfies FilmDnaNode);

  const left: FilmDnaNode[] = [];
  if (Array.isArray(root.left)) {
    for (const item of root.left) {
      const n = normalizeNode(item);
      if (n) left.push(n);
      if (left.length >= MAX_INFLUENCE_NODES) break;
    }
  }

  const right: FilmDnaNode[] = [];
  if (Array.isArray(root.right)) {
    for (const item of root.right) {
      const n = normalizeNode(item);
      if (n) right.push(n);
      if (right.length >= MAX_LEGACY_NODES) break;
    }
  }

  const seriesPrevious = parseSeriesNodes(
    root.seriesPrevious,
    MAX_SERIES_PREVIOUS,
  );
  const seriesNext = parseSeriesNodes(root.seriesNext, MAX_SERIES_NEXT);

  return reconcileSeriesAndLegacy({
    center,
    left,
    right,
    ...(seriesPrevious.length ? { seriesPrevious } : {}),
    ...(seriesNext.length ? { seriesNext } : {}),
  });
}

/**
 * 规范化片名用于去重比较。
 */
function normalizeFilmTitleKey(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * 两节点是否同一部影片（按标题）。
 */
function filmNodesMatchTitle(a: FilmDnaNode, b: FilmDnaNode): boolean {
  return normalizeFilmTitleKey(a.title) === normalizeFilmTitleKey(b.title);
}

/**
 * 备注/标题是否像系列续作（误放入 `right[]` 时提升为 `seriesNext`）。
 */
function isLikelySeriesContinuation(node: FilmDnaNode): boolean {
  const text = `${node.note} ${node.title}`.toLowerCase();
  return /\b(sequel|follow-up|follow up|continuation|next (film|installment|chapter|entry)|direct successor|same series|franchise)\b/.test(
    text,
  );
}

/**
 * 备注/标题是否像系列前作（误放入 `left[]` 时提升为 `seriesPrevious`）。
 */
function isLikelySeriesPrequel(node: FilmDnaNode): boolean {
  const text = `${node.note} ${node.title}`.toLowerCase();
  return /\b(prequel|prior (film|installment|chapter|entry)|previous (film|installment)|earlier (film|installment)|same series|franchise)\b/.test(
    text,
  );
}

/**
 * 将 center 同片名、更早年份的条目从 Influence 挪到 seriesPrevious（TV/舞台前作等）。
 */
function promoteSameTitlePriorVersion(tree: FilmDnaTree): FilmDnaTree {
  const center = tree.center;
  const centerKey = normalizeFilmTitleKey(center.title);
  const centerYear =
    center.year != null && center.year > 0 ? center.year : null;

  let left = [...tree.left];
  let seriesPrevious = tree.seriesPrevious ? [...tree.seriesPrevious] : [];

  const priorIdx = left.findIndex((n) => {
    if (normalizeFilmTitleKey(n.title) !== centerKey) return false;
    if (centerYear == null || n.year == null || n.year <= 0) return true;
    return n.year < centerYear;
  });

  if (priorIdx === -1 || seriesPrevious.length) {
    return tree;
  }

  const prior = left.splice(priorIdx, 1)[0];
  seriesPrevious = [
    {
      ...prior,
      note: prior.note.trim() || SERIES_PREV_NOTE,
    },
  ];

  return {
    ...tree,
    left,
    ...(seriesPrevious.length ? { seriesPrevious } : {}),
  };
}

/**
 * 保证系列槽位与 Influence/Legacy 槽位互斥；必要时从 left/right 提升系列条目。
 */
function reconcileSeriesAndLegacy(tree: FilmDnaTree): FilmDnaTree {
  const promoted = promoteSameTitlePriorVersion(tree);

  let left = [...promoted.left];
  let right = [...promoted.right];
  let seriesPrevious = promoted.seriesPrevious ? [...promoted.seriesPrevious] : [];
  let seriesNext = promoted.seriesNext ? [...promoted.seriesNext] : [];

  if (!seriesNext.length) {
    const sequelIdx = right.findIndex((n) => isLikelySeriesContinuation(n));
    if (sequelIdx !== -1) {
      seriesNext = [right.splice(sequelIdx, 1)[0]];
    }
  }

  if (!seriesPrevious.length) {
    const prequelIdx = left.findIndex((n) => isLikelySeriesPrequel(n));
    if (prequelIdx !== -1) {
      seriesPrevious = [left.splice(prequelIdx, 1)[0]];
    }
  }

  if (seriesNext.length) {
    const nextKeys = new Set(
      seriesNext.map((n) => normalizeFilmTitleKey(n.title)),
    );
    right = right.filter((n) => !nextKeys.has(normalizeFilmTitleKey(n.title)));
  }
  if (seriesPrevious.length) {
    const prevKeys = new Set(
      seriesPrevious.map((n) => normalizeFilmTitleKey(n.title)),
    );
    left = left.filter((n) => !prevKeys.has(normalizeFilmTitleKey(n.title)));
  }

  return {
    ...promoted,
    left: left.slice(0, MAX_INFLUENCE_NODES),
    right: right.slice(0, MAX_LEGACY_NODES),
    ...(seriesPrevious.length
      ? { seriesPrevious: seriesPrevious.slice(0, MAX_SERIES_PREVIOUS) }
      : {}),
    ...(seriesNext.length
      ? { seriesNext: seriesNext.slice(0, MAX_SERIES_NEXT) }
      : {}),
  };
}

/**
 * Film DNA 生成用 system prompt（Influence / Legacy 需满足可辩护的影史关联）。
 */
const FILM_DNA_SYSTEM_PROMPT = `You are a rigorous film historian. Given metadata about one film, output ONLY valid JSON (no markdown) with this exact shape:
{
  "center": { "title": string, "year": number|null, "note": string },
  "left": [{ "title": string, "year": number|null, "note": string }],
  "right": [{ "title": string, "year": number|null, "note": string }],
  "seriesPrevious": [{ "title": string, "year": number|null, "note": string }],
  "seriesNext": [{ "title": string, "year": number|null, "note": string }]
}

Slot semantics:
- left (Influence): films that meaningfully shaped THIS film beforehand (craft, lineage, documented inspiration). NOT same-franchise prequels.
- right (Legacy): films this work helped shape afterward in cinema (successors in film language, genre, or documented reception). NOT same-franchise sequels or direct story continuations.

A valid Influence or Legacy link MUST satisfy at least ONE of:
- widely recognized cinematic influence (critics, historians, or industry consensus)
- direct homage, reference, or cited inspiration
- same franchise or continuation (use seriesPrevious/seriesNext instead when applicable)
- same director evolving earlier ideas across films
- major genre-defining lineage (e.g. noir → neo-noir, cyberpunk visual language)
- strong structural or stylistic inheritance discussed in film criticism
- historically documented inspiration (interviews, essays, retrospectives)
- canonical film-school comparison taught as lineage
- culturally accepted cinematic DNA (not fan speculation)

NEVER base a link only on:
- vague emotional or thematic similarity
- both being dialogue-heavy, psychological, ensemble, or "smart"
- both being critically acclaimed prestige dramas
- loose "both are about X" without craft/lineage evidence

Prioritize candidates in this order:
1. historically accepted influence
2. film-language evolution (mise-en-scène, editing, sound, genre grammar)
3. genre lineage
4. director or writer influence
5. cinematic technique inheritance
6. relevant movement/lineage (cyberpunk, noir, sci-fi, courtroom drama, etc.)

Confidence filter (strict):
- If a relationship feels weak, debatable, or merely associative, OMIT it.
- Prefer fewer, stronger nodes over weak filler. left and right may contain 0–3 entries each.
- Do NOT pad to three entries with speculative links. One or two strong links beat three weak ones.
- Each note must name the specific connection (technique, lineage, homage, director thread)—not vague praise.

Chronology:
- Influence (left): prefer films released before the subject (or contemporaries that directly fed its formation).
- Legacy (right): only films released after the subject that plausibly inherit from it.

Calibration example (Legacy for "12 Angry Men", 1957):
- GOOD: A Few Good Men, The Verdict, Anatomy of a Murder, Judgment at Nuremberg (courtroom/jury craft lineage).
- BAD: The Social Network (2010)—prestige drama with no rigorous cinematic legacy tie; omit.

Series slots:
- seriesPrevious: optional, 0–10 prior installments in the SAME series/franchise, release-date order (oldest first). Omit or [] if none.
- seriesNext: optional, 0–10 later installments in the SAME series/franchise, release-date order. Put sequels here, NEVER in right[].
- Prior TV/stage versions of the SAME story, remakes, or franchise prequels belong in seriesPrevious—not in left[] or right[].
- Never put the same story title as center in left[] or right[]; use seriesPrevious/seriesNext for earlier/later installments of that property.

When several films share the same documented craft lineage (e.g. courtroom/jury tradition, cyberpunk visual line), include the strongest documented examples up to three—still omitting weak prestige-only pairings.

Courtroom / jury dramas: Influence = earlier trial or deliberation lineage; Legacy = later films in that craft tradition—not unrelated modern prestige dramas.

General:
- center must be the subject film (use the provided title and year when known).
- Never duplicate a film across left, right, seriesPrevious, and seriesNext.
- Each note: one short phrase, max 12 words, no URLs, no citations, no footnotes.
- Use English for notes. Real film titles only. Do not include posterUrl fields.`;

/**
 * 构建发给 OpenAI 的用户提示（仅使用客户端已知的库内元数据，无联网检索）。
 */
function buildUserPrompt(body: FilmDnaRequestBody): string {
  const lines: string[] = [
    `Title: ${(body.title ?? "").trim()}`,
  ];
  if (typeof body.year === "number" && Number.isFinite(body.year)) {
    lines.push(`Year: ${Math.round(body.year)}`);
  }
  const director = (body.director ?? "").trim();
  if (director) lines.push(`Director: ${director}`);
  const writer = (body.writer ?? "").trim();
  if (writer) lines.push(`Writer: ${writer}`);
  const genres = (body.genres ?? []).filter((g) => typeof g === "string" && g.trim());
  if (genres.length) lines.push(`Genres: ${genres.join(", ")}`);
  const tagline = (body.tagline ?? "").trim();
  if (tagline) lines.push(`Tagline: ${tagline}`);
  const plot = (body.plot ?? "").trim();
  if (plot) lines.push(`Plot: ${plot.slice(0, 1200)}`);
  return lines.join("\n");
}

Deno.serve(async (req) => {
  try {
    console.log(`${LOG_PREFIX} request start`, {
      method: req.method,
      hasOpenAiApiKey: Boolean(Deno.env.get("OPENAI_API_KEY")?.trim()),
    });

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonError(405, { error: "Method not allowed", message: "Use POST" });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey?.trim()) {
      console.error(`${LOG_PREFIX} OPENAI_API_KEY is not set`);
      return jsonError(500, {
        error: "Server misconfiguration",
        message: "OPENAI_API_KEY is not set",
        details: "Set OPENAI_API_KEY in Supabase Edge Function secrets.",
      });
    }

    let body: FilmDnaRequestBody = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text) as FilmDnaRequestBody;
    } catch (parseErr) {
      console.error(`${LOG_PREFIX} invalid JSON body`, parseErr);
      return jsonError(400, {
        error: "Invalid JSON body",
        details: "Request body must be valid JSON.",
      });
    }

    const title = (body.title ?? "").trim();
    const year =
      typeof body.year === "number" && Number.isFinite(body.year)
        ? Math.round(body.year)
        : null;

    console.log(`${LOG_PREFIX} incoming`, { title, year });

    if (!title) {
      return jsonError(400, {
        error: "Bad request",
        message: "Missing title",
        details: "Field `title` is required.",
      });
    }

    const fallbackYear = year;

    console.log(`${LOG_PREFIX} calling OpenAI`, { model: OPENAI_MODEL });

    const openAiRes = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: FILM_DNA_SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(body) },
        ],
      }),
    });

    console.log(`${LOG_PREFIX} OpenAI response status`, openAiRes.status);

    const openAiText = await openAiRes.text();

    if (!openAiRes.ok) {
      console.error(`${LOG_PREFIX} OpenAI error body`, openAiText);
      let openAiMessage = `HTTP ${openAiRes.status}`;
      try {
        const errJson = JSON.parse(openAiText) as OpenAiChatResponse;
        if (errJson.error?.message) {
          openAiMessage = sanitizeForClient(errJson.error.message, 300);
        }
      } catch {
        openAiMessage = sanitizeForClient(openAiText, 300);
      }
      return jsonError(502, {
        error: "OpenAI request failed",
        message: openAiMessage,
        details: `OpenAI returned status ${openAiRes.status}. ${openAiMessage}`,
      });
    }

    let openAiJson: OpenAiChatResponse;
    try {
      openAiJson = JSON.parse(openAiText) as OpenAiChatResponse;
    } catch (parseErr) {
      console.error(`${LOG_PREFIX} OpenAI envelope parse failed`, parseErr);
      console.error(`${LOG_PREFIX} OpenAI raw text`, openAiText.slice(0, 2000));
      return jsonError(502, {
        error: "OpenAI response parse failed",
        message: "Could not parse OpenAI JSON envelope",
        details: sanitizeForClient(openAiText, 400),
      });
    }

    const content = openAiJson.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      console.error(`${LOG_PREFIX} OpenAI empty content`, openAiText.slice(0, 2000));
      return jsonError(502, {
        error: "OpenAI empty content",
        message: "No completion returned",
        details: "choices[0].message.content was empty.",
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error(`${LOG_PREFIX} model JSON parse failed`, parseErr);
      console.error(`${LOG_PREFIX} raw model output`, content);
      return jsonError(500, {
        error: "Invalid model JSON",
        message: "Model did not return parseable JSON",
        details: sanitizeForClient(content, 600),
      });
    }

    const tree = parseFilmDnaTree(parsed, title, fallbackYear);
    if (!tree) {
      console.error(`${LOG_PREFIX} invalid Film DNA shape`, parsed);
      return jsonError(500, {
        error: "Invalid Film DNA shape",
        message: "Could not normalize tree",
        details: "Parsed JSON did not match expected center/left/right shape.",
      });
    }

    const tmdbToken = Deno.env.get("TMDB_READ_ACCESS_TOKEN")?.trim();
    let enrichedTree = tree;
    if (tmdbToken) {
      try {
        enrichedTree = await applyTmdbSeriesToTree(
          tree,
          title,
          fallbackYear,
          tmdbToken,
        );
        enrichedTree = await enrichFilmDnaTreePosters(enrichedTree, tmdbToken);
        const posterCounts = {
          left: enrichedTree.left.filter((n) => n.posterUrl).length,
          right: enrichedTree.right.filter((n) => n.posterUrl).length,
          seriesPrevious: enrichedTree.seriesPrevious?.filter((n) => n.posterUrl)
            .length ?? 0,
          seriesNext: enrichedTree.seriesNext?.filter((n) => n.posterUrl).length ??
            0,
        };
        console.log(`${LOG_PREFIX} TMDb poster enrichment`, posterCounts);
      } catch (enrichErr) {
        console.error(`${LOG_PREFIX} TMDb enrichment failed`, enrichErr);
      }
    } else {
      console.warn(
        `${LOG_PREFIX} TMDB_READ_ACCESS_TOKEN not set; skipping poster enrichment`,
      );
    }

    console.log(`${LOG_PREFIX} success`, {
      title,
      leftCount: enrichedTree.left.length,
      rightCount: enrichedTree.right.length,
      seriesPreviousCount: enrichedTree.seriesPrevious?.length ?? 0,
      seriesNextCount: enrichedTree.seriesNext?.length ?? 0,
    });

    return new Response(JSON.stringify(enrichedTree), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`${LOG_PREFIX} unexpected error`, { name, message, stack });
    return jsonError(500, {
      error: "Internal server error",
      message: sanitizeForClient(message, 200),
      details: stack ? sanitizeForClient(stack, 800) : message,
    });
  }
});
