/// <reference lib="deno.ns" />
/**
 * Admin-only Edge Function：为 `filmbase_public_movies` 安全回填 `cast_members`（最多 15 人），并更新 `updated_at`。
 *
 * Secrets（Supabase Dashboard → Edge Functions → Secrets）：
 * - `TMDB_READ_ACCESS_TOKEN`：TMDb API Read Access Token（`Authorization: Bearer`）
 * - `SERVICE_ROLE_KEY`：用于绕过 RLS 更新公共表
 * - `BACKFILL_PUBLIC_CAST_ADMIN_SECRET`：调用方必须在请求头 `X-Backfill-Admin-Secret` 中携带相同值
 *
 * 环境变量（Edge 默认注入）：
 * - `SUPABASE_URL`
 *
 * 不修改：海报、评分、预告片、标题、年份、runtime、genre、director 等列。
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const TMDB_BASE = "https://api.themoviedb.org/3";
const PUBLIC_TABLE = "filmbase_public_movies";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-backfill-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TmdbFindResponse = {
  movie_results?: Array<{ id: number }>;
};

type TmdbCastMember = { name?: string; order?: number };

type TmdbCredits = {
  cast?: TmdbCastMember[];
};

type SearchResult = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  popularity?: number;
};

type TmdbSearchResponse = {
  results?: SearchResult[];
};

type PublicMovieRow = {
  movie_id: string;
  title: string | null;
  year: number | null;
  cast_members: string[] | null;
};

type RowStatus = "updated" | "skipped" | "failed";

type PerRowResult = {
  movie_id: string;
  title: string;
  status: RowStatus;
  reason?: string;
  castCount?: number;
};

type BackfillSummary = {
  totalCandidates: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: PerRowResult[];
};

/**
 * 常量时间比较字符串（用于 admin secret）。
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/**
 * 调用 TMDb v3（Read Access Token + Bearer）。
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
 * 从 credits.cast 取前 `max` 位演员姓名（按 `order` 升序）。
 */
