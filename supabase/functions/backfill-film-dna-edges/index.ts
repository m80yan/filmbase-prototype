/// <reference lib="deno.ns" />
/**
 * Admin-only Edge Function: backfill `film_dna_relationship_edges` from
 * existing cached Film DNA graphs in `filmbase_film_dna_graphs`.
 *
 * Does NOT call OpenAI, TMDB, or mutate `filmbase_film_dna_graphs`.
 *
 * Usage:
 *   POST with header X-Backfill-Admin-Secret: <secret>
 *   Body (all optional): { "dryRun": true, "limit": 100 }
 *
 * Secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   BACKFILL_FILM_DNA_EDGES_ADMIN_SECRET  — required in X-Backfill-Admin-Secret header
 *   SERVICE_ROLE_KEY                       — bypasses RLS for SELECT and INSERT
 *
 * Environment variables (auto-injected by Supabase runtime):
 *   SUPABASE_URL
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPHS_TABLE = "filmbase_film_dna_graphs";
const EDGES_TABLE = "film_dna_relationship_edges";
const LOG_PREFIX = "[backfill-film-dna-edges]";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilmDnaNode = {
  title: string;
  year: number | null;
  note?: string;
  posterUrl?: string;
  tmdbMovieId?: number;
  relationshipBullets?: string[];
};

type FilmDnaTree = {
  center: FilmDnaNode;
  left: FilmDnaNode[];
  right: FilmDnaNode[];
};

type InfluenceEdgeRow = {
  source_tmdb_id: number | null;
  target_tmdb_id: number | null;
  source_movie_id: string | null;
  target_movie_id: string | null;
  source_title: string;
  source_year: number | null;
  source_poster_url: string | null;
  target_title: string;
  target_year: number | null;
  target_poster_url: string | null;
  relation_type: "influence";
  relationship_note: string | null;
  relationship_bullets: string[] | null;
  confidence: "ai";
  ai_model: string | null;
  generated_from_movie_id: string;
};

type GraphRow = {
  center_movie_id: string;
  graph: unknown;
  model: string | null;
};

type BackfillSummary = {
  ok: boolean;
  dryRun: boolean;
  limit: number;
  cacheRowsRead: number;
  alreadyBackfilled: number;
  processed: number;
  malformedGraphs: number;
  rowsSkippedMissingTitles: number;
  rowsSkippedDuplicateByGeneratedFrom: number;
  rowsSkippedDuplicateByTitle: number;
  edgesBuilt: number;
  edgesInserted?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

function parseLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.round(n)));
}

function isFilmDnaTree(v: unknown): v is FilmDnaTree {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.center === "object" && t.center !== null &&
    Array.isArray(t.left) &&
    Array.isArray(t.right)
  );
}

function tmdbId(node: FilmDnaNode): number | null {
  return typeof node.tmdbMovieId === "number" && node.tmdbMovieId > 0
    ? node.tmdbMovieId
    : null;
}

function nodeYear(node: FilmDnaNode): number | null {
  return typeof node.year === "number" ? node.year : null;
}

/**
 * Dedup key for lightweight title-based cross-graph deduplication.
 * Prevents inserting the same relationship edge twice when two different
 * cached graphs independently reference the same directed pair.
 */
function titleDedupKey(
  sourceTitle: string,
  sourceYear: number | null,
  targetTitle: string,
  targetYear: number | null,
): string {
  return [
    sourceTitle.trim().toLowerCase(),
    sourceYear ?? "",
    targetTitle.trim().toLowerCase(),
    targetYear ?? "",
    "influence",
  ].join("|");
}

/**
 * Build influence edge rows from a cached FilmDnaTree.
 *
 * Direction (matches generate-film-dna):
 *   left node A, center B  → source=A, target=B
 *   right node C, center B → source=B, target=C
 *
 * TMDB IDs are populated when available; null otherwise.
 * Rows with missing titles on either side are skipped and counted.
 * Sets generated_from_movie_id = centerMovieId on every row.
 */
