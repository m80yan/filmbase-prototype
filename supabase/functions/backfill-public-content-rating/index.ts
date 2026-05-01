/// <reference lib="deno.ns" />
/**
 * Admin-only Edge Function：为 `filmbase_public_movies` 回填 `content_rating`（OMDb `Rated`）。
 *
 * Secrets（Supabase Dashboard → Edge Functions → Secrets）：
 * - `OMDB_API_KEY`：OMDb API Key
 * - `SERVICE_ROLE_KEY`：绕过 RLS 更新公共表
 * - `BACKFILL_PUBLIC_CONTENT_RATING_ADMIN_SECRET`：请求头 `X-Backfill-Admin-Secret` 必须一致
 *
 * 环境变量：`SUPABASE_URL`
 *
 * 规则：
 * - 仅处理 `movie_id` 以 `tt` 开头的行；其余跳过。
 * - 仅当 `content_rating` 为空或仅空白时更新；已有非空分级不覆盖。
 * - 仅更新 `content_rating`（及 `updated_at` 若存在）。
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const PUBLIC_TABLE = "filmbase_public_movies";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-backfill-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OmdbMovieResponse = {
  Response?: string;
  Rated?: string;
};

type PublicRow = {
  movie_id: string;
  title: string | null;
  content_rating: string | null;
};

type RowStatus = "updated" | "skipped" | "failed";

type PerRowResult = {
  movie_id: string;
  title: string;
  status: RowStatus;
  reason?: string;
  contentRating?: string;
};

type BackfillSummary = {
  totalRows: number;
  candidates: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: PerRowResult[];
};

/**
 * 常量时间比较 admin secret。
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

/** OMDb `Rated` → 存库字符串；`N/A` / 空 → `""`（调用方可据此跳过 update）。 */
function parseOmdbRated(json: OmdbMovieResponse): string {
  const r = json.Rated;
  if (typeof r !== "string") return "";
  const t = r.trim();
  if (!t || t === "N/A") return "";
  return t;
}

/**
 * 按 IMDb id 请求 OMDb，返回 `Rated` 分级字符串。
 */
async function fetchOmdbRated(imdbId: string, apiKey: string): Promise<string> {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("i", imdbId.toLowerCase());
  url.searchParams.set("apikey", apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  } catch {
    return "";
  }
  if (!res.ok) return "";

  let json: OmdbMovieResponse;
  try {
    json = (await res.json()) as OmdbMovieResponse;
  } catch {
    return "";
  }
  if (json.Response === "False") return "";
  return parseOmdbRated(json);
}

function isTtMovieId(id: string): boolean {
  return /^tt\d+$/i.test((id ?? "").trim());
}

function needsBackfill(row: PublicRow): boolean {
  if (!isTtMovieId(row.movie_id)) return false;
  const cr = row.content_rating;
  if (cr == null) return true;
  return typeof cr === "string" && cr.trim().length === 0;
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

  const adminSecret = Deno.env.get("BACKFILL_PUBLIC_CONTENT_RATING_ADMIN_SECRET");
  const provided = req.headers.get("X-Backfill-Admin-Secret") ?? "";
  if (!adminSecret?.trim()) {
    return new Response(
      JSON.stringify({
        error: "Server misconfiguration",
        message: "BACKFILL_PUBLIC_CONTENT_RATING_ADMIN_SECRET is not set",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  if (!timingSafeEqualString(provided, adminSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const omdbKey = Deno.env.get("OMDB_API_KEY");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!omdbKey?.trim()) {
    return new Response(
      JSON.stringify({
        error: "Server misconfiguration",
        message: "OMDB_API_KEY is not set",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
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
      },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error: selErr } = await supabase
    .from(PUBLIC_TABLE)
    .select("movie_id, title, content_rating");

  if (selErr) {
    return new Response(
      JSON.stringify({
        error: "Select failed",
        message: selErr.message,
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const all = (rows ?? []) as PublicRow[];
  const candidates = all.filter(needsBackfill);

  const summary: BackfillSummary = {
    totalRows: all.length,
    candidates: candidates.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    rows: [],
  };

  for (const row of candidates) {
    const movieId = row.movie_id ?? "";
    const titleLabel = row.title ?? "";

    try {
      const rated = await fetchOmdbRated(movieId, omdbKey);
      if (!rated) {
        summary.skipped++;
        summary.rows.push({
          movie_id: movieId,
          title: titleLabel,
          status: "skipped",
          reason: "omdb_empty_or_unrated",
        });
        continue;
      }

      const { error: upErr } = await supabase
        .from(PUBLIC_TABLE)
        .update({
          content_rating: rated,
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
        contentRating: rated,
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

    // 减轻 OMDb 免费档压力
    await new Promise((r) => setTimeout(r, 150));
  }

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
