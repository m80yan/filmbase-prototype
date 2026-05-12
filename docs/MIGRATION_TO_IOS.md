# Migration to iOS

## Migration Decision

The iOS MVP uses a personal library model backed by:

filmbase_saved_movies

The current web app's shared `filmbase_public_movies` table is legacy context for the web app. It is not the target table for the iOS MVP.

## Current Web Features
- Library
- Poster View
- List View
- Add movie modal
- Search
- Sort
- Genre filtering
- Info Mode
- Trailer modal
- Custom poster upload
- Supabase persistence

## Reusable for iOS
- Product logic
- Data structure
- Supabase backend
- Edge Functions
- TMDB / IMDb enrichment logic
- Genre mapping
- Poster fallback logic

## Need Rebuild for iOS
- React UI
- Tailwind styles
- Browser localStorage
- Web modal behavior
- iframe trailer playback
- Image lazy loading

## iOS Data Model

- Read and write movie rows in `filmbase_saved_movies`.
- Scope all library queries by the signed-in user's `owner_id`.
- Store custom posters under `<auth.uid>/<movie_id>/poster.jpg`.
- Treat `personal_rating`, custom poster, and trailer URL as user-owned fields.
- Do not use the shared public library as the main iOS model.

## Web Legacy Model

- The current web app visible library uses `filmbase_public_movies`.
- `filmbase_public_movies` has no `owner_id` in the current web row type.
- Shared public edits, deletes, ratings, trailer URLs, and posters are not part of the iOS MVP.