function buildEdgeRows(
  tree: FilmDnaTree,
  centerMovieId: string,
  model: string | null,
): { rows: InfluenceEdgeRow[]; skippedMissingTitle: number } {
  const { center } = tree;
  if (!center.title?.trim()) {
    return { rows: [], skippedMissingTitle: 0 };
  }

  const centerTmdb = tmdbId(center);
  const centerYear = nodeYear(center);
  const centerPoster = center.posterUrl?.trim() || null;
  const centerTitle = center.title;

  const rows: InfluenceEdgeRow[] = [];
  let skippedMissingTitle = 0;

  for (const node of tree.left) {
    if (!node.title?.trim()) { skippedMissingTitle++; continue; }
    rows.push({
      source_tmdb_id: tmdbId(node),
      target_tmdb_id: centerTmdb,
      source_movie_id: null,
      target_movie_id: null,
      source_title: node.title,
      source_year: nodeYear(node),
      source_poster_url: node.posterUrl?.trim() || null,
      target_title: centerTitle,
      target_year: centerYear,
      target_poster_url: centerPoster,
      relation_type: "influence",
      relationship_note: node.note?.trim() || null,
      relationship_bullets:
        Array.isArray(node.relationshipBullets) && node.relationshipBullets.length > 0
          ? node.relationshipBullets
          : null,
      confidence: "ai",
      ai_model: model,
      generated_from_movie_id: centerMovieId,
    });
  }

  for (const node of tree.right) {
    if (!node.title?.trim()) { skippedMissingTitle++; continue; }
    rows.push({
      source_tmdb_id: centerTmdb,
      target_tmdb_id: tmdbId(node),
      source_movie_id: null,
      target_movie_id: null,
      source_title: centerTitle,
      source_year: centerYear,
      source_poster_url: centerPoster,
      target_title: node.title,
      target_year: nodeYear(node),
      target_poster_url: node.posterUrl?.trim() || null,
      relation_type: "influence",
      relationship_note: node.note?.trim() || null,
      relationship_bullets:
        Array.isArray(node.relationshipBullets) && node.relationshipBullets.length > 0
          ? node.relationshipBullets
          : null,
      confidence: "ai",
      ai_model: model,
      generated_from_movie_id: centerMovieId,
    });
  }

  return { rows, skippedMissingTitle };
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-backfill-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Auth
  const adminSecret = Deno.env.get("BACKFILL_FILM_DNA_EDGES_ADMIN_SECRET");
  const provided = req.headers.get("X-Backfill-Admin-Secret") ?? "";
  if (!adminSecret?.trim()) {
    return jsonResponse(
      { error: "Server misconfiguration", message: "BACKFILL_FILM_DNA_EDGES_ADMIN_SECRET is not set" },
      500,
    );
  }
  if (!timingSafeEqualString(provided, adminSecret)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Supabase client
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey?.trim() || !supabaseUrl?.trim()) {
    return jsonResponse(
      { error: "Server misconfiguration", message: "SUPABASE_URL or SERVICE_ROLE_KEY is not set" },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Parse body
  let postBody: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw.trim()) postBody = JSON.parse(raw);
  } catch { /* empty or invalid body — use defaults */ }

  const dryRun = postBody.dryRun === true;
  const limit = parseLimit(postBody.limit);

  console.log(`${LOG_PREFIX} start`, { dryRun, limit });

  // Step 1: collect center_movie_ids that are already backfilled
  const { data: existingRows, error: existingErr } = await supabase
    .from(EDGES_TABLE)
    .select("generated_from_movie_id")
    .not("generated_from_movie_id", "is", null);

  if (existingErr) {
    console.warn(`${LOG_PREFIX} failed to query existing edges`, existingErr.message);
    return jsonResponse(
      { error: "DB error querying existing edges", message: existingErr.message },
      500,
    );
  }

  const alreadyBackfilledSet = new Set<string>(
    (existingRows ?? [])
      .map((r: Record<string, unknown>) => r.generated_from_movie_id as string)
      .filter(Boolean),
  );

  // Step 2: read cache rows
  const { data: cacheData, error: cacheErr } = await supabase
    .from(GRAPHS_TABLE)
    .select("center_movie_id, graph, model")
    .eq("status", "ready")
    .limit(limit);

  if (cacheErr) {
    console.warn(`${LOG_PREFIX} failed to query graph cache`, cacheErr.message);
    return jsonResponse(
      { error: "DB error querying graph cache", message: cacheErr.message },
      500,
    );
  }

  const cacheRows = (cacheData ?? []) as GraphRow[];
  const cacheRowsRead = cacheRows.length;

  // Step 3: build edge rows
  let alreadyBackfilled = 0;
  let processed = 0;
  let malformedGraphs = 0;
  let rowsSkippedMissingTitles = 0;
  let rowsSkippedDuplicateByTitle = 0;

  const allEdgeRows: InfluenceEdgeRow[] = [];
  const seenTitleKeys = new Set<string>();

  for (const row of cacheRows) {
    if (alreadyBackfilledSet.has(row.center_movie_id)) {
      alreadyBackfilled++;
      continue;
    }

    if (!isFilmDnaTree(row.graph)) {
      malformedGraphs++;
      console.warn(`${LOG_PREFIX} malformed graph skipped`, { center_movie_id: row.center_movie_id });
      continue;
    }

    processed++;
    const { rows: edgeRows, skippedMissingTitle } = buildEdgeRows(
      row.graph,
      row.center_movie_id,
      row.model,
    );
    rowsSkippedMissingTitles += skippedMissingTitle;

    for (const edge of edgeRows) {
      const key = titleDedupKey(
        edge.source_title,
        edge.source_year,
        edge.target_title,
        edge.target_year,
      );
      if (seenTitleKeys.has(key)) {
        rowsSkippedDuplicateByTitle++;
        continue;
      }
      seenTitleKeys.add(key);
      allEdgeRows.push(edge);
    }
  }

  const edgesBuilt = allEdgeRows.length;

  const summary: BackfillSummary = {
    ok: true,
    dryRun,
    limit,
    cacheRowsRead,
    alreadyBackfilled,
    processed,
    malformedGraphs,
    rowsSkippedMissingTitles,
    rowsSkippedDuplicateByGeneratedFrom: alreadyBackfilled,
    rowsSkippedDuplicateByTitle,
    edgesBuilt,
  };

  if (dryRun) {
    console.log(`${LOG_PREFIX} dry run complete`, summary);
    return jsonResponse(summary);
  }

  if (edgesBuilt === 0) {
    const finalSummary = { ...summary, edgesInserted: 0 };
    console.log(`${LOG_PREFIX} complete — nothing to insert`, finalSummary);
    return jsonResponse(finalSummary);
  }

  // Step 4: batch insert with ON CONFLICT DO NOTHING
  const insertResp = await fetch(`${supabaseUrl}/rest/v1/${EDGES_TABLE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
      "apikey": serviceKey,
      "Prefer": "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(allEdgeRows),
  });

  if (!insertResp.ok) {
    const body = await insertResp.text();
    console.warn(
      `${LOG_PREFIX} insert failed`,
      { status: insertResp.status },
      body.slice(0, 500),
    );
    return jsonResponse(
      {
        ...summary,
        ok: false,
        error: `PostgREST insert failed with status ${insertResp.status}`,
        detail: body.slice(0, 300),
      },
      502,
    );
  }

  const finalSummary = { ...summary, edgesInserted: edgesBuilt };
  console.log(`${LOG_PREFIX} complete`, finalSummary);
  return jsonResponse(finalSummary);
});
