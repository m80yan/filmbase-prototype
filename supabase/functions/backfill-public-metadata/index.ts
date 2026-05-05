/// <reference lib="deno.ns" />
/**
 * Admin-only Edge Function：为 `filmbase_public_movies` 回填扩展元数据，供后续 UI 展示。
 *
 * 目标列（仅在原值缺失/空时写入；已有非空值不覆盖）：
 *   plot, writer, tagline, release_date, country_of_origin,
 *   also_known_as, production_companies, box_office, cast_details, content_rating
 *
 * 行为约束：
 * - 仅处理 `movie_id` 以 `tt` 开头的行；其余跳过。
 * - 通过 HTTP 复用 `enrich-movie-from-imdb`（共享 TMDb / OMDb 抓取与归一化）。
 * - 不动 `poster_url` / `poster_storage_path` / `trailer_url`：
 *   即便它们为空，也由其他流程负责回填，避免与海报/预告片专用回填抢先。
 * - 每行处理之间留 ~150–300ms，避免 OMDb / TMDb 速率限制。
 *
 * 定向模式（POST JSON，与全表回填共用 admin secret）：
 * `{ "movieId": "tt0076759", "overwriteCastDetails": true }` — 仅更新该行的
 * `cast_details` 与 `updated_at`，不进入全表扫描。
 *
 * 批量刷新「偏短」卡司（`cast_details` 非空数组且长度 ≤ 15 的 `tt…` 行）：
 * `{ "overwriteCastDetails": true, "refreshTruncatedCastDetails": true, "limit": 50 }`
 * — 仅当 enrich 后净卡司条数大于当前长度时更新 `cast_details` 与 `updated_at`。
 *
 * Secrets（Supabase Dashboard → Edge Functions → Secrets）：
 * - `BACKFILL_PUBLIC_METADATA_ADMIN_SECRET`：请求头 `X-Backfill-Admin-Secret` 必须一致
 * - `SERVICE_ROLE_KEY`：绕过 RLS 写入公共表 + 调用 `enrich-movie-from-imdb`
 *
 * 环境变量（Edge 默认注入）：
 * - `SUPABASE_URL`
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const PUBLIC_TABLE = "filmbase_public_movies";

/**
 * 每行处理后的等待毫秒（取 [PER_ROW_DELAY_MIN_MS, PER_ROW_DELAY_MAX_MS] 内随机），
 * 用 jitter 减少与 OMDb / TMDb 同步突发压力。
 */
const PER_ROW_DELAY_MIN_MS = 150;
const PER_ROW_DELAY_MAX_MS = 300;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-backfill-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CastDetailEntry = { name: string; character: string };

/** 与 `enrich-movie-from-imdb` 返回 JSON 同构（仅本回填用到的字段）。 */
type EnrichSuccess = {
  plot?: string;
  writer?: string;
  tagline?: string;
  releaseDate?: string;
  countryOfOrigin?: string;
  alsoKnownAs?: string[];
  productionCompanies?: string[];
  boxOffice?: string;
  castDetails?: CastDetailEntry[];
  contentRating?: string;
};

type PublicRow = {
  movie_id: string;
  title: string | null;
  plot: string | null;
  writer: string | null;
  tagline: string | null;
  release_date: string | null;
  country_of_origin: string | null;
  also_known_as: string[] | null;
  production_companies: string[] | null;
  box_office: string | null;
  cast_details: unknown;
  content_rating: string | null;
};

type RowStatus = "updated" | "skipped" | "failed";

type PerRowResult = {
  movie_id: string;
  title: string;
  status: RowStatus;
  updatedFields: string[];
  error?: string;
};

type BackfillSummary = {
  totalRows: number;
  candidates: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: PerRowResult[];
};

/** 批量刷新偏短 `cast_details` 时，单行结果摘要。 */
type TruncatedCastBatchRowResult = {
  movieId: string;
  oldCount: number;
  newCount: number;
  status: RowStatus;
  message?: string;
};

/** 批量刷新偏短 `cast_details` 的响应体。 */
type TruncatedCastBatchSummary = {
  mode: "refresh_truncated_cast_details";
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: TruncatedCastBatchRowResult[];
};

/** 常量时间字符串比较，用于 admin secret。 */
function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

function isTtMovieId(id: string | null | undefined): boolean {
  return /^tt\d+$/i.test((id ?? "").trim());
}

function isEmptyText(v: string | null | undefined): boolean {
  return v == null || (typeof v === "string" && v.trim().length === 0);
}

function isEmptyStringArray(v: string[] | null | undefined): boolean {
  if (!Array.isArray(v)) return true;
  return v.filter((s) => typeof s === "string" && s.trim().length > 0).length === 0;
}

