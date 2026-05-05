/// <reference lib="deno.ns" />
/**
 * Supabase Edge Function：根据 IMDb URL 或 `tt` ID，从 TMDb 拉取并归一化影片元数据。
 *
 * Secrets（Dashboard → Edge Functions → Secrets）：
 * - `TMDB_READ_ACCESS_TOKEN`：TMDb Read Access Token（`Authorization: Bearer`）
 * - `OMDB_API_KEY`：OMDb API Key（仅服务端请求 `omdbapi.com`，不暴露给前端）
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

/**
 * TMDb `credits.cast` 在 enrich 响应与持久化前的条数上限（按 `order` 排序、姓名去重）。
 * 客户端 Poster Info Mode 仍只展示前 15 条 + 溢出占位行；此处保留「完整」卡司供该逻辑判断。
 */
const TMDB_BILLING_CAST_LIMIT = 500;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type TmdbFindResponse = {
  movie_results?: Array<{ id: number }>;
  tv_results?: Array<{ id: number }>;
};

type TmdbMovie = {
  title?: string;
  release_date?: string;
  runtime?: number | null;
  genres?: Array<{ name: string }>;
  poster_path?: string | null;
  overview?: string | null;
  tagline?: string | null;
  production_countries?: Array<{ name?: string }>;
  production_companies?: Array<{ name?: string }>;
  revenue?: number | null;
};

/** TMDb `/tv/{id}` 详情（与电影路径共用归一化逻辑的字段子集）。 */
type TmdbTv = {
  name?: string;
  original_name?: string;
  first_air_date?: string;
  episode_run_time?: number[];
  genres?: Array<{ name: string }>;
  poster_path?: string | null;
  overview?: string | null;
  tagline?: string | null;
  production_countries?: Array<{ name?: string }>;
  production_companies?: Array<{ name?: string }>;
  /** 用于季级 videos 回退（`season_number`， specials 常为 0）。 */
  seasons?: Array<{ season_number?: number }>;
};

type TmdbCrewMember = { job?: string; name?: string };
type TmdbCastMember = { name?: string; order?: number; character?: string | null };

type TmdbAltTitleEntry = { iso_3166_1?: string; title?: string };
type TmdbAltTitlesResponse = { titles?: TmdbAltTitleEntry[] };

type TmdbCredits = {
  crew?: TmdbCrewMember[];
  cast?: TmdbCastMember[];
};

type TmdbVideo = {
  type?: string;
  site?: string;
  official?: boolean;
  key?: string;
  name?: string;
};

type TmdbVideos = { results?: TmdbVideo[] };

type EnrichRequestBody = {
  imdbUrl?: string;
  imdbId?: string;
};

type CastDetailEntry = { name: string; character: string };

type EnrichSuccess = {
  mediaType: "movie" | "tv";
  title: string;
  year: number;
  runtime: string;
  genres: string[];
  director: string;
  cast: string[];
  posterUrl: string;
  trailerUrl: string | null;
  imdbRating: number;
  rottenTomatoes: number;
  contentRating: string;
  plot: string;
  writer: string;
  tagline: string;
  releaseDate: string;
  countryOfOrigin: string;
  alsoKnownAs: string[];
  productionCompanies: string[];
  boxOffice: string;
  castDetails: CastDetailEntry[];
};

type OmdbRatingEntry = { Source?: string; Value?: string };

type OmdbMovieResponse = {
  Response?: string;
  imdbRating?: string;
  Ratings?: OmdbRatingEntry[];
  Rated?: string;
  Plot?: string;
  Writer?: string;
  Released?: string;
  Country?: string;
  BoxOffice?: string;
};

/** OMDb 文本字段：空、`N/A` 视为缺失。 */
function omdbTextField(val: unknown): string {
  if (typeof val !== "string") return "";
  const t = val.trim();
  if (!t || t === "N/A") return "";
  return t;
}

const WRITER_CREW_JOBS = new Set(["Writer", "Screenplay", "Story"]);

/**
 * 从 TMDb crew 中收集 Writer / Screenplay / Story 姓名（去重、保序）。
 */
