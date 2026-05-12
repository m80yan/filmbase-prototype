# Supabase Schema For Filmbase iOS MVP

## Source of Truth

This document reflects `docs/MIGRATION_DECISIONS.md` and the current web app code, especially:

- `src/lib/filmbaseSupabase.ts`
- `src/lib/supabaseClient.ts`
- `src/App.tsx`
- Supabase Edge Functions under `supabase/functions`

No database migration files or SQL table definitions were found in the repo. Column types below are inferred from TypeScript row types and read/write usage. Unknowns are marked explicitly.

## iOS MVP Target Table

The iOS MVP target table is:

```text
filmbase_saved_movies
```

The iOS MVP is a personal library model:

- Each signed-in user has their own movie library.
- Users can only see their own saved movies.
- Users can only edit their own saved movies.
- Users can only delete their own saved movies.
- `personal_rating` belongs to the user.
- Custom poster belongs to the user.
- Trailer URL belongs to the user.

Expected key:

```text
owner_id, movie_id
```

Inferred constraint:

```text
unique or primary key on (owner_id, movie_id)
```

This is inferred from current web helper code:

```text
upsert(record, { onConflict: 'owner_id,movie_id' })
```

## Current Web / Shared Legacy Table

The current visible web library uses:

```text
filmbase_public_movies
```

The web app reads, inserts, updates, deletes, and subscribes to realtime changes from `filmbase_public_movies`.

For iOS, `filmbase_public_movies` is documented only as the current web/shared legacy model. It is not the main iOS MVP table.

The current web/shared legacy table uses the same movie fields listed for `filmbase_saved_movies`, except it does not include `owner_id` in the current web row type and uses `movie_id` as its unique key.

## Auth Assumptions

Current web behavior:

- Uses Supabase anonymous auth.
- Calls `signInAnonymously()`.
- Persists the session client-side.
- Auto-refreshes auth tokens.
- Waits until `supabase.auth.getUser()` returns a user id before performing table/storage work.

Environment variables used by the web app:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Unknown:

- Exact Supabase Auth settings in the hosted project.
- Whether anonymous auth is enabled in all environments.
- Whether the iOS MVP should use anonymous auth, email login, or another real sign-in method. In all cases, the app requires a user id for `owner_id`.

## `filmbase_saved_movies`

Purpose for iOS MVP:

- Active personal library table.
- One row per user/movie pair.
- Includes `owner_id`.
- Uses `(owner_id, movie_id)` as the conflict target for upsert.

Current role in web app:

- Receives old browser `localStorage` migration data.
- Is read during saved-to-public migration.
- Has helper functions for old saved-movie flows.

Expected key:

```text
owner_id, movie_id
```

Inferred constraint:

```text
unique or primary key on (owner_id, movie_id)
```

This is inferred from:

```text
upsert(record, { onConflict: 'owner_id,movie_id' })
```

### Fields Used

| Column | Inferred Type | Required By App | Notes |
| --- | --- | --- | --- |
| `owner_id` | `uuid or text` | Yes | Current signed-in Supabase user id. Should equal `auth.uid()`. |
| `movie_id` | `text` | Yes | App-level movie id, usually IMDb `tt...`. Used as `Movie.id`. |
| `title` | `text nullable` | Yes | Empty string fallback in UI if null. |
| `year` | `integer nullable` | Yes | `0` fallback in UI. |
| `genre` | `text[] or json array nullable` | Yes | Mapped to `Movie.genre`. Existing older docs may say `genres`; current code uses `genre`. |
| `imdb_rating` | `numeric nullable` | Yes | Mapped to `Movie.imdbRating`. |
| `rotten_tomatoes` | `integer or numeric nullable` | Yes | Percent value. Mapped to `Movie.rottenTomatoes`. |
| `personal_rating` | `integer or numeric nullable` | Yes | Belongs to the user for iOS MVP. |
| `poster_url` | `text nullable` | Yes | External poster URL. Ignored when `poster_storage_path` exists. |
| `poster_storage_path` | `text nullable` | Yes | User-owned Supabase Storage object path. Preferred poster source. |
| `director` | `text nullable` | Yes | Empty string fallback. |
| `language` | `text nullable` | Yes | Currently often empty for enriched movies. |
| `runtime` | `text nullable` | Yes | Stored as strings such as `148 min`. |
| `cast_members` | `text[] or json array nullable` | Yes | Mapped to `Movie.cast`. |
| `trailer_url` | `text nullable` | Yes | YouTube embed URL when available. |
| `date_added` | `timestamptz or text nullable` | Yes | Parsed with `new Date(...)`; used for recently added. |
| `is_favorite` | `boolean nullable` | Used | Present in model; not central to current UI. |
| `badge` | `text nullable` | Used | Legacy/seed display metadata. |
| `content_rating` | `text nullable` | Used | Rating such as `PG-13`, from OMDb when available. |
| `plot` | `text nullable` | Used | Detail/Info Mode plot. |
| `writer` | `text nullable` | Used | Writer names. |
| `tagline` | `text nullable` | Used | Returned by enrichment. |
| `release_date` | `text nullable` | Used | Display date, may be OMDb or TMDb-derived. |
| `country_of_origin` | `text nullable` | Used | Displayed in details/Info Mode. |
| `also_known_as` | `text[] or json array nullable` | Used | Parsed as `string[]`; not always displayed. |
| `production_companies` | `text[] or json array nullable` | Used | Displayed in details/Info Mode. |
| `box_office` | `text nullable` | Used | Displayed as compact currency in web Info Mode. |
| `cast_details` | `json/jsonb nullable` | Used | Array of `{ name: string, character: string }`. |