function isEmptyCastDetails(v: unknown): boolean {
  if (!Array.isArray(v) || v.length === 0) return true;
  for (const entry of v) {
    if (entry && typeof entry === "object") {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string" && name.trim().length > 0) return false;
    }
  }
  return true;
}

/** 该行至少有一个目标列为空时才视为候选。 */
function needsBackfill(row: PublicRow): boolean {
  if (!isTtMovieId(row.movie_id)) return false;
  return (
    isEmptyText(row.plot) ||
    isEmptyText(row.writer) ||
    isEmptyText(row.tagline) ||
    isEmptyText(row.release_date) ||
    isEmptyText(row.country_of_origin) ||
    isEmptyStringArray(row.also_known_as) ||
    isEmptyStringArray(row.production_companies) ||
    isEmptyText(row.box_office) ||
    isEmptyCastDetails(row.cast_details) ||
    isEmptyText(row.content_rating)
  );
}

/**
 * 通过 HTTP 调用同项目内的 `enrich-movie-from-imdb`，复用 TMDb + OMDb 归一化逻辑。
 *
 * @returns 成功时为标准化 JSON；调用失败 / 4xx / 5xx 返回 `null`，由调用方按 `failed` 处理。
 */
async function callEnrich(
  imdbId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ ok: true; data: EnrichSuccess } | { ok: false; error: string }> {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/enrich-movie-from-imdb`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ imdbId }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }
    return {
      ok: false,
      error: `enrich_http_${res.status}: ${detail.slice(0, 240)}`,
    };
  }

  let json: EnrichSuccess;
  try {
    json = (await res.json()) as EnrichSuccess;
  } catch (e) {
    return {
      ok: false,
      error: `enrich_json_parse_failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { ok: true, data: json };
}

/** 将 enrich 返回的 castDetails 归一化为 `{ name, character }` 数组（剔除空 name）。 */
function sanitizeCastDetails(input: unknown): CastDetailEntry[] {
  if (!Array.isArray(input)) return [];
  const out: CastDetailEntry[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    const character = (entry as { character?: unknown }).character;
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) continue;
    const cleanChar = typeof character === "string" ? character.trim() : "";
    out.push({ name: cleanName, character: cleanChar });
  }
  return out;
}

function sanitizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
  }
  return out;
}

/**
 * 比对 `row`（DB 现状）与 `enriched`（远端归一化值），仅对原值为空且远端非空的列产出 update 片段。
 *
 * @returns `update` 仅含需写入的列；`fields` 为列名列表，便于汇总到 `PerRowResult.updatedFields`。
 */
function buildPartialUpdate(
  row: PublicRow,
  enriched: EnrichSuccess,
): { update: Record<string, unknown>; fields: string[] } {
  const update: Record<string, unknown> = {};
  const fields: string[] = [];

  if (isEmptyText(row.plot) && !isEmptyText(enriched.plot)) {
    update.plot = enriched.plot!.trim();
    fields.push("plot");
  }
  if (isEmptyText(row.writer) && !isEmptyText(enriched.writer)) {
    update.writer = enriched.writer!.trim();
    fields.push("writer");
  }
  if (isEmptyText(row.tagline) && !isEmptyText(enriched.tagline)) {
    update.tagline = enriched.tagline!.trim();
    fields.push("tagline");
  }
  if (isEmptyText(row.release_date) && !isEmptyText(enriched.releaseDate)) {
    update.release_date = enriched.releaseDate!.trim();
    fields.push("release_date");
  }
  if (isEmptyText(row.country_of_origin) && !isEmptyText(enriched.countryOfOrigin)) {
    update.country_of_origin = enriched.countryOfOrigin!.trim();
    fields.push("country_of_origin");
  }
  if (isEmptyStringArray(row.also_known_as)) {
    const cleaned = sanitizeStringArray(enriched.alsoKnownAs);
    if (cleaned.length > 0) {
      update.also_known_as = cleaned;
      fields.push("also_known_as");
    }
  }
  if (isEmptyStringArray(row.production_companies)) {
    const cleaned = sanitizeStringArray(enriched.productionCompanies);
    if (cleaned.length > 0) {
      update.production_companies = cleaned;
      fields.push("production_companies");
    }
  }
  if (isEmptyText(row.box_office) && !isEmptyText(enriched.boxOffice)) {
    update.box_office = enriched.boxOffice!.trim();
    fields.push("box_office");
  }
  if (isEmptyCastDetails(row.cast_details)) {
    const cleaned = sanitizeCastDetails(enriched.castDetails);
    if (cleaned.length > 0) {
      update.cast_details = cleaned;
      fields.push("cast_details");
    }
  }
  if (isEmptyText(row.content_rating) && !isEmptyText(enriched.contentRating)) {
    update.content_rating = enriched.contentRating!.trim();
    fields.push("content_rating");
  }

  return { update, fields };
}

