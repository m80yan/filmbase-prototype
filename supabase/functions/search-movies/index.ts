/// <reference lib="deno.ns" />
/**
 * Edge Function：按关键词调用 TMDb `/search/movie`，返回归一化轻量建议项（不把 Token 暴露给客户端）。
 *
 * 工作流：
 * 1. `GET /search/movie?query=…` 取候选。
 * 2. 截取前 `MAX_RESULTS = 8` 条，并行 `GET /movie/{id}/external_ids` 取 `imdb_id`。
 * 3. 不在此处抓 plot/writer/cast/boxOffice 等完整元数据；选定后由 `enrich-movie-from-imdb` 处理。
 *
 * Secrets（Supabase Dashboard → Edge Functions → Secrets）：
 * - `TMDB_READ_ACCESS_TOKEN`：TMDb Read Access Token（`Authorization: Bearer`）
 *
 * 请求：
 * - `GET`：`?query=…` 必填；可选 `year`（数字）、`page`（≥1，默认 1）
 * - `POST`：JSON `{ "query": string, "year"?: number, "page"?: number }`
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const MAX_RESULTS = 8;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type SearchRequestBody = {
  query?: string;
  year?: number;
  page?: number;
};

type TmdbSearchMovieResult = {
  id?: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  overview?: string | null;
  popularity?: number;
  vote_average?: number;
};

type TmdbSearchMovieResponse = {
  page?: number;
  results?: TmdbSearchMovieResult[];
  total_pages?: number;
  total_results?: number;
};

type TmdbExternalIdsResponse = {
  imdb_id?: string | null;
};

/** 单条影片摘要（返回给调用方）。 */
type MovieSearchHit = {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  originalTitle: string;
  releaseDate: string;
  year: number | null;
  posterUrl: string | null;
  overview: string;
  popularity: number;
  voteAverage: number;
};

type SearchMoviesSuccess = {
  page: number;
  totalPages: number;
  totalResults: number;
  results: MovieSearchHit[];
};

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
 * 从 `release_date`（`YYYY-MM-DD`）解析年份；无效则 `null`。
 */
function parseYearFromReleaseDate(rd: string | undefined): number | null {
  if (typeof rd !== "string" || rd.length < 4) return null;
  const y = parseInt(rd.slice(0, 4), 10);
  return Number.isFinite(y) && y > 0 ? y : null;
}

/**
 * 由 `poster_path` 生成 w500 海报 URL；无图则 `null`。
 */
