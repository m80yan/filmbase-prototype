# Data Schema

## Main Table
filmbase_saved_movies

## Current Web Shared Table
filmbase_public_movies

The current web app also uses `filmbase_public_movies` as a shared public movie metadata/library table.

For current web work, do not assume `filmbase_saved_movies` is the only active table.

Before changing data access code, inspect the current Supabase helpers and confirm whether a feature reads from:
- `filmbase_saved_movies`
- `filmbase_public_movies`
- another helper or Edge Function

## Purpose
`filmbase_saved_movies` is the target table for the iOS MVP. It stores each signed-in user's personal movie library.

The current web app also uses `filmbase_public_movies` as a shared public library / metadata source.

For current FilmBase web work, treat this file as a mixed web + future iOS schema note. Do not let iOS assumptions override current web behavior.

## Important Fields
- owner_id: uuid
- movie_id: string
- title: string
- year: number | null
- genre: string[]
- poster_url: string | null
- poster_storage_path: string | null
- trailer_url: string | null
- personal_rating: number | null
- imdb_rating: number | null
- rotten_tomatoes: number | null
- director: string | null
- language: string | null
- runtime: string | null
- cast_members: string[] | null
- is_favorite: boolean | null
- badge: string | null
- content_rating: string | null
- plot: string | null
- writer: string | null
- tagline: string | null
- release_date: string | null
- country_of_origin: string | null
- also_known_as: string[] | null
- production_companies: string[] | null
- box_office: string | null
- cast_details: json | null

## Possible System Fields
- created_at: timestamp
- updated_at: timestamp

Unknown:
The current web select/write helpers do not directly use `created_at` or `updated_at`, so confirm these columns in Supabase before relying on them in iOS.

## Unique Key
(owner_id, movie_id)

This prevents the same user from saving the same movie multiple times.

## Movie Identity Notes

Movie identity may appear in different shapes across the current web app, Supabase rows, and external API responses.

Before implementing cache or persistence logic, inspect the current movie object and confirm exact field names.

Possible identity fields:
- `id`
- `movieId`
- `movie_id`
- `imdbId`
- `imdb_id`
- `title`
- `year`

Preferred identity order for stable app-level data:
1. IMDb ID, if available and normalized.
2. Internal movie ID, if more stable in the app.
3. Title + year fallback only if no stronger ID exists.

Do not assume field naming without checking the current implementation.

## RLS
Users can only read, insert, update, and delete their own saved movies.

Rule:
owner_id = auth.uid()

## Storage
Bucket:
filmbase-posters

Path:
<auth.uid>/<movie_id>/poster.jpg

The current web/shared legacy model also uses:
shared/<movie_id>/poster.jpg

The iOS MVP should use the user-owned path, not the shared path.

## Film DNA Graph Data

Proposed table:
- `filmbase_film_dna_graphs`

Status:
- proposed / pending implementation

Purpose:
- persist generated Film DNA relationship graphs
- avoid regenerating different graphs for the same center movie
- make Film DNA feel stable, curated, and fast after first generation

Film DNA should use this behavior:

```txt
open Film DNA
→ look up persisted graph by stable center movie key
→ render ready graph if found
→ otherwise generate once
→ normalize
→ save to Supabase
→ render saved graph
```

Film DNA persistence needs one stable key per center movie.

Before implementation, inspect the current movie object and confirm the best key:
- IMDb ID, if reliably available and normalized
- internal movie ID, if more stable
- title + year only as fallback

Do not assume whether the current field is named:
- `id`
- `movieId`
- `movie_id`
- `imdbId`
- `imdb_id`

Recommended graph row shape:

```ts
type FilmDnaGraphRow = {
  id: string
  center_movie_id: string | null
  center_imdb_id: string | null
  center_title: string
  center_year: number | null
  influences: FilmDnaNode[]
  legacy: FilmDnaNode[]
  status: "ready" | "generating" | "failed"
  model: string | null
  version: number
  created_at: string
  updated_at: string
}
```

Expected node shape:

```ts
type FilmDnaNode = {
  title: string
  year: number
  imdbId?: string
  posterUrl?: string
  relationshipLabel?: string
  relationshipReason?: string
  confidence?: "high" | "medium" | "low"
}
```

Normalization before save:
- ensure `influences` is an array
- ensure `legacy` is an array
- cap influence nodes to 0–3
- cap legacy nodes to 0–3
- remove duplicate nodes across both sides
- remove invalid nodes without title or year
- remove low-confidence filler if confidence exists
- preserve `posterUrl`, `relationshipLabel`, and `relationshipReason` when available

Known poster field risk:
- center node may use the current preview poster / center poster path
- relationship nodes require `posterUrl`
- do not assume these fields are the same without checking current code

## Future Tables
- profiles
- movie_posters
- poster_artists
- user_collections
- social_follows
- user_comments
- marketplace_items

## Notes
Current `filmbase_saved_movies` schema is enough for the iOS MVP.

Current web FilmBase work also depends on shared data paths such as `filmbase_public_movies`, poster storage, Edge Functions, and proposed Film DNA persistence.

Before adding social, marketplace, poster designer pages, or Android support, the schema should be reviewed again.