function extractWritersFromCrew(crew: TmdbCrewMember[] | undefined): string {
  if (!crew?.length) return "";
  const names: string[] = [];
  const seen = new Set<string>();
  for (const c of crew) {
    const job = c.job ?? "";
    if (!WRITER_CREW_JOBS.has(job) || !c.name?.trim()) continue;
    const key = c.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(c.name.trim());
  }
  return names.join(", ");
}

/**
 * TMDb `revenue`（美元整数）格式化为 USD 货币串；无效则 `""`。
 */
function formatUsdRevenue(revenue: number | null | undefined): string {
  if (revenue == null || typeof revenue !== "number" || !Number.isFinite(revenue) || revenue <= 0) {
    return "";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(revenue);
}

/**
 * 从 `alternative_titles` 取标题串：US 优先，其次常见英语区，去重，最多 5 条。
 */
function pickAlsoKnownAs(alt: TmdbAltTitlesResponse | null): string[] {
  const titles = alt?.titles ?? [];
  const englishish = new Set(["US", "GB", "CA", "AU", "NZ", "IE"]);
  const scored = titles
    .filter((t) => typeof t.title === "string" && t.title.trim())
    .map((t) => {
      const code = (t.iso_3166_1 ?? "").toUpperCase();
      const rank = code === "US" ? 0 : englishish.has(code) ? 1 : 2;
      return { title: t.title!.trim(), rank };
    })
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const { title } of scored) {
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * 取至多 `max` 位演员 `{ name, character }`（排序规则与 `extractCastTop` 一致）。
 */
function extractCastDetails(
  cast: TmdbCastMember[] | undefined,
  max = TMDB_BILLING_CAST_LIMIT
): CastDetailEntry[] {
  if (!cast?.length) return [];
  const fallbackOrder = 9999;
  const sorted = [...cast].sort((a, b) => {
    const oa = typeof a.order === "number" ? a.order : fallbackOrder;
    const ob = typeof b.order === "number" ? b.order : fallbackOrder;
    return oa - ob;
  });
  const out: CastDetailEntry[] = [];
  const seenName = new Set<string>();
  for (const c of sorted) {
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (!name) continue;
    const nk = name.toLowerCase();
    if (seenName.has(nk)) continue;
    seenName.add(nk);
    const character =
      typeof c.character === "string" ? c.character.trim() : "";
    out.push({ name, character });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 从 `imdbUrl` 或 `imdbId` 中解析出 `ttxxxxxxx`。
 */
function parseImdbTtId(body: EnrichRequestBody): string | null {
  const raw =
    typeof body.imdbId === "string" && body.imdbId.trim()
      ? body.imdbId.trim()
      : typeof body.imdbUrl === "string" && body.imdbUrl.trim()
        ? body.imdbUrl.trim()
        : null;
  if (!raw) return null;
  const m = raw.match(/tt\d+/i);
  return m ? m[0].toLowerCase() : null;
}

/**
 * 将 TMDb `runtime`（分钟）格式化为与前端一致的 `"xxx min"`。
 */
function formatRuntimeMinutes(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0 || !Number.isFinite(minutes)) return "";
  return `${Math.round(minutes)} min`;
}

/**
 * 从 TV `episode_run_time` 取第一个有效整数分钟数。
 *
 * @param times TMDb 返回的单集时长列表（分钟）
 */
function pickFirstEpisodeRunTimeMinutes(times: number[] | undefined): number | undefined {
  if (!Array.isArray(times)) return undefined;
  for (const n of times) {
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * 从 `release_date` 解析发行年份。
 */
function parseYear(releaseDate: string | undefined): number {
  if (!releaseDate || releaseDate.length < 4) return 0;
  const y = parseInt(releaseDate.slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

/**
 * 拼接海报完整 URL；无 `poster_path` 时返回空字符串。
 */
function posterUrlFromPath(posterPath: string | null | undefined): string {
  if (!posterPath) return "";
  return `${POSTER_BASE}${posterPath}`;
}

/**
 * 从 credits.crew 中取 `job === "Director"` 的姓名，多个用逗号连接。
 */
function extractDirectors(crew: TmdbCrewMember[] | undefined): string {
  if (!crew?.length) return "";
  const names = crew
    .filter((c) => c.job === "Director" && c.name)
    .map((c) => c.name as string);
  return [...new Set(names)].join(", ");
}

/**
 * 取至多 `max` 个演员姓名（按 TMDb `order` 升序；缺省 `order` 视为较大值，排在后面）。
 */
function extractCastTop(cast: TmdbCastMember[] | undefined, max = TMDB_BILLING_CAST_LIMIT): string[] {
  if (!cast?.length) return [];
  const fallbackOrder = 9999;
  const sorted = [...cast].sort((a, b) => {
    const oa = typeof a.order === "number" ? a.order : fallbackOrder;
    const ob = typeof b.order === "number" ? b.order : fallbackOrder;
    return oa - ob;
  });
  const names = sorted
    .slice(0, max)
    .map((c) => c.name)
    .filter((n): n is string => Boolean(n));
  return [...new Set(names)].slice(0, max);
}

/**
 * 从 TMDb videos 中选 YouTube 预告片：优先 `official === true` 的 Trailer，否则任意 Trailer。
 */
function pickYoutubeTrailerEmbed(videos: TmdbVideos | null): string | null {
  const results = videos?.results ?? [];
  const trailers = results.filter(
    (v) =>
      v.type === "Trailer" &&
      v.site === "YouTube" &&
      typeof v.key === "string" &&
      v.key.length > 0
  );
  if (!trailers.length) return null;
  const official = trailers.find((v) => v.official === true);
  const chosen = official ?? trailers[0];
  if (!chosen?.key) return null;
  return `https://www.youtube.com/embed/${chosen.key}`;
}

/**
 * 剧集专用：仅从 YouTube 的 Trailer / Teaser 中选 embed，顺序为
 * 官方 Trailer → 任意 Trailer → 官方 Teaser → 任意 Teaser；不使用 Clip / Featurette。
 *
 * @param videos TMDb `/tv/{id}/videos` 响应体
 */
function pickYoutubeTvTrailerOrTeaserEmbed(videos: TmdbVideos | null): string | null {
  const results = videos?.results ?? [];

  const pickOfficialFirst = (type: "Trailer" | "Teaser"): TmdbVideo | null => {
    const list = results.filter(
      (v) =>
        v.type === type &&
        v.site === "YouTube" &&
        typeof v.key === "string" &&
        v.key.length > 0
    );
    if (!list.length) return null;
    const official = list.find((v) => v.official === true);
    const chosen = official ?? list[0];
    return chosen ?? null;
  };

  const trailerPick = pickOfficialFirst("Trailer");
  if (trailerPick?.key) return `https://www.youtube.com/embed/${trailerPick.key}`;

  const teaserPick = pickOfficialFirst("Teaser");
  if (teaserPick?.key) return `https://www.youtube.com/embed/${teaserPick.key}`;

  return null;
}

/**
 * 调用 TMDb v3 API（使用 Read Access Token，Bearer 鉴权）。
 *
 * @param pathWithQuery 路径，可含查询串，例如 `/find/tt0111161?external_source=imdb_id`
 * @param token TMDb Read Access Token
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

/** TEMP：仅 TV 预告调试，确认后删除。 */
const TV_TRAILER_DEBUG_PREFIX = "[tv-trailer-debug]";

/**
 * TEMP：打印每条 video 的 site / type / name / key / official（JSON 一行）。
 *
 * @param label 日志前缀说明（如 show-level、season N）
 * @param videos TMDb videos 响应
 */
function logTvTrailerVideoRows(label: string, videos: TmdbVideos | null): void {
  const rows = (videos?.results ?? []).map((v) => ({
    site: v.site ?? null,
    type: v.type ?? null,
    name: typeof v.name === "string" ? v.name : null,
    key: typeof v.key === "string" ? v.key : null,
    official: v.official === true ? true : v.official === false ? false : null,
  }));
  console.log(`${TV_TRAILER_DEBUG_PREFIX} ${label}`, JSON.stringify(rows));
}

/**
 * TV：先试 show 级 videos；无命中则据 `/tv/{id}` 的 `seasons` 取最多 3 个正季号（升序）逐季请求
 * `/tv/{id}/season/{n}/videos`；仍无则最后试 specials（season 0）。每步使用 `pickYoutubeTvTrailerOrTeaserEmbed`，首条命中即返回。
 *
 * @param token TMDb Read Access Token
 * @param tmdbId TMDb TV id
 * @param showVideos show 级 `/tv/{id}/videos` 解析结果
 * @param tvDetail 已拉取的 `/tv/{id}` 详情（含 `seasons`）
 */
async function pickYoutubeTvTrailerAcrossShowAndSeasons(
  token: string,
  tmdbId: number,
  showVideos: TmdbVideos | null,
  tvDetail: TmdbTv,
): Promise<string | null> {
  console.log(`${TV_TRAILER_DEBUG_PREFIX} resolved tv tmdbId:`, tmdbId);
  logTvTrailerVideoRows("show-level videos", showVideos);

  let trailer = pickYoutubeTvTrailerOrTeaserEmbed(showVideos);
  if (trailer != null) {
    console.log(`${TV_TRAILER_DEBUG_PREFIX} final selected trailerUrl:`, trailer);
    return trailer;
  }

  const seasons = Array.isArray(tvDetail.seasons) ? tvDetail.seasons : [];
  const regularSeasonNumbers = [...new Set(
    seasons
      .map((s) => s.season_number)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0),
  )].sort((a, b) => a - b).slice(0, 3);

  for (const sn of regularSeasonNumbers) {
    console.log(`${TV_TRAILER_DEBUG_PREFIX} checking season:`, sn);
    const res = await tmdbFetch(`/tv/${tmdbId}/season/${sn}/videos`, token);
    if (!res.ok) {
      console.log(`${TV_TRAILER_DEBUG_PREFIX} season ${sn} videos fetch not ok, status:`, res.status);
      continue;
    }
    try {
      const j = (await res.json()) as TmdbVideos;
      logTvTrailerVideoRows(`season ${sn} videos`, j);
      trailer = pickYoutubeTvTrailerOrTeaserEmbed(j);
      if (trailer != null) {
        console.log(`${TV_TRAILER_DEBUG_PREFIX} final selected trailerUrl:`, trailer);
        return trailer;
      }
    } catch {
      /* 继续下一季 */
    }
  }

  console.log(`${TV_TRAILER_DEBUG_PREFIX} checking season:`, 0);
  const s0Res = await tmdbFetch(`/tv/${tmdbId}/season/0/videos`, token);
  if (!s0Res.ok) {
    console.log(`${TV_TRAILER_DEBUG_PREFIX} season 0 videos fetch not ok, status:`, s0Res.status);
  } else {
    try {
      const j = (await s0Res.json()) as TmdbVideos;
      logTvTrailerVideoRows("season 0 videos", j);
      trailer = pickYoutubeTvTrailerOrTeaserEmbed(j);
      if (trailer != null) {
        console.log(`${TV_TRAILER_DEBUG_PREFIX} final selected trailerUrl:`, trailer);
        return trailer;
      }
    } catch {
      /* 无预告 */
    }
  }

  console.log(`${TV_TRAILER_DEBUG_PREFIX} final selected trailerUrl:`, null);
  return null;
}

type OmdbBundle = {
  imdbRating: number;
  rottenTomatoes: number;
  contentRating: string;
  plot: string;
  writer: string;
  releaseDate: string;
  countryOfOrigin: string;
  boxOffice: string;
};

const OMDB_EMPTY: OmdbBundle = {
  imdbRating: 0,
  rottenTomatoes: 0,
  contentRating: "",
  plot: "",
  writer: "",
  releaseDate: "",
  countryOfOrigin: "",
  boxOffice: "",
};

/**
 * 从 OMDb 拉取评分与扩展元数据（服务端调用，密钥来自 `OMDB_API_KEY`）。
 * 缺失密钥、请求失败或 `Response === "False"` 时返回空串与 0 分，不抛错。
 */
async function fetchOmdbBundle(imdbId: string, apiKey: string | undefined): Promise<OmdbBundle> {
  if (!apiKey?.trim()) return { ...OMDB_EMPTY };

  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("i", imdbId);
  url.searchParams.set("apikey", apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  } catch {
    return { ...OMDB_EMPTY };
  }
  if (!res.ok) return { ...OMDB_EMPTY };

  let json: OmdbMovieResponse;
  try {
    json = (await res.json()) as OmdbMovieResponse;
  } catch {
    return { ...OMDB_EMPTY };
  }
  if (json.Response === "False") return { ...OMDB_EMPTY };

  let imdbRating = 0;
  const ir = json.imdbRating;
  if (typeof ir === "string" && ir.trim() && ir !== "N/A") {
    const p = parseFloat(ir);
    imdbRating = Number.isFinite(p) ? p : 0;
  }

  let rottenTomatoes = 0;
  const ratings = Array.isArray(json.Ratings) ? json.Ratings : [];
  const rt = ratings.find((r) => r.Source === "Rotten Tomatoes")?.Value;
  if (typeof rt === "string" && rt.trim() && rt !== "N/A") {
    const m = rt.match(/(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      rottenTomatoes = Number.isFinite(n) ? n : 0;
    }
  }

  /** OMDb `Rated`（如 PG-13 / R）；等价于 `omdb.Rated` 规范化后或 `""`。 */
  const contentRating = omdbTextField(json.Rated) || "";

  return {
    imdbRating,
    rottenTomatoes,
    contentRating,
    plot: omdbTextField(json.Plot),
    writer: omdbTextField(json.Writer),
    releaseDate: omdbTextField(json.Released),
    countryOfOrigin: omdbTextField(json.Country),
    boxOffice: omdbTextField(json.BoxOffice),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
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

  let body: EnrichRequestBody = {};
  try {
    if (req.method === "POST") {
      const text = await req.text();
      if (text) body = JSON.parse(text) as EnrichRequestBody;
    } else {
      const u = new URL(req.url);
      const imdbId = u.searchParams.get("imdbId");
      const imdbUrl = u.searchParams.get("imdbUrl");
      body = { imdbId: imdbId ?? undefined, imdbUrl: imdbUrl ?? undefined };
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ttId = parseImdbTtId(body);
  if (!ttId) {
    return new Response(
      JSON.stringify({
        error: "Bad request",
        message: "Missing or invalid imdbUrl / imdbId (expected tt…)",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const findRes = await tmdbFetch(
    `/find/${encodeURIComponent(ttId)}?external_source=imdb_id`,
    token
  );
  if (!findRes.ok) {
    const t = await findRes.text();
    return new Response(
      JSON.stringify({
        error: "TMDb find failed",
        status: findRes.status,
        detail: t.slice(0, 500),
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const findJson = (await findRes.json()) as TmdbFindResponse;
  const movieIdRaw = findJson.movie_results?.[0]?.id;
  const tvIdRaw = findJson.tv_results?.[0]?.id;
  const mediaType: "movie" | "tv" =
    movieIdRaw != null && Number.isFinite(movieIdRaw) ? "movie" : "tv";
  const tmdbId =
    mediaType === "movie"
      ? (movieIdRaw as number)
      : tvIdRaw != null && Number.isFinite(tvIdRaw)
        ? tvIdRaw
        : null;

  if (tmdbId == null) {
    return new Response(
      JSON.stringify({
        error: "Not found",
        message: `No TMDb movie or TV result for IMDb id ${ttId}`,
      }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const omdbKey = Deno.env.get("OMDB_API_KEY");
  const pathPrefix = mediaType === "movie" ? "movie" : "tv";

  const [detailRes, creditsRes, videosRes, altTitlesRes, omdb] = await Promise.all([
    tmdbFetch(`/${pathPrefix}/${tmdbId}`, token),
    tmdbFetch(`/${pathPrefix}/${tmdbId}/credits`, token),
    tmdbFetch(`/${pathPrefix}/${tmdbId}/videos`, token),
    tmdbFetch(`/${pathPrefix}/${tmdbId}/alternative_titles`, token),
    fetchOmdbBundle(ttId, omdbKey),
  ]);

  if (!detailRes.ok) {
    const t = await detailRes.text();
    return new Response(
      JSON.stringify({
        error: mediaType === "movie" ? "TMDb movie failed" : "TMDb tv failed",
        status: detailRes.status,
        detail: t.slice(0, 500),
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const credits: TmdbCredits = creditsRes.ok
    ? ((await creditsRes.json()) as TmdbCredits)
    : {};
  const videos: TmdbVideos | null = videosRes.ok
    ? ((await videosRes.json()) as TmdbVideos)
    : null;
  const altTitlesJson: TmdbAltTitlesResponse | null = altTitlesRes.ok
    ? ((await altTitlesRes.json()) as TmdbAltTitlesResponse)
    : null;

  let payload: EnrichSuccess;

  if (mediaType === "movie") {
    const movie = (await detailRes.json()) as TmdbMovie;
    const overview = typeof movie.overview === "string" ? movie.overview.trim() : "";
    const tmdbWriterFallback = extractWritersFromCrew(credits.crew);
    const tmdbCountries = (movie.production_countries ?? [])
      .map((c) => (typeof c.name === "string" ? c.name.trim() : ""))
      .filter(Boolean)
      .join(", ");
    const tmdbBoxOffice = formatUsdRevenue(movie.revenue ?? undefined);
    const omdbBox = omdb.boxOffice;

    payload = {
      mediaType: "movie",
      title: movie.title ?? "",
      year: parseYear(movie.release_date),
      runtime: formatRuntimeMinutes(movie.runtime ?? undefined),
      genres: (movie.genres ?? []).map((g) => g.name).filter(Boolean),
      director: extractDirectors(credits.crew),
      cast: extractCastTop(credits.cast),
      posterUrl: posterUrlFromPath(movie.poster_path),
      trailerUrl: pickYoutubeTrailerEmbed(videos),
      imdbRating: omdb.imdbRating,
      rottenTomatoes: omdb.rottenTomatoes,
      contentRating: omdb.contentRating,
      plot: omdb.plot || overview,
      writer: omdb.writer || tmdbWriterFallback,
      tagline: typeof movie.tagline === "string" ? movie.tagline.trim() : "",
      releaseDate: omdb.releaseDate || (typeof movie.release_date === "string" ? movie.release_date.trim() : ""),
      countryOfOrigin: omdb.countryOfOrigin || tmdbCountries,
      alsoKnownAs: pickAlsoKnownAs(altTitlesJson),
      productionCompanies: (movie.production_companies ?? [])
        .map((c) => (typeof c.name === "string" ? c.name.trim() : ""))
        .filter(Boolean),
      boxOffice: omdbBox || tmdbBoxOffice,
      castDetails: extractCastDetails(credits.cast),
    };
  } else {
    const tv = (await detailRes.json()) as TmdbTv;
    const overview = typeof tv.overview === "string" ? tv.overview.trim() : "";
    const tmdbWriterFallback = extractWritersFromCrew(credits.crew);
    const tmdbCountries = (tv.production_countries ?? [])
      .map((c) => (typeof c.name === "string" ? c.name.trim() : ""))
      .filter(Boolean)
      .join(", ");
    const omdbBox = omdb.boxOffice;

    const title =
      typeof tv.name === "string" && tv.name.trim()
        ? tv.name.trim()
        : typeof tv.original_name === "string"
          ? tv.original_name.trim()
          : "";

    const trailerUrl = await pickYoutubeTvTrailerAcrossShowAndSeasons(token, tmdbId, videos, tv);

    payload = {
      mediaType: "tv",
      title,
      year: parseYear(tv.first_air_date),
      runtime: formatRuntimeMinutes(pickFirstEpisodeRunTimeMinutes(tv.episode_run_time)),
      genres: (tv.genres ?? []).map((g) => g.name).filter(Boolean),
      director: extractDirectors(credits.crew),
      cast: extractCastTop(credits.cast),
      posterUrl: posterUrlFromPath(tv.poster_path),
      trailerUrl,
      imdbRating: omdb.imdbRating,
      rottenTomatoes: omdb.rottenTomatoes,
      contentRating: omdb.contentRating,
      plot: omdb.plot || overview,
      writer: omdb.writer || tmdbWriterFallback,
      tagline: typeof tv.tagline === "string" ? tv.tagline.trim() : "",
      releaseDate:
        omdb.releaseDate ||
        (typeof tv.first_air_date === "string" ? tv.first_air_date.trim() : ""),
      countryOfOrigin: omdb.countryOfOrigin || tmdbCountries,
      alsoKnownAs: pickAlsoKnownAs(altTitlesJson),
      productionCompanies: (tv.production_companies ?? [])
        .map((c) => (typeof c.name === "string" ? c.name.trim() : ""))
        .filter(Boolean),
      boxOffice: omdbBox,
      castDetails: extractCastDetails(credits.cast),
    };
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