function posterUrlFromPath(path: string | null | undefined): string | null {
  if (typeof path !== "string" || !path.trim()) return null;
  return `${POSTER_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * 将 TMDb 单条 `results[]` 映射为 `MovieSearchHit`；缺 `id` 的项跳过。
 */
function mapResult(r: TmdbSearchMovieResult): MovieSearchHit | null {
  const id = r.id;
  if (id == null || !Number.isFinite(id)) return null;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  const originalTitle =
    typeof r.original_title === "string" ? r.original_title.trim() : "";
  const releaseDate =
    typeof r.release_date === "string" ? r.release_date.trim() : "";
  const overview = typeof r.overview === "string" ? r.overview.trim() : "";
  return {
    tmdbId: id,
    imdbId: null,
    title,
    originalTitle,
    releaseDate,
    year: parseYearFromReleaseDate(releaseDate),
    posterUrl: posterUrlFromPath(r.poster_path ?? null),
    overview,
    popularity: typeof r.popularity === "number" && Number.isFinite(r.popularity) ? r.popularity : 0,
    voteAverage:
      typeof r.vote_average === "number" && Number.isFinite(r.vote_average) ? r.vote_average : 0,
  };
}

/**
 * 校验并归一化 TMDb 返回的 `imdb_id`：必须形如 `tt\d+`，否则视为缺失返回 `null`。
 */
function normalizeImdbId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return /^tt\d+$/.test(t) ? t : null;
}

/**
 * 抓取单部影片的 `external_ids`，返回 `imdb_id`（无则 `null`）。任何错误（网络/HTTP/JSON）静默吞掉，
 * 由调用方将该项的 `imdbId` 维持为 `null`，从而不会因单条失败而拖垮整个搜索响应。
 */
async function fetchImdbIdForTmdb(
  tmdbId: number,
  token: string
): Promise<string | null> {
  try {
    const res = await tmdbFetch(`/movie/${tmdbId}/external_ids`, token);
    if (!res.ok) return null;
    const json = (await res.json()) as TmdbExternalIdsResponse;
    return normalizeImdbId(json.imdb_id);
  } catch {
    return null;
  }
}

/**
 * 校验并裁剪搜索关键词；空串返回 `null`。
 */
function normalizeQuery(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim();
  if (!q) return null;
  if (q.length > 200) return q.slice(0, 200);
  return q;
}

/**
 * 解析 `year`：正整数且在合理范围则返回，否则 `undefined`（不传 TMDb）。
 */
function normalizeYear(y: unknown): number | undefined {
  if (y == null) return undefined;
  const n = typeof y === "number" ? y : typeof y === "string" ? parseInt(String(y).trim(), 10) : NaN;
  if (!Number.isFinite(n) || n < 1874 || n > 2100) return undefined;
  return Math.floor(n);
}

/**
 * 解析分页：默认 1，限制在 1–500（与 TMDb 常见上限对齐）。
 */
function normalizePage(p: unknown): number {
  const n = typeof p === "number" ? p : typeof p === "string" ? parseInt(String(p).trim(), 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(500, Math.floor(n));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = Deno.env.get("TMDB_READ_ACCESS_TOKEN");
  if (!token?.trim()) {
    return new Response(
      JSON.stringify({
        error: "Server misconfiguration",
        message: "TMDB_READ_ACCESS_TOKEN is not set",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  let queryStr: string | null = null;
  let yearOpt: number | undefined;
  let pageNum = 1;

  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      queryStr = normalizeQuery(u.searchParams.get("query") ?? undefined);
      yearOpt = normalizeYear(u.searchParams.get("year"));
      pageNum = normalizePage(u.searchParams.get("page"));
    } else {
      const text = await req.text();
      const body: SearchRequestBody = text ? (JSON.parse(text) as SearchRequestBody) : {};
      queryStr = normalizeQuery(body.query);
      yearOpt = normalizeYear(body.year);
      pageNum = normalizePage(body.page);
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!queryStr) {
    return new Response(
      JSON.stringify({
        error: "Bad request",
        message: "Missing or empty query (max 200 characters)",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const qEnc = encodeURIComponent(queryStr);
  const parts = [`/search/movie?query=${qEnc}`, `page=${pageNum}`];
  if (yearOpt != null) parts.push(`year=${yearOpt}`);
  const path = parts.join("&");

  const res = await tmdbFetch(path, token);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    return new Response(
      JSON.stringify({
        error: "TMDb search failed",
        status: res.status,
        detail,
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const json = (await res.json()) as TmdbSearchMovieResponse;
  const rawResults = Array.isArray(json.results) ? json.results : [];
  const mapped: MovieSearchHit[] = [];
  for (const r of rawResults) {
    const hit = mapResult(r);
    if (hit) mapped.push(hit);
    if (mapped.length >= MAX_RESULTS) break;
  }

  const imdbIds = await Promise.all(
    mapped.map((hit) => fetchImdbIdForTmdb(hit.tmdbId, token))
  );
  for (let i = 0; i < mapped.length; i++) {
    mapped[i].imdbId = imdbIds[i];
  }

  // 稳定排序：有 imdbId 的项优先（相对原顺序保持），便于前端把可直接 enrich 的候选放在前面。
  const indexed = mapped.map((hit, idx) => ({ hit, idx }));
  indexed.sort((a, b) => {
    const av = a.hit.imdbId ? 0 : 1;
    const bv = b.hit.imdbId ? 0 : 1;
    if (av !== bv) return av - bv;
    return a.idx - b.idx;
  });
  const results = indexed.map((x) => x.hit);

  const page = typeof json.page === "number" && Number.isFinite(json.page) ? json.page : pageNum;
  const totalPages =
    typeof json.total_pages === "number" && Number.isFinite(json.total_pages) ? json.total_pages : 0;
  const totalResults =
    typeof json.total_results === "number" && Number.isFinite(json.total_results)
      ? json.total_results
      : results.length;

  const payload: SearchMoviesSuccess = {
    page,
    totalPages,
    totalResults,
    results,
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