Unknown:

- Actual SQL column types.
- Actual nullable constraints.
- Actual default values.
- Actual indexes.
- Whether `created_at` and `updated_at` exist in the deployed table. Existing docs mention them, but current web select/write helpers do not use them directly.
- Actual owner-scoped RLS policies.
- Whether Realtime is enabled or needed for personal saved rows.

### Expected iOS Table Operations

The iOS MVP should perform:

- `select(...)` from `filmbase_saved_movies` scoped to the current `owner_id`.
- `upsert(record, { onConflict: 'owner_id,movie_id' })` for new movies and full-row saves.
- `update({ trailer_url }).eq('owner_id', uid).eq('movie_id', movieId)` for trailer edits.
- `update({ poster_storage_path, poster_url }).eq('owner_id', uid).eq('movie_id', movieId)` for poster changes.
- `delete().eq('owner_id', uid).eq('movie_id', movieId)` for movie deletion.

### Current Web Public Table Operations

The current web app performs:

- `select(...)` all library columns from `filmbase_public_movies`.
- `select(...).eq('movie_id', movieId).maybeSingle()` after realtime changes.
- `upsert(record, { onConflict: 'movie_id' })` for new movies and full-row rating updates.
- `update({ trailer_url }).eq('movie_id', movieId)` for trailer edits.
- `update({ poster_storage_path, poster_url }).eq('movie_id', movieId)` for poster changes.
- `delete().eq('movie_id', movieId)` for movie deletion.
- Realtime subscription to `postgres_changes` for all events on `public.filmbase_public_movies`.

These operations document the current web/shared legacy model only.

## Storage Bucket

Current bucket:

```text
filmbase-posters
```

Target iOS personal poster path:

```text
{auth.uid}/{movieId}/poster.jpg
```

Current web/shared legacy poster path:

```text
shared/{movieId}/poster.jpg
```

The iOS MVP should use the user-specific path. The shared path belongs to the current web/shared legacy model.

Allowed upload MIME types in current web app:

```text
image/jpeg
image/png
image/webp
```

Upload behavior:

- Upload uses `upsert: true`.
- File content type is taken from the selected file MIME type.
- Object path still ends in `poster.jpg` even when content type is PNG or WebP.
- After upload, the app clears any cached signed URL for that path.
- The movie row is updated so `poster_storage_path` is set and `poster_url` is cleared.

Delete behavior:

- iOS MVP delete should remove or orphan only the current user's saved movie row.
- Current web saved-movie helper attempts to remove `{uid}/{movieId}/poster.jpg`.
- Current web public delete does not delete the shared Storage object.

Unknown:

- Whether the bucket is private in Supabase settings. Code comments say it is private.
- Actual Storage policies for reading, signing, uploading, and overwriting `{auth.uid}/*`.
- Actual Storage policies for current web/shared legacy `shared/*`.
- Maximum Storage object size enforced by Supabase. The web UI validates 25 MB before upload.

## Signed URL Behavior

