import type { SupabaseClient } from '@supabase/supabase-js';
import type { FilmDnaNode, FilmDnaTree } from '../types/filmDna';

const TABLE = 'filmbase_film_dna_graphs';

/** OpenAI model used by the generate-film-dna Edge Function. Stored for auditability. */
const GENERATION_MODEL = 'gpt-4o-mini';

type FilmDnaGraphSelectRow = {
  graph: unknown;
  status: string;
};

const CLIENT_VERSION_JUSTIFICATION_RE =
  /\b(remake|re-?adaptation|readaptation|reboot|adaptation|adapted|sequel|prequel|follow-?up|next installment|previous installment|prior installment|next entry|previous entry|prior entry|series|alternate version|alternate cut|director'?s? cut|extended version|source material|same source|earlier version|earlier film|earlier adaptation|prior version|prior film|different era|tv version|stage version)\b/i;

function normalizeCachedTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

function isCachedSeriesNodeDuplicateOfCenter(node: FilmDnaNode, center: FilmDnaNode): boolean {
  if (node.tmdbMovieId && center.tmdbMovieId && node.tmdbMovieId === center.tmdbMovieId) {
    return true;
  }
  if (normalizeCachedTitle(node.title) !== normalizeCachedTitle(center.title)) return false;
  const np = node.posterUrl?.trim();
  const cp = center.posterUrl?.trim();
  if (np && cp && np === cp) return true;
  const noteText = [
    node.note,
    node.relationshipSummaryTitle ?? '',
    ...(node.relationshipBullets ?? []),
  ].join(' ');
  return !CLIENT_VERSION_JUSTIFICATION_RE.test(noteText);
}

function cachedNodesMatch(a: FilmDnaNode, b: FilmDnaNode): boolean {
  if (a.tmdbMovieId && b.tmdbMovieId) return a.tmdbMovieId === b.tmdbMovieId;
  const pa = a.posterUrl?.trim();
  const pb = b.posterUrl?.trim();
  if (pa && pb && pa === pb) return true;
  if (normalizeCachedTitle(a.title) !== normalizeCachedTitle(b.title)) return false;
  const ya = typeof a.year === 'number' && a.year > 0 ? a.year : null;
  const yb = typeof b.year === 'number' && b.year > 0 ? b.year : null;
  if (ya != null && yb != null) return ya === yb;
  return true;
}

function filterCachedAxisCrossDedup(tree: FilmDnaTree): FilmDnaTree {
  const axis = [...(tree.seriesPrevious ?? []), ...(tree.seriesNext ?? [])];
  if (!axis.length) return tree;
  const onAxis = (node: FilmDnaNode) => axis.some((s) => cachedNodesMatch(node, s));
  const left = tree.left.filter((n) => !onAxis(n));
  const right = tree.right.filter((n) => !onAxis(n));
  if (left.length === tree.left.length && right.length === tree.right.length) return tree;
  return { ...tree, left, right };
}

function filterCachedSeriesDuplicatesOfCenter(tree: FilmDnaTree): FilmDnaTree {
  if (!tree.seriesPrevious?.length && !tree.seriesNext?.length) return tree;
  const sp = tree.seriesPrevious?.filter((n) => !isCachedSeriesNodeDuplicateOfCenter(n, tree.center));
  const sn = tree.seriesNext?.filter((n) => !isCachedSeriesNodeDuplicateOfCenter(n, tree.center));
  const changed =
    (sp?.length ?? 0) !== (tree.seriesPrevious?.length ?? 0) ||
    (sn?.length ?? 0) !== (tree.seriesNext?.length ?? 0);
  if (!changed) return tree;
  return {
    center: tree.center,
    left: tree.left,
    right: tree.right,
    ...(sp?.length ? { seriesPrevious: sp } : {}),
    ...(sn?.length ? { seriesNext: sn } : {}),
  };
}

/**
 * Load a persisted Film DNA graph for the given center movie ID.
 * Returns the hydrated FilmDnaTree if a ready graph exists, null otherwise.
 *
 * @param supabase Authenticated Supabase client
 * @param centerMovieId Movie.id (IMDb tt-id or internal movie_id)
 */
export async function loadFilmDnaGraph(
  supabase: SupabaseClient,
  centerMovieId: string,
): Promise<FilmDnaTree | null> {
  if (!centerMovieId?.trim()) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .select('graph, status')
    .eq('center_movie_id', centerMovieId)
    .maybeSingle<FilmDnaGraphSelectRow>();

  if (error) {
    console.warn('[filmDnaGraphStore] load failed', error.message);
    return null;
  }

  if (!data || data.status !== 'ready') return null;

  const graph = data.graph as FilmDnaTree | null;
  if (!graph || typeof graph !== 'object' || !graph.center) return null;

  return filterCachedAxisCrossDedup(filterCachedSeriesDuplicatesOfCenter(graph));
}

/**
 * Insert a new Film DNA graph row for the given center movie.
 *
 * Uses insert (not upsert) to avoid requiring UPDATE permission under anon RLS.
 * On unique conflict (center_movie_id already exists), silently ignores —
 * another tab or session already saved the graph.
 *
 * @param supabase Authenticated Supabase client
 * @param centerMovieId Movie.id used as the stable cache key
 * @param centerTitle Movie title (for searchability / debugging)
 * @param centerYear Movie release year
 * @param tree Fully hydrated FilmDnaTree returned by invokeGenerateFilmDna
 */
export async function saveFilmDnaGraph(
  supabase: SupabaseClient,
  centerMovieId: string,
  centerTitle: string,
  centerYear: number | null,
  tree: FilmDnaTree,
): Promise<void> {
  if (!centerMovieId?.trim()) return;

  const record = {
    center_movie_id: centerMovieId,
    center_title: centerTitle,
    center_year: centerYear ?? null,
    graph: tree as unknown as Record<string, unknown>,
    status: 'ready',
    model: GENERATION_MODEL,
    version: 1,
  };

  const { error } = await supabase.from(TABLE).insert(record);

  if (error) {
    // PostgreSQL unique_violation — another session already saved this graph; safe to ignore.
    if (error.code === '23505') return;
    console.warn('[filmDnaGraphStore] save failed', error.message);
  }
}
