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
  /** TMDb movie id（collection part / 搜索解析；系列摘要 enrichment）。 */
  tmdbMovieId?: number;
  relationshipSummaryTitle?: string;
  relationshipBullets?: string[];
  lineageConnectedAbove?: boolean;
  sameSourceVertical?: boolean;
  significanceBullets?: string[];
  plotSummary?: string;
  boxOffice?: string;
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

const DEBUG_INGEST_URL =
  "http://127.0.0.1:7684/ingest/27c00267-50f5-4ead-aaaa-e8a9751002f8";
const DEBUG_SESSION_ID = "cd85de";

/**
 * Debug 模式：系列节点 plotSummary / boxOffice 快照（不含密钥）。
 *
 * @param nodes 系列槽位节点
 */
function seriesSummaryDebugSnapshot(nodes: FilmDnaNode[] | undefined) {
  return (nodes ?? []).map((n) => ({
    title: n.title,
    year: n.year,
    hasPlotSummary: Boolean(n.plotSummary?.trim()),
    hasBoxOffice: Boolean(n.boxOffice?.trim()),
    plotSummaryPreview: n.plotSummary?.slice(0, 48) ?? null,
    boxOffice: n.boxOffice ?? null,
  }));
}

/**
 * Debug 模式：GPT 原始 JSON 中系列槽位字段快照。
 *
 * @param items `seriesPrevious` / `seriesNext` 原始数组
 */
function seriesSummaryRawGptSnapshot(items: unknown) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (!item || typeof item !== "object") return { invalid: true };
    const o = item as Record<string, unknown>;
    return {
      title: o.title,
      year: o.year,
      hasPlotSummary:
        typeof o.plotSummary === "string" && o.plotSummary.trim().length > 0,
      hasBoxOffice:
        typeof o.boxOffice === "string" && o.boxOffice.trim().length > 0,
    };
  });
}

/**
 * @param location 日志位置
 * @param message 简述
 * @param data 结构化数据
 * @param hypothesisId 假设编号
 */
function agentDebugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  const payload = {
    sessionId: DEBUG_SESSION_ID,
    location,
    message,
    data,
    hypothesisId,
    timestamp: Date.now(),
  };
  console.log(`${LOG_PREFIX} [debug][${hypothesisId}]`, message, data);
  fetch(DEBUG_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": DEBUG_SESSION_ID,
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

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
 * 规范化关系摘要要点（最多 4 条短句）。
 *
 * @param raw LLM 返回的 bullets 字段
 */
function normalizeRelationshipBullets(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const bullets = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 4);
  return bullets.length > 0 ? bullets : undefined;
}

/**
 * 规范化 significance 悬停摘要要点（最多 4 条）。
 *
 * @param raw LLM 返回的 bullets 字段
 */
function normalizeSignificanceBullets(raw: unknown): string[] | undefined {
  return normalizeRelationshipBullets(raw);
}

/**
 * 规范化系列轴剧情摘要（单句）。
 *
 * @param raw LLM 返回的 plotSummary
 */
function normalizePlotSummary(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 280);
}

/**
 * 规范化系列轴票房字段（保留原始金额文本供 UI 格式化）。
 *
 * @param raw LLM 返回的 boxOffice
 */