/**
 * 解析 POST body；空或非 JSON 对象时返回空对象，以保留「无 body 全表回填」行为。
 *
 * @param raw `await req.text()` 结果
 */
function parsePostBody(raw: string): Record<string, unknown> {
  const t = raw.trim();
  if (!t) return {};
  try {
    const v = JSON.parse(t) as unknown;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * 解析批量刷新 `limit`：默认 50，合法数值限制在 [1, 100]。
 *
 * @param v POST body 中的 `limit` 字段
 */
function parseTruncatedCastRefreshLimit(v: unknown): number {
  const fallback = 50;
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const n = Math.floor(v);
  if (n < 1) return fallback;
  return Math.min(100, n);
}

/**
 * 判定 `cast_details` 是否为非空且存在、且为长度不超过 15 的数组（批量刷新候选）。
 *
 * @param castDetails 表列原始值
 */
function isTruncatedCastDetailsCandidate(castDetails: unknown): boolean {
  if (castDetails == null) return false;
  if (!Array.isArray(castDetails)) return false;
  return castDetails.length <= 15;
}

/**
 * 统计 DB 中 `cast_details` 数组元素个数（非数组视为 0）。
 *
 * @param castDetails 表列原始值
 */
function rawCastDetailsArrayLength(castDetails: unknown): number {
  if (!Array.isArray(castDetails)) return 0;
  return castDetails.length;
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

  const adminSecret = Deno.env.get("BACKFILL_PUBLIC_METADATA_ADMIN_SECRET");
  const provided = req.headers.get("X-Backfill-Admin-Secret") ?? "";
  if (!adminSecret?.trim()) {
    return new Response(
      JSON.stringify({
        error: "Server misconfiguration",
        message: "BACKFILL_PUBLIC_METADATA_ADMIN_SECRET is not set",
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

  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
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

  const rawBody = await req.text().catch(() => "");
  const postBody = parsePostBody(rawBody);

  if (postBody.refreshTruncatedCastDetails === true) {
    if (postBody.overwriteCastDetails !== true) {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message:
            "overwriteCastDetails must be true when refreshTruncatedCastDetails is true",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const batchLimit = parseTruncatedCastRefreshLimit(postBody.limit);

    const { data: truncRows, error: truncSelErr } = await supabase
      .from(PUBLIC_TABLE)
      .select("movie_id, cast_details")
      .not("cast_details", "is", null);

    if (truncSelErr) {
      return new Response(
        JSON.stringify({
          error: "Select failed",
          message: truncSelErr.message,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const typed = (truncRows ?? []) as Array<{ movie_id: string; cast_details: unknown }>;
    const batchCandidates = typed
      .filter((r) => isTtMovieId(r.movie_id) && isTruncatedCastDetailsCandidate(r.cast_details))
      .slice(0, batchLimit);

    const batchSummary: TruncatedCastBatchSummary = {
      mode: "refresh_truncated_cast_details",
      scanned: batchCandidates.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      rows: [],
    };

    for (let i = 0; i < batchCandidates.length; i++) {
      const row = batchCandidates[i];
      const movieId = (row.movie_id ?? "").trim().toLowerCase();
      const oldCount = rawCastDetailsArrayLength(row.cast_details);

      try {
        const enrichResult = await callEnrich(movieId, supabaseUrl, serviceKey);
        if (enrichResult.ok === false) {
          batchSummary.failed++;
          batchSummary.rows.push({
            movieId,
            oldCount,
            newCount: 0,
            status: "failed",
            message: enrichResult.error,
          });
          continue;
        }

        const cleaned = sanitizeCastDetails(enrichResult.data.castDetails);
        if (cleaned.length === 0) {
          batchSummary.skipped++;
          batchSummary.rows.push({
            movieId,
            oldCount,
            newCount: 0,
            status: "skipped",
            message: "enrich_returned_empty_cast_details",
          });
          continue;
        }

        if (cleaned.length <= oldCount) {
          batchSummary.skipped++;
          batchSummary.rows.push({
            movieId,
            oldCount,
            newCount: cleaned.length,
            status: "skipped",
            message: "enrich_cast_not_longer_than_existing",
          });
          continue;
        }

        const updatedAt = new Date().toISOString();
        const { error: upErr } = await supabase
          .from(PUBLIC_TABLE)
          .update({
            cast_details: cleaned,
            updated_at: updatedAt,
          })
          .eq("movie_id", movieId);

        if (upErr) {
          batchSummary.failed++;
          batchSummary.rows.push({
            movieId,
            oldCount,
            newCount: cleaned.length,
            status: "failed",
            message: upErr.message,
          });
          continue;
        }

        batchSummary.updated++;
        batchSummary.rows.push({
          movieId,
          oldCount,
          newCount: cleaned.length,
          status: "updated",
        });
      } catch (e) {
        batchSummary.failed++;
        batchSummary.rows.push({
          movieId,
          oldCount,
          newCount: 0,
          status: "failed",
          message: e instanceof Error ? e.message : String(e),
        });
      }

      if (i < batchCandidates.length - 1) {
        const span = PER_ROW_DELAY_MAX_MS - PER_ROW_DELAY_MIN_MS;
        const delay = PER_ROW_DELAY_MIN_MS + Math.floor(Math.random() * (span + 1));
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return new Response(JSON.stringify(batchSummary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (postBody.overwriteCastDetails === true) {
    const movieIdRaw = postBody.movieId;
    if (typeof movieIdRaw !== "string" || !movieIdRaw.trim()) {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "movieId is required when overwriteCastDetails is true",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const movieId = movieIdRaw.trim().toLowerCase();
    if (!isTtMovieId(movieId)) {
      return new Response(
        JSON.stringify({
          error: "Bad Request",
          message: "movieId must match tt followed by digits (e.g. tt0076759)",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: existingRow, error: findErr } = await supabase
      .from(PUBLIC_TABLE)
      .select("movie_id")
      .eq("movie_id", movieId)
      .maybeSingle();

    if (findErr) {
      return new Response(
        JSON.stringify({
          error: "Select failed",
          message: findErr.message,
          movieId,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (!existingRow?.movie_id) {
      return new Response(
        JSON.stringify({
          error: "Not Found",
          message: `No row in ${PUBLIC_TABLE} for movie_id`,
          movieId,
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const enrichResult = await callEnrich(movieId, supabaseUrl, serviceKey);
    if (enrichResult.ok === false) {
      return new Response(
        JSON.stringify({
          status: "failed",
          movieId,
          message: enrichResult.error,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cleaned = sanitizeCastDetails(enrichResult.data.castDetails);
    if (cleaned.length === 0) {
      return new Response(
        JSON.stringify({
          status: "skipped",
          movieId,
          message: "enrich_returned_empty_cast_details",
          castDetailsCount: 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const updatedAt = new Date().toISOString();
    const { error: upErr } = await supabase
      .from(PUBLIC_TABLE)
      .update({
        cast_details: cleaned,
        updated_at: updatedAt,
      })
      .eq("movie_id", movieId);

    if (upErr) {
      return new Response(
        JSON.stringify({
          status: "failed",
          movieId,
          message: upErr.message,
          castDetailsCount: cleaned.length,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        status: "updated",
        movieId,
        castDetailsCount: cleaned.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const selectColumns = [
    "movie_id",
    "title",
    "plot",
    "writer",
    "tagline",
    "release_date",
    "country_of_origin",
    "also_known_as",
    "production_companies",
    "box_office",
    "cast_details",
    "content_rating",
  ].join(",");

  const { data: rows, error: selErr } = await supabase
    .from(PUBLIC_TABLE)
    .select(selectColumns);

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

  const all = (rows ?? []) as unknown as PublicRow[];
  const candidates = all.filter(needsBackfill);

  const summary: BackfillSummary = {
    totalRows: all.length,
    candidates: candidates.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    rows: [],
  };

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    const movieId = row.movie_id ?? "";
    const titleLabel = row.title ?? "";

    try {
      const enrichResult = await callEnrich(movieId, supabaseUrl, serviceKey);
      if (enrichResult.ok === false) {
        summary.failed++;
        summary.rows.push({
          movie_id: movieId,
          title: titleLabel,
          status: "failed",
          updatedFields: [],
          error: enrichResult.error,
        });
        continue;
      }

      const { update, fields } = buildPartialUpdate(row, enrichResult.data);
      if (fields.length === 0) {
        summary.skipped++;
        summary.rows.push({
          movie_id: movieId,
          title: titleLabel,
          status: "skipped",
          updatedFields: [],
          error: "no_new_data_from_enrich",
        });
        continue;
      }

      update.updated_at = new Date().toISOString();

      const { error: upErr } = await supabase
        .from(PUBLIC_TABLE)
        .update(update)
        .eq("movie_id", movieId);

      if (upErr) {
        summary.failed++;
        summary.rows.push({
          movie_id: movieId,
          title: titleLabel,
          status: "failed",
          updatedFields: [],
          error: upErr.message,
        });
        continue;
      }

      summary.updated++;
      summary.rows.push({
        movie_id: movieId,
        title: titleLabel,
        status: "updated",
        updatedFields: fields,
      });
    } catch (e) {
      summary.failed++;
      summary.rows.push({
        movie_id: movieId,
        title: titleLabel,
        status: "failed",
        updatedFields: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (i < candidates.length - 1) {
      const span = PER_ROW_DELAY_MAX_MS - PER_ROW_DELAY_MIN_MS;
      const delay = PER_ROW_DELAY_MIN_MS + Math.floor(Math.random() * (span + 1));
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
