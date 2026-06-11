-- Film DNA relationship edges
-- Captures directed influence edges between movies as discovered by the
-- generate-film-dna Edge Function.  Phase 1 writes only AI-generated
-- 'influence' edges; later phases add 'series' / 'same_source' and
-- user-confirmed edges.

create table if not exists public.film_dna_relationship_edges (
  id                       uuid        primary key default gen_random_uuid(),

  -- TMDB integer IDs (populated when TMDB enrichment succeeded)
  source_tmdb_id           integer,
  target_tmdb_id           integer,

  -- IMDb / internal library IDs (populated in later phases)
  source_movie_id          text,
  target_movie_id          text,

  -- Human-readable labels (always present; allow graph display without DB joins)
  source_title             text        not null,
  source_year              integer,
  source_poster_url        text,
  target_title             text        not null,
  target_year              integer,
  target_poster_url        text,

  -- Edge semantics
  -- 'influence': source influenced target (left[] → center, center → right[])
  -- 'series': consecutive entries in the same series
  -- 'same_source': shared literary / IP source
  relation_type            text        not null
                           check (relation_type in ('influence', 'series', 'same_source')),

  -- Free-text note and structured bullets from the AI (may be null)
  relationship_note        text,
  relationship_bullets     text[],

  -- Provenance
  confidence               text        not null default 'ai'
                           check (confidence in ('ai', 'tmdb', 'user')),
  ai_model                 text,
  generated_from_movie_id  text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- One edge per source+target+type when both TMDB IDs are known.
-- Partial index: rows where either ID is NULL are allowed to accumulate
-- (title-only entries); dedup via TMDB is the primary trust signal.
create unique index if not exists film_dna_edges_tmdb_uniq
  on public.film_dna_relationship_edges (source_tmdb_id, target_tmdb_id, relation_type)
  where source_tmdb_id is not null and target_tmdb_id is not null;

-- Query indexes
create index if not exists film_dna_edges_source_tmdb_idx
  on public.film_dna_relationship_edges (source_tmdb_id)
  where source_tmdb_id is not null;

create index if not exists film_dna_edges_target_tmdb_idx
  on public.film_dna_relationship_edges (target_tmdb_id)
  where target_tmdb_id is not null;

create index if not exists film_dna_edges_source_movie_idx
  on public.film_dna_relationship_edges (source_movie_id)
  where source_movie_id is not null;

create index if not exists film_dna_edges_target_movie_idx
  on public.film_dna_relationship_edges (target_movie_id)
  where target_movie_id is not null;

-- RLS: anyone may read; only the service role may write
alter table public.film_dna_relationship_edges enable row level security;

create policy "film_dna_edges_public_read"
  on public.film_dna_relationship_edges
  for select
  using (true);