function normalizeBoxOffice(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—" || /^n\/a$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed.slice(0, 64);
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
  const relationshipSummaryTitle =
    typeof o.relationshipSummaryTitle === "string"
      ? o.relationshipSummaryTitle.trim()
      : "";
  if (relationshipSummaryTitle) {
    node.relationshipSummaryTitle = relationshipSummaryTitle.slice(0, 160);
  }
  const relationshipBullets = normalizeRelationshipBullets(
    o.relationshipBullets,
  );
  if (relationshipBullets) {
    node.relationshipBullets = relationshipBullets;
  }
  if (typeof o.lineageConnectedAbove === "boolean") {
    node.lineageConnectedAbove = o.lineageConnectedAbove;
  }
  if (typeof o.sameSourceVertical === "boolean") {
    node.sameSourceVertical = o.sameSourceVertical;
  }
  const significanceBullets = normalizeSignificanceBullets(
    o.significanceBullets,
  );
  if (significanceBullets) {
    node.significanceBullets = significanceBullets;
  }
  const plotSummary = normalizePlotSummary(o.plotSummary);
  if (plotSummary) {
    node.plotSummary = plotSummary;
  }
  const boxOffice = normalizeBoxOffice(o.boxOffice);
  if (boxOffice) {
    node.boxOffice = boxOffice;
  }
  if (typeof o.tmdbMovieId === "number" && o.tmdbMovieId > 0) {
    node.tmdbMovieId = Math.round(o.tmdbMovieId);
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
 * TMDb `revenue` 格式化为紧凑 USD（如 `$136.4M`），供系列节点 `boxOffice` 字段。
 *
 * @param revenue TMDb movie.revenue（美元整数）
 */
function formatCompactUsdBoxOffice(
  revenue: number | null | undefined,
): string | undefined {
  if (
    revenue == null ||
    typeof revenue !== "number" ||
    !Number.isFinite(revenue) ||
    revenue <= 0
  ) {
    return undefined;
  }
  const formatScaled = (scaled: number): string =>
    scaled >= 10
      ? scaled.toFixed(0)
      : scaled.toFixed(1).replace(/\.0$/, "");

  if (revenue >= 1_000_000_000) {
    return `$${formatScaled(revenue / 1_000_000_000)}B`;
  }
  if (revenue >= 1_000_000) {
    return `$${formatScaled(revenue / 1_000_000)}M`;
  }
  if (revenue >= 1_000) {
    return `$${formatScaled(revenue / 1_000)}K`;
  }
  return `$${revenue.toLocaleString("en-US")}`;
}

/**
 * 从 TMDb overview 生成系列节点 `plotSummary`。
 *
 * @param overview TMDb movie.overview
 */
function plotSummaryFromTmdbOverview(
  overview: string | undefined,
): string | undefined {
  const text = (overview ?? "").trim();
  if (!text) return undefined;
  return normalizePlotSummary(text.slice(0, 280));
}

type TmdbMovieSummaryDetails = {
  overview?: string;
  revenue?: number | null;
};

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
  if (part.id > 0) node.tmdbMovieId = part.id;
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

  // #region agent log
  agentDebugLog(
    "generate-film-dna/index.ts:applyTmdbSeriesToTree:entry",
    "GPT tree before TMDb series apply",
    {
      matchedInCollection: detection.matchedInCollection,
      gptSeriesPrevious: seriesSummaryDebugSnapshot(tree.seriesPrevious),
      gptSeriesNext: seriesSummaryDebugSnapshot(tree.seriesNext),
    },
    "D",
  );
  // #endregion

  if (!detection.matchedInCollection) {
    const noTmdb = applySeriesSummaryScope(
      applySignificanceScope(
        applySeriesLineageFlags(reconcileSeriesAndLegacy(tree)),
      ),
    );
    // #region agent log
    agentDebugLog(
      "generate-film-dna/index.ts:applyTmdbSeriesToTree:no-collection",
      "After reconcile (no TMDb collection)",
      {
        seriesPrevious: seriesSummaryDebugSnapshot(noTmdb.seriesPrevious),
        seriesNext: seriesSummaryDebugSnapshot(noTmdb.seriesNext),
      },
      "D",
    );
    // #endregion
    return noTmdb;
  }

  const next: FilmDnaTree = { ...tree };
  if (detection.seriesPrevious.length) {
    next.seriesPrevious = mergeGptSeriesSlot(
      detection.seriesPrevious,
      tree.seriesPrevious,
    );
  } else {
    delete next.seriesPrevious;
  }
  if (detection.seriesNext.length) {
    next.seriesNext = mergeGptSeriesSlot(detection.seriesNext, tree.seriesNext);
  } else {
    delete next.seriesNext;
  }

  // #region agent log
  agentDebugLog(
    "generate-film-dna/index.ts:applyTmdbSeriesToTree:post-merge",
    "After TMDb slot merge, before reconcile",
    {
      seriesPrevious: seriesSummaryDebugSnapshot(next.seriesPrevious),
      seriesNext: seriesSummaryDebugSnapshot(next.seriesNext),
    },
    "C",
  );
  console.log("seriesPrevious", next.seriesPrevious);
  console.log("seriesNext", next.seriesNext);
  // #endregion

  return applySeriesSummaryScope(
    applySignificanceScope(
      applySeriesLineageFlags(reconcileSeriesAndLegacy(next)),
    ),
  );
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
 * 解析系列节点的 TMDb movie id（节点字段优先，否则 title+year 搜索）。
 *
 * @param node 系列节点
 * @param token TMDb Read Access Token
 */
async function resolveSeriesNodeTmdbMovieId(
  node: FilmDnaNode,
  token: string,
): Promise<number | null> {
  if (typeof node.tmdbMovieId === "number" && node.tmdbMovieId > 0) {
    return node.tmdbMovieId;
  }
  const hit = await searchTmdbMovie(node.title, node.year, token);
  return hit?.id ?? null;
}

/**
 * 从 TMDb `/movie/{id}` 拉取系列摘要字段（剧情 + 紧凑票房）。
 *
 * @param movieId TMDb movie id
 * @param token TMDb Read Access Token
 */
async function fetchSeriesMetadataFromTmdb(
  movieId: number,
  token: string,
): Promise<{ plotSummary?: string; boxOffice?: string }> {
  const res = await tmdbFetch(`/movie/${movieId}`, token);
  if (!res.ok) {
    console.warn(`${LOG_PREFIX} TMDb movie summary failed`, {
      movieId,
      status: res.status,
    });
    return {};
  }
  const movie = (await res.json()) as TmdbMovieSummaryDetails;
  const plotSummary = plotSummaryFromTmdbOverview(movie.overview);
  const boxOffice = formatCompactUsdBoxOffice(movie.revenue ?? undefined);
  return {
    ...(plotSummary ? { plotSummary } : {}),
    ...(boxOffice ? { boxOffice } : {}),
  };
}

/**
 * 用 TMDb 详情填充系列节点 plotSummary / boxOffice（TMDb 为准，覆盖 GPT 缺失或空值）。
 *
 * @param node 系列节点
 * @param token TMDb Read Access Token
 */
async function enrichSeriesNodeFromTmdb(
  node: FilmDnaNode,
  token: string,
): Promise<FilmDnaNode> {
  let next: FilmDnaNode = { ...node };

  if (!next.posterUrl?.trim()) {
    next = await enrichNodePoster(next, token);
  }

  const movieId = await resolveSeriesNodeTmdbMovieId(next, token);
  if (!movieId) {
    console.warn(`${LOG_PREFIX} series node TMDb id unresolved`, {
      title: next.title,
      year: next.year,
    });
    return next;
  }

  next.tmdbMovieId = movieId;
  const meta = await fetchSeriesMetadataFromTmdb(movieId, token);

  if (meta.plotSummary) {
    next.plotSummary = meta.plotSummary;
  }
  if (meta.boxOffice) {
    next.boxOffice = meta.boxOffice;
  }

  // #region agent log
  agentDebugLog(
    "generate-film-dna/index.ts:enrichSeriesNodeFromTmdb",
    "TMDb series metadata enrich",
    {
      title: next.title,
      year: next.year,
      movieId,
      plotSummary: next.plotSummary ?? null,
      boxOffice: next.boxOffice ?? null,
      runId: "post-fix-v2",
    },
    "F",
  );
  // #endregion

  return next;
}

/**
 * 返回前最后一道关卡：为所有 seriesPrevious / seriesNext 强制写入 TMDb 摘要。
 *
 * @param tree Film DNA 树
 * @param token TMDb Read Access Token
 */
async function ensureSeriesNodesSummaries(
  tree: FilmDnaTree,
  token: string,
): Promise<FilmDnaTree> {
  const enrichSlot = async (
    nodes: FilmDnaNode[] | undefined,
    maxCount: number,
  ): Promise<FilmDnaNode[] | undefined> => {
    if (!nodes?.length) return undefined;
    return Promise.all(
      nodes
        .slice(0, maxCount)
        .map((node) => enrichSeriesNodeFromTmdb(node, token)),
    );
  };

  const seriesPrevious = await enrichSlot(
    tree.seriesPrevious,
    MAX_SERIES_PREVIOUS,
  );
  const seriesNext = await enrichSlot(tree.seriesNext, MAX_SERIES_NEXT);

  return {
    ...tree,
    ...(seriesPrevious?.length ? { seriesPrevious } : {}),
    ...(seriesNext?.length ? { seriesNext } : {}),
  };
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

  return applySeriesSummaryScope(
    applySignificanceScope(
      applySeriesLineageFlags(
        reconcileSeriesAndLegacy({
          center,
          left,
          right,
          ...(seriesPrevious.length ? { seriesPrevious } : {}),
          ...(seriesNext.length ? { seriesNext } : {}),
        }),
      ),
    ),
  );
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

const NON_CANONICAL_LINEAGE_RE =
  /\b(remake|re-?adaptation|readaptation|reboot|new adaptation|same source material|same story|different era|prior (film|version|adaptation)|earlier (film|version|adaptation)|tv version|stage version|based on the same|another adaptation)\b/i;

/**
 * 推断系列链上、下相邻节点是否应绘制垂直连线（无显式 API 字段时）。
 *
 * @param upper 链中上方节点
 * @param lower 链中下方节点
 */
function inferLineageConnectedAbove(
  upper: FilmDnaNode,
  lower: FilmDnaNode,
): boolean {
  if (filmNodesMatchTitle(upper, lower)) return false;
  const combined = `${upper.note} ${lower.note} ${upper.title} ${lower.title}`;
  if (NON_CANONICAL_LINEAGE_RE.test(combined)) return false;
  return true;
}

/**
 * 为系列链各节点补全 `lineageConnectedAbove`（保留 LLM 显式 `false`/`true`）。
 *
 * @param tree Film DNA 树
 */
function applySeriesLineageFlags(tree: FilmDnaTree): FilmDnaTree {
  const chain: FilmDnaNode[] = [
    ...(tree.seriesPrevious ?? []),
    tree.center,
    ...(tree.seriesNext ?? []),
  ];
  if (chain.length < 2) return tree;

  const resolved = chain.map((node, index) => {
    if (index === 0) return node;
    const upper = chain[index - 1];
    if (typeof node.lineageConnectedAbove === "boolean") return node;
    return {
      ...node,
      lineageConnectedAbove: inferLineageConnectedAbove(upper, node),
    };
  });

  const prevCount = tree.seriesPrevious?.length ?? 0;
  const nextCount = tree.seriesNext?.length ?? 0;
  const center = resolved[prevCount];
  const seriesPrevious = prevCount
    ? resolved.slice(0, prevCount)
    : undefined;
  const seriesNext = nextCount
    ? resolved.slice(prevCount + 1)
    : undefined;

  return {
    ...tree,
    center,
    ...(seriesPrevious?.length ? { seriesPrevious } : {}),
    ...(seriesNext?.length ? { seriesNext } : {}),
  };
}

/**
 * 垂直轴节点是否为同源/重拍/改编（非规范续集链）。
 *
 * @param node 系列轴节点
 * @param center 中心片
 */
function inferSameSourceVertical(
  node: FilmDnaNode,
  center: FilmDnaNode,
): boolean {
  if (typeof node.sameSourceVertical === "boolean") {
    return node.sameSourceVertical;
  }
  if (node.lineageConnectedAbove === true) return false;
  if (node.lineageConnectedAbove === false) return true;
  if (isSameStoryTitleAsCenter(node, center)) return true;
  const text = `${node.note} ${node.title}`;
  return NON_CANONICAL_LINEAGE_RE.test(text);
}

/**
 * 从节点移除 significance 相关字段。
 *
 * @param node 原始节点
 */
function stripSignificanceFields(node: FilmDnaNode): FilmDnaNode {
  const next = { ...node };
  delete next.significanceBullets;
  delete next.sameSourceVertical;
  return next;
}

/**
 * 从节点移除系列轴剧情/票房摘要字段。
 *
 * @param node 原始节点
 */
function stripSeriesSummaryFields(node: FilmDnaNode): FilmDnaNode {
  const next = { ...node };
  delete next.plotSummary;
  delete next.boxOffice;
  return next;
}

/**
 * 按槽位限制 plotSummary / boxOffice：仅 seriesPrevious / seriesNext 保留。
 *
 * @param tree Film DNA 树
 */
function applySeriesSummaryScope(tree: FilmDnaTree): FilmDnaTree {
  const center = stripSeriesSummaryFields(tree.center);
  const left = tree.left.map(stripSeriesSummaryFields);
  const right = tree.right.map(stripSeriesSummaryFields);

  const mapSeriesSlot = (nodes: FilmDnaNode[] | undefined) => {
    if (!nodes?.length) return undefined;
    return nodes.map((node) => {
      const scoped: FilmDnaNode = { ...node };
      const plotSummary = normalizePlotSummary(scoped.plotSummary);
      if (plotSummary) {
        scoped.plotSummary = plotSummary;
      } else {
        delete scoped.plotSummary;
      }
      const boxOffice = normalizeBoxOffice(scoped.boxOffice);
      if (boxOffice) {
        scoped.boxOffice = boxOffice;
      } else {
        delete scoped.boxOffice;
      }
      return scoped;
    });
  };

  const seriesPrevious = mapSeriesSlot(tree.seriesPrevious);
  const seriesNext = mapSeriesSlot(tree.seriesNext);

  return {
    center,
    left,
    right,
    ...(seriesPrevious?.length ? { seriesPrevious } : {}),
    ...(seriesNext?.length ? { seriesNext } : {}),
  };
}

/**
 * TMDb 系列槽覆盖时，按片名+年份保留 GPT 生成的剧情/票房摘要。
 *
 * @param target TMDb 节点
 * @param gptSources 覆盖前的 GPT 系列节点
 */
function mergeGptSeriesSummaryFields(
  target: FilmDnaNode,
  gptSources: FilmDnaNode[],
): FilmDnaNode {
  const match = gptSources.find(
    (s) => filmNodesMatchTitle(s, target) && s.year === target.year,
  );
  // #region agent log
  agentDebugLog(
    "generate-film-dna/index.ts:mergeGptSeriesSummaryFields",
    "TMDb merge title+year match",
    {
      targetTitle: target.title,
      targetYear: target.year,
      matched: Boolean(match),
      gptHasPlot: Boolean(match?.plotSummary?.trim()),
      gptHasBoxOffice: Boolean(match?.boxOffice?.trim()),
    },
    "C",
  );
  // #endregion
  if (!match) return target;
  const next = { ...target };
  if (typeof match.tmdbMovieId === "number" && match.tmdbMovieId > 0) {
    next.tmdbMovieId = match.tmdbMovieId;
  }
  const plotSummary = normalizePlotSummary(match.plotSummary);
  if (plotSummary) next.plotSummary = plotSummary;
  const boxOffice = normalizeBoxOffice(match.boxOffice);
  if (boxOffice) next.boxOffice = boxOffice;
  return next;
}

/**
 * @param tmdbNodes TMDb collection 节点
 * @param gptNodes 覆盖前的 GPT 系列节点
 */
function mergeGptSeriesSlot(
  tmdbNodes: FilmDnaNode[],
  gptNodes: FilmDnaNode[] | undefined,
): FilmDnaNode[] {
  if (!gptNodes?.length) return tmdbNodes;
  return tmdbNodes.map((node, index) => {
    const byTitle = mergeGptSeriesSummaryFields(node, gptNodes);
    const hasSummary = Boolean(byTitle.plotSummary?.trim()) ||
      Boolean(byTitle.boxOffice?.trim());
    if (hasSummary) return byTitle;
    const gptPeer = gptNodes[index];
    if (!gptPeer) return byTitle;
    return mergeGptSeriesSummaryFields(node, [gptPeer]);
  });
}

/**
 * 按槽位限制 significanceBullets：仅垂直轴同源/重拍/改编节点保留。
 *
 * @param tree Film DNA 树
 */
function applySignificanceScope(tree: FilmDnaTree): FilmDnaTree {
  const center = stripSignificanceFields(tree.center);
  const left = tree.left.map(stripSignificanceFields);
  const right = tree.right.map(stripSignificanceFields);

  const mapSeriesSlot = (nodes: FilmDnaNode[] | undefined) => {
    if (!nodes?.length) return undefined;
    return nodes.map((node) => {
      const eligible = inferSameSourceVertical(node, tree.center);
      const scoped: FilmDnaNode = {
        ...node,
        sameSourceVertical: eligible,
      };
      if (!eligible) {
        delete scoped.significanceBullets;
      } else if (scoped.significanceBullets) {
        scoped.significanceBullets = normalizeSignificanceBullets(
          scoped.significanceBullets,
        );
        if (!scoped.significanceBullets) delete scoped.significanceBullets;
      }
      return scoped;
    });
  };

  const seriesPrevious = mapSeriesSlot(tree.seriesPrevious);
  const seriesNext = mapSeriesSlot(tree.seriesNext);

  return {
    center,
    left,
    right,
    ...(seriesPrevious?.length ? { seriesPrevious } : {}),
    ...(seriesNext?.length ? { seriesNext } : {}),
  };
}

/**
 * 节点是否与 center 为同一故事/片名（重拍、改编轴用；非系列全集去重）。
 *
 * @param node 候选节点
 * @param center 中心片
 */
function isSameStoryTitleAsCenter(
  node: FilmDnaNode,
  center: FilmDnaNode,
): boolean {
  return filmNodesMatchTitle(node, center);
}

/**
 * 备注/标题是否像系列续作（误放入 `right[]` 时提升为 `seriesNext`）。
 * 仅匹配明确续作信号，避免把影史 Legacy 节点误判为系列续作。
 */
function isLikelySeriesContinuation(
  node: FilmDnaNode,
  center: FilmDnaNode,
): boolean {
  const text = `${node.note} ${node.title}`.toLowerCase();
  const hasCue =
    /\b(sequel|direct sequel|follow-up|follow up|next installment|next entry|part \d|#\d)\b/.test(
      text,
    );
  return hasCue && titlesShareFranchiseRoot(node.title, center.title);
}

/**
 * 备注/标题是否像系列前作（误放入 `left[]` 时提升为 `seriesPrevious`）。
 */
function isLikelySeriesPrequel(node: FilmDnaNode, center: FilmDnaNode): boolean {
  const text = `${node.note} ${node.title}`.toLowerCase();
  const hasCue =
    /\b(prequel|direct prequel|prior installment|previous installment|part \d|#\d)\b/.test(
      text,
    );
  return hasCue && titlesShareFranchiseRoot(node.title, center.title);
}

/**
 * 两标题是否可能属于同一系列命名（分集/Part 编号或共享词干）。
 *
 * @param a 标题 A
 * @param b 标题 B
 */
function titlesShareFranchiseRoot(a: string, b: string): boolean {
  const keyA = normalizeFilmTitleKey(a);
  const keyB = normalizeFilmTitleKey(b);
  if (keyA === keyB) return true;
  if (keyA.includes(keyB) || keyB.includes(keyA)) return true;
  const stripSequel = (s: string) =>
    s
      .replace(
        /\b(part|chapter|episode|vol\.?|volume)\s*\d+\b/gi,
        "",
      )
      .replace(/\s*:\s*.*$/, "")
      .replace(/\s+\d+$/, "")
      .trim();
  const rootA = stripSequel(keyA);
  const rootB = stripSequel(keyB);
  if (!rootA || !rootB) return false;
  return rootA === rootB || rootA.includes(rootB) || rootB.includes(rootA);
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
 * 中心年份是否可用于时间序校验。
 *
 * @param year 年份字段
 */
function isUsableFilmYear(year: number | null | undefined): year is number {
  return typeof year === "number" && Number.isFinite(year) && year > 0;
}

/**
 * Influence 节点年份是否严格早于 center（未知年份保留，由 prompt 约束补全）。
 *
 * @param nodeYear 关联片年份
 * @param centerYear 中心片年份
 */
function isChronologyValidForInfluence(
  nodeYear: number | null,
  centerYear: number | null,
): boolean {
  if (!isUsableFilmYear(centerYear)) return true;
  if (!isUsableFilmYear(nodeYear)) return true;
  return nodeYear < centerYear;
}

/**
 * Legacy 节点年份是否严格晚于 center（未知年份保留）。
 *
 * @param nodeYear 关联片年份
 * @param centerYear 中心片年份
 */
function isChronologyValidForLegacy(
  nodeYear: number | null,
  centerYear: number | null,
): boolean {
  if (!isUsableFilmYear(centerYear)) return true;
  if (!isUsableFilmYear(nodeYear)) return true;
  return nodeYear > centerYear;
}

/**
 * 剔除违反 Influence/Legacy/系列时间方向的节点（服务端硬约束）。
 *
 * @param tree 待校验树
 */
function enforceFilmDnaChronology(tree: FilmDnaTree): FilmDnaTree {
  const centerYear = isUsableFilmYear(tree.center.year)
    ? tree.center.year
    : null;

  const left = tree.left.filter((n) =>
    isChronologyValidForInfluence(n.year, centerYear),
  );
  const right = tree.right.filter((n) =>
    isChronologyValidForLegacy(n.year, centerYear),
  );

  return {
    ...tree,
    left,
    right,
    ...(tree.seriesPrevious?.length ? { seriesPrevious: tree.seriesPrevious } : {}),
    ...(tree.seriesNext?.length ? { seriesNext: tree.seriesNext } : {}),
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
    const sequelIdx = right.findIndex((n) =>
      isLikelySeriesContinuation(n, promoted.center),
    );
    if (sequelIdx !== -1) {
      seriesNext = [right.splice(sequelIdx, 1)[0]];
    }
  }

  if (!seriesPrevious.length) {
    const prequelIdx = left.findIndex((n) =>
      isLikelySeriesPrequel(n, promoted.center),
    );
    if (prequelIdx !== -1) {
      seriesPrevious = [left.splice(prequelIdx, 1)[0]];
    }
  }

  /** 仅当侧栏条目与 center 同片名且已上垂直轴时去重，避免系列全集标题误删 Influence/Legacy。 */
  const verticalHasSameStory = (slot: FilmDnaNode[] | undefined) =>
    (slot ?? []).some((n) => isSameStoryTitleAsCenter(n, promoted.center));

  if (verticalHasSameStory(seriesPrevious)) {
    left = left.filter((n) => !isSameStoryTitleAsCenter(n, promoted.center));
  }
  if (verticalHasSameStory(seriesNext)) {
    right = right.filter((n) => !isSameStoryTitleAsCenter(n, promoted.center));
  }

  const reconciled: FilmDnaTree = {
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

  return enforceFilmDnaChronology(reconciled);
}

/**
 * Film DNA 生成用 system prompt（Influence / Legacy 需满足可辩护的影史关联）。
 */
const FILM_DNA_SYSTEM_PROMPT = `You are a rigorous film historian. Given metadata about one film, output ONLY valid JSON (no markdown) with this exact shape:
{
  "center": { "title": string, "year": number|null, "note": string },
  "left": [{
    "title": string,
    "year": number|null,
    "note": string,
    "relationshipSummaryTitle": string,
    "relationshipBullets": string[]
  }],
  "right": [{
    "title": string,
    "year": number|null,
    "note": string,
    "relationshipSummaryTitle": string,
    "relationshipBullets": string[]
  }],
  "seriesPrevious": [{
    "title": string,
    "year": number|null,
    "note": string,
    "lineageConnectedAbove": boolean,
    "sameSourceVertical": boolean,
    "significanceBullets": string[],
    "plotSummary": string,
    "boxOffice": string
  }],
  "seriesNext": [{
    "title": string,
    "year": number|null,
    "note": string,
    "lineageConnectedAbove": boolean,
    "sameSourceVertical": boolean,
    "significanceBullets": string[],
    "plotSummary": string,
    "boxOffice": string
  }]
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

Chronology (HARD — never violate):
- Influence (left): ONLY films or series installments released BEFORE the center title's year.
  - When both years are known: node.year MUST be less than center.year.
  - NEVER place a later release in left[].
- Legacy (right): ONLY films or series installments released AFTER the center title's year.
  - When both years are known: node.year MUST be greater than center.year.
  - NEVER label an older title as Legacy. A film released before the center is NEVER right[].
- Same release year as center: omit from left[] and right[] (franchise continuity → seriesPrevious/seriesNext).
- If the related title's correct chronological slot is uncertain, OMIT it rather than guess.

Calibration example (Legacy for "12 Angry Men", 1957):
- GOOD: A Few Good Men, The Verdict, Anatomy of a Murder, Judgment at Nuremberg (courtroom/jury craft lineage).
- BAD: The Social Network (2010)—prestige drama with no rigorous cinematic legacy tie; omit.

Relationship groups (all may coexist—do NOT collapse into only the vertical axis):
- left[] + right[]: cinematic craft Influence / Legacy (0–3 each when defensible). ALWAYS try to populate independently of series slots.
- seriesPrevious[] + seriesNext[]: vertical lineage axis only (canonical sequels/prequels, remakes, re-adaptations, same-source different-era versions).
- A franchise installment on the vertical axis must NOT remove a different-title craft Influence/Legacy film from left/right.

Series slots:
- seriesPrevious: optional, 0–10 entries on the vertical axis above center, release-date order (oldest first). Canonical prequels, earlier same-story versions, remakes, re-adaptations, reboots, TV/stage prior versions.
- seriesNext: optional, 0–10 entries below center, release-date order. Canonical sequels, later same-story versions, remakes—NEVER craft-only Legacy successors (those stay in right[]).
- Remakes / re-adaptations / same-source different-era versions: seriesPrevious or seriesNext only (not left/right), any release year relative to center.
- Never put the same story title as center in left[] or right[]; use seriesPrevious/seriesNext for that property's other versions.
- Franchise films with different titles (e.g. numbered sequels) belong on the vertical axis, NOT in left/right unless they are also valid craft Influence/Legacy (rare—prefer one slot).
- lineageConnectedAbove (required on every seriesPrevious[] and seriesNext[] entry, and on center when it has seriesPrevious): boolean.
  - true ONLY when this entry is a canonical sequel/prequel/story continuation directly above it in the vertical chain (draw connecting line).
  - false for remakes, re-adaptations, reboots, or same source material in a different era (e.g. All Quiet on the Western Front 1930 above 2022)—still list on the axis, NO line.
  - Example: center = All Quiet (2022), seriesPrevious = [{ title: "All Quiet on the Western Front", year: 1930, lineageConnectedAbove: false, ... }].

When several films share the same documented craft lineage (e.g. courtroom/jury tradition, cyberpunk visual line), include the strongest documented examples up to three—still omitting weak prestige-only pairings.

Courtroom / jury dramas: Influence = earlier trial or deliberation lineage; Legacy = later films in that craft tradition—not unrelated modern prestige dramas.

Relationship summaries (required on every left[] and right[] entry you emit):
- relationshipSummaryTitle: one line ending with "through:" — film-study tone, not chat (still required in JSON; UI may hide it).
  - left (Influence): "{SourceTitle} influenced {CenterTitle} through:"
  - right (Legacy): "{CenterTitle} influenced {SuccessorTitle} through:"
- relationshipBullets: 2–4 items (max 4). Apply ONLY this style to bullets—not to note fields.

relationshipBullets writing style (Criterion / museum essay / film criticism):
- Tone: cinematic, analytical, film-literature oriented. Noun-phrase bullets, not tags or SEO keywords.
- Length: usually 2–6 words per bullet; concise; no periods.
- Case: sentence case—EVERY bullet MUST begin with a capital letter; capitalize proper nouns only elsewhere.
  - GOOD: "Industrial futurist aesthetics", "Expressionist set design"
  - BAD: "industrial futurist aesthetics", "use of stylized sets", "exploration of psychological themes"
- Form: cinematic noun phrases—NOT verb-led or meta phrases ("use of…", "exploration of…", "focus on…", "themes of…").
- Prefer: cinematic terminology, philosophical phrasing, visual language, worldbuilding and narrative craft terms.
- NEVER use in bullets:
  - "themes of", "explores", "discusses", "focuses on", "deals with", "use of", "exploration of", "focus on"
  - lowercase-first bullets of any kind
  - full sentences, conversational phrasing, recommendation-engine wording ("similar vibes", "fans of", "if you liked")
  - vague hype ("great movie", "dark atmosphere", "very philosophical", "iconic film")
  - bare genre/metadata labels without craft specificity ("sci-fi", "psychological", "dystopia" alone)
- GOOD bullet examples (match this register):
  - Expressionist set design
  - Psychological visual distortion
  - Stylized shadows and architecture
  - Industrial futurist aesthetics
  - Human identity under technological systems
  - Corporate dystopian futurism
  - Layered philosophical storytelling
  - Neo-noir urban density
  - Biotech class stratification
  - Psychological urban alienation
  - Ritualized masculine violence
  - Mechanical body horror
  - Mythic revenge structure
- BAD bullet examples (reject this register):
  - use of stylized sets and lighting
  - exploration of psychological themes
  - themes of technology and humanity
  - explores identity and society
  - discusses class systems
  - dark sci-fi atmosphere
  - very philosophical movie
- Name specific inherited craft (mise-en-scène grammar, narrative framing, world logic, genre lineage)—not generic praise.
- Reflect relationship subtype semantics without using internal taxonomy labels in the text.
- No markdown, no questions.
- Omit left/right entries entirely if you cannot write a defensible summary title AND at least 2 bullets in this style.

General:
- center must be the subject film (use the provided title and year when known).
- Never duplicate a film across left, right, seriesPrevious, and seriesNext.
- Each note: one short phrase, max 12 words, no URLs, no citations, no footnotes.
- Use English for notes and summaries. Real film titles only. Do not include posterUrl fields.
- seriesPrevious/seriesNext: note + lineageConnectedAbove + sameSourceVertical + optional plotSummary/boxOffice; no relationshipSummary fields.
- NEVER put significanceBullets, plotSummary, or boxOffice on center, left[], or right[].

Series hover summaries (seriesPrevious[] and seriesNext[] ONLY — NOT significanceBullets):
- REQUIRED on every seriesPrevious[] and seriesNext[] entry you emit: include plotSummary and/or boxOffice when you know them.
- plotSummary: one brief sentence (max ~28 words) summarizing that film's plot. Factual; no spoilers beyond setup; no marketing.
- boxOffice: widely reported worldwide or US theatrical gross when confident (e.g. "$136,400,000" or "$460,998,507").
- If you omit both, the server may backfill from TMDb when available—still prefer supplying them in JSON.
- NEVER use plotSummary/boxOffice on center, left[], or right[].
- Do NOT put plot recap or box office in significanceBullets.

Significance summaries (vertical-axis same-source / remake / re-adaptation ONLY):
- sameSourceVertical: required on every seriesPrevious[] and seriesNext[] entry.
  - true for remakes, re-adaptations, reboots, or another era's version of the same source story as center (lineageConnectedAbove should be false).
  - false for canonical sequels/prequels in the same continuity (lineageConnectedAbove true)—no significanceBullets on those entries.
- significanceBullets: ONLY when sameSourceVertical is true. 0–4 bullets on awards around release, social/cultural impact, historical significance.
- Natural phrasing; no plot recap; no marketing; not craft relationship summaries.
- Omit significanceBullets when sameSourceVertical is false or nothing defensible is known.`;

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

    // #region agent log
    if (parsed && typeof parsed === "object") {
      const gptRoot = parsed as Record<string, unknown>;
      agentDebugLog(
        "generate-film-dna/index.ts:gpt-raw",
        "GPT raw series slots before normalize",
        {
          seriesPrevious: seriesSummaryRawGptSnapshot(gptRoot.seriesPrevious),
          seriesNext: seriesSummaryRawGptSnapshot(gptRoot.seriesNext),
        },
        "A",
      );
    }
    // #endregion

    const tree = parseFilmDnaTree(parsed, title, fallbackYear);
    if (!tree) {
      console.error(`${LOG_PREFIX} invalid Film DNA shape`, parsed);
      return jsonError(500, {
        error: "Invalid Film DNA shape",
        message: "Could not normalize tree",
        details: "Parsed JSON did not match expected center/left/right shape.",
      });
    }

    // #region agent log
    agentDebugLog(
      "generate-film-dna/index.ts:post-parse",
      "After parseFilmDnaTree (normalize + reconcile)",
      {
        seriesPrevious: seriesSummaryDebugSnapshot(tree.seriesPrevious),
        seriesNext: seriesSummaryDebugSnapshot(tree.seriesNext),
      },
      "B",
    );
    console.log("seriesPrevious", tree.seriesPrevious);
    console.log("seriesNext", tree.seriesNext);
    // #endregion

    const tmdbToken = Deno.env.get("TMDB_READ_ACCESS_TOKEN")?.trim();
    let result: FilmDnaTree = tree;
    if (tmdbToken) {
      try {
        result = await applyTmdbSeriesToTree(
          tree,
          title,
          fallbackYear,
          tmdbToken,
        );
        result = await enrichFilmDnaTreePosters(result, tmdbToken);
        const posterCounts = {
          left: result.left.filter((n) => n.posterUrl).length,
          right: result.right.filter((n) => n.posterUrl).length,
          seriesPrevious: result.seriesPrevious?.filter((n) => n.posterUrl)
            .length ?? 0,
          seriesNext: result.seriesNext?.filter((n) => n.posterUrl).length ?? 0,
        };
        console.log(`${LOG_PREFIX} TMDb poster enrichment`, posterCounts);
      } catch (enrichErr) {
        console.error(`${LOG_PREFIX} TMDb enrichment failed`, enrichErr);
      }

      try {
        result = await ensureSeriesNodesSummaries(result, tmdbToken);
      } catch (seriesSummaryErr) {
        console.error(
          `${LOG_PREFIX} series summary enrichment failed`,
          seriesSummaryErr,
        );
      }
    } else {
      console.warn(
        `${LOG_PREFIX} TMDB_READ_ACCESS_TOKEN not set; skipping TMDb enrichment`,
      );
    }

    result = applySeriesSummaryScope(result);

    console.log(`${LOG_PREFIX} success`, {
      title,
      leftCount: result.left.length,
      rightCount: result.right.length,
      seriesPreviousCount: result.seriesPrevious?.length ?? 0,
      seriesNextCount: result.seriesNext?.length ?? 0,
    });

    console.log("[generate-film-dna] final series summaries", {
      seriesPrevious: result.seriesPrevious?.map((n) => ({
        title: n.title,
        year: n.year,
        plotSummary: n.plotSummary,
        boxOffice: n.boxOffice,
      })),
      seriesNext: result.seriesNext?.map((n) => ({
        title: n.title,
        year: n.year,
        plotSummary: n.plotSummary,
        boxOffice: n.boxOffice,
      })),
    });

    // #region agent log
    agentDebugLog(
      "generate-film-dna/index.ts:final-response",
      "Final HTTP response series slots",
      {
        seriesPrevious: seriesSummaryDebugSnapshot(result.seriesPrevious),
        seriesNext: seriesSummaryDebugSnapshot(result.seriesNext),
        runId: "post-fix-v2",
      },
      "E",
    );
    // #endregion

    return new Response(JSON.stringify(result), {
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