The web app treats `poster_storage_path` as the source of truth when present.

Flow:

1. Load movie rows from Supabase.
2. For each row with `poster_storage_path`, call:

```text
supabase.storage.from('filmbase-posters').createSignedUrl(path, 3600)
```

3. Use the returned signed URL as `Movie.posterUrl`.
4. Cache signed URLs in memory for roughly 1 hour.
5. If signing fails, fall back to `poster_url`.
6. If no usable `poster_url` exists, fall back to:

```text
https://picsum.photos/seed/movie/400/600
```

Signed URL TTL:

```text
3600 seconds
```

Refresh behavior:

- On poster upload or sync, cached signed URLs are cleared.
- New signed URLs receive a cache-busting query parameter `v={timestamp}`.
- The app also has UI-level retry behavior when an image load fails for a stored poster path.

iOS implication:

- SwiftUI image loading should not persist signed URLs as durable poster identity.
- Persist `poster_storage_path`.
- Refresh signed URLs when they expire or when image loading fails.

## Edge Functions Referenced By Client

### `search-movies`

Used by Add Movie title search.

Client invocation:

```text
supabase.functions.invoke('search-movies', { body: { query } })
```

Expected result shape:

```ts
{
  page?: number
  totalPages?: number
  totalResults?: number
  results?: Array<{
    tmdbId: number
    imdbId: string | null
    title: string
    originalTitle: string
    releaseDate: string
    year: number | null
    posterUrl: string | null
    overview: string
    popularity: number
    voteAverage: number
  }>
}
```

The web app only shows suggestions with non-empty `imdbId`.

### `enrich-movie-from-imdb`

Used after selecting a search result or entering IMDb input.

Client invocation:

```text
supabase.functions.invoke('enrich-movie-from-imdb', { body: { imdbId } })
```

Expected result shape:

```ts
{
  mediaType?: 'movie' | 'tv'
  title?: string
  year?: number
  runtime?: string
  genres?: string[]
  director?: string
  cast?: string[]
  posterUrl?: string
  trailerUrl?: string | null
  imdbRating?: number
  rottenTomatoes?: number
  contentRating?: string
  plot?: string
  writer?: string
  tagline?: string
  releaseDate?: string
  countryOfOrigin?: string
  alsoKnownAs?: string[]
  productionCompanies?: string[]
  boxOffice?: string
  castDetails?: Array<{ name?: string; character?: string }>
  error?: string
  message?: string
}
```

Important:

- `mediaType` is used client-side but is not written to either active table by the current web app.
- Missing poster falls back to `https://picsum.photos/seed/movie/400/600`.
- Missing ratings fall back to `0`.
- Missing text fields fall back to empty strings.

## RLS And Permission Assumptions

For the iOS MVP, RLS should enforce:

- Users can read only rows where `owner_id = auth.uid()`.
- Users can insert only rows where `owner_id = auth.uid()`.
- Users can update only rows where `owner_id = auth.uid()`.
- Users can delete only rows where `owner_id = auth.uid()`.
- Users can read/sign/upload only their own poster objects under `{auth.uid}/...`.

Current web/shared legacy code assumes the anonymous authenticated user can:

- Read `filmbase_public_movies`.
- Insert/upsert into `filmbase_public_movies`.
- Update `trailer_url`, `poster_storage_path`, and `poster_url`.
- Delete from `filmbase_public_movies`.
- Subscribe to realtime changes on `filmbase_public_movies`.
- Read from `filmbase_saved_movies` for the current `owner_id`.
- Upsert into `filmbase_saved_movies`.
- Upload to `filmbase-posters`.
- Create signed URLs for poster objects.
- Download poster objects for sync checks.

Unknown:

- Actual RLS SQL policies.
- Whether existing hosted policies already support the required iOS owner-scoped model.
- Whether current web/shared public writes should remain enabled after iOS launch.

## Open Unknowns To Resolve

- Exact SQL schema for both movie tables.
- RLS policies for table and Storage access.
- Whether anonymous auth remains the iOS MVP auth model.
- Whether the iOS MVP needs any seed/migration path from the current web public library.
- Whether Realtime is required for iOS MVP.
- Whether signed URL refresh should happen proactively or only on image failure.
- Whether `mediaType` should be persisted.
- Whether Storage should use extension-specific paths instead of always `poster.jpg`.