function extractCastTop(cast: TmdbCastMember[] | undefined, max = 15): string[] {
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

function castMemberLength(row: PublicMovieRow): number {
  if (!Array.isArray(row.cast_members)) return 0;
  return row.cast_members.length;
}

/**
 * 规范化标题用于搜索匹配（与 App 侧 identity 风格接近：小写、trim、合并空白）。
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
 * 在 TMDb `/search/movie` 结果中选取最可信的 `movie` id；不确定时返回 `null`（跳过该行）。
 */
function pickTmdbMovieIdFromSearch(
  results: SearchResult[],
  rowTitle: string,
  rowYear: number
): number | null {
  if (!results?.length) return null;
  const nt = normalizeTitleForMatch(rowTitle);
  if (!nt) return null;

  let pool = results;
  if (rowYear > 0) {
    const band = results.filter((r) => {
      const y = releaseYearFromDate(r.release_date);
      return Number.isFinite(y) && Math.abs(y - rowYear) <= 1;
    });
    if (band.length) pool = band;
  }

  const exactTitle = (r: SearchResult) => {
    const t1 = r.title ? normalizeTitleForMatch(r.title) : "";
    const t2 = r.original_title ? normalizeTitleForMatch(r.original_title) : "";
    return t1 === nt || t2 === nt;
  };

  const looseTitle = (r: SearchResult) => {
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
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) {
    exact.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return exact[0].id;
  }

  if (pool.length === 1) {
    const r = pool[0];
    const y = releaseYearFromDate(r.release_date);
    const yOk =
      rowYear <= 0 || (Number.isFinite(y) && Math.abs(y - rowYear) <= 1);
    if (yOk && looseTitle(r)) return r.id;
  }

  return null;
}

/**
 * 通过 IMDb `tt…` → TMDb find → credits，返回最多 15 个演员名；失败或无 cast 返回 `null`。
 */
async function fetchCastFromImdbMovieId(
  imdbMovieId: string,
  token: string
): Promise<string[] | null> {
  const tt = imdbMovieId.toLowerCase().startsWith("tt")
    ? imdbMovieId.toLowerCase()
    : null;
  if (!tt) return null;

  const findRes = await tmdbFetch(
    `/find/${encodeURIComponent(tt)}?external_source=imdb_id`,
    token
  );
  if (!findRes.ok) return null;
  const findJson = (await findRes.json()) as TmdbFindResponse;
  const tmdbId = findJson.movie_results?.[0]?.id;
  if (tmdbId == null || !Number.isFinite(tmdbId)) return null;

  const creditsRes = await tmdbFetch(`/movie/${tmdbId}/credits`, token);
  if (!creditsRes.ok) return null;
  const credits = (await creditsRes.json()) as TmdbCredits;
  const cast = extractCastTop(credits.cast, 15);
  return cast.length ? cast : null;
}

/**
 * 通过标题 + 年份搜索 TMDb → credits，返回最多 15 个演员名；无把握匹配或无 cast 返回 `null`。
 */
async function fetchCastFromTitleYear(
  title: string,
  year: number,
  token: string
): Promise<string[] | null> {
  const q = encodeURIComponent(title.trim());
  if (!q) return null;
  const path =
    year > 0
      ? `/search/movie?query=${q}&year=${year}`
      : `/search/movie?query=${q}`;
  const res = await tmdbFetch(path, token);
  if (!res.ok) return null;
  const json = (await res.json()) as TmdbSearchResponse;
  const results = json.results ?? [];
  const tmdbId = pickTmdbMovieIdFromSearch(results, title, year);
  if (tmdbId == null) return null;

  const creditsRes = await tmdbFetch(`/movie/${tmdbId}/credits`, token);
  if (!creditsRes.ok) return null;
  const credits = (await creditsRes.json()) as TmdbCredits;
  const cast = extractCastTop(credits.cast, 15);
  return cast.length ? cast : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminSecret = Deno.env.get("BACKFILL_PUBLIC_CAST_ADMIN_SECRET");
  const provided = req.headers.get("X-Backfill-Admin-Secret") ?? "";
  if (!adminSecret?.trim()) {
    return new Response(
      JSON.stringify({
        error: "Server misconfiguration",
        message: "BACKFILL_PUBLIC_CAST_ADMIN_SECRET is not set",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
  if (!timingSafeEqualString(provided, adminSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tmdbToken = Deno.env.get("TMDB_READ_ACCESS_TOKEN");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!tmdbToken?.trim()) {
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
  if (!serviceKey?.trim() || !supabaseUrl?.trim()) {
    return new Response(
      JSON.stringify({
        error: "Server misconfiguration",
        message: "SUPABASE_URL or SERVICE_ROLE_KEY is not set",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error: selErr } = await supabase
    .from(PUBLIC_TABLE)
    .select("movie_id, title, year, cast_members");

  if (selErr) {
    return new Response(
      JSON.stringify({
        error: "Select failed",
        message: selErr.message,
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const candidates = (rows ?? []).filter(
    (r) => castMemberLength(r as PublicMovieRow) <= 3
  ) as PublicMovieRow[];

  const summary: BackfillSummary = {
    totalCandidates: candidates.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    rows: [],
  };

  for (const row of candidates) {
    const titleLabel = row.title ?? "";
    const movieId = row.movie_id ?? "";

    try {
      let cast: string[] | null = null;
      if (movieId.toLowerCase().startsWith("tt")) {
        cast = await fetchCastFromImdbMovieId(movieId, tmdbToken);
        if (!cast?.length) {
          summary.skipped++;
          summary.rows.push({
            movie_id: movieId,
            title: titleLabel,
            status: "skipped",
            reason: "no_tmdb_match_or_empty_cast",
          });
          continue;
        }
      } else {
        cast = await fetchCastFromTitleYear(
          titleLabel,
          typeof row.year === "number" ? row.year : 0,
          tmdbToken
        );
        if (!cast?.length) {
          summary.skipped++;
          summary.rows.push({
            movie_id: movieId,
            title: titleLabel,
            status: "skipped",
            reason: "no_confident_search_match_or_empty_cast",
          });
          continue;
        }
      }

      const { error: upErr } = await supabase
        .from(PUBLIC_TABLE)
        .update({
          cast_members: cast,
          updated_at: new Date().toISOString(),
        })
        .eq("movie_id", movieId);

      if (upErr) {
        summary.failed++;
        summary.rows.push({
          movie_id: movieId,
          title: titleLabel,
          status: "failed",
          reason: upErr.message,
        });
        continue;
      }

      summary.updated++;
      summary.rows.push({
        movie_id: movieId,
        title: titleLabel,
        status: "updated",
        castCount: cast.length,
      });
    } catch (e) {
      summary.failed++;
      summary.rows.push({
        movie_id: movieId,
        title: titleLabel,
        status: "failed",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
