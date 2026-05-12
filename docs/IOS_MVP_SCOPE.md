# Filmbase iOS MVP Scope

## Source of Truth

This document defines the iOS MVP using `docs/MIGRATION_DECISIONS.md` and the current web app behavior as references.

The iOS MVP is a personal movie poster collection and trailer watching app. The target table for the iOS MVP is `filmbase_saved_movies`.

The current web app persists its visible library through the shared `filmbase_public_movies` table. That table is documented as the current web/shared legacy model only; it is not the main iOS MVP library model.

## MVP Product Definition

Filmbase for iOS is a native SwiftUI app for maintaining a personal collection of movies, centered on poster browsing and quick trailer playback.

The MVP should let a user:

- Open the app and see their movie poster collection.
- Browse movies as posters.
- Search, filter, and sort the collection.
- View movie details and metadata.
- Watch a movie trailer.
- Add a movie from title search or IMDb URL.
- Edit a trailer URL.
- Upload or replace a custom poster.
- Rate a movie with a personal rating.
- Delete a movie from the collection.
- Sync collection data with Supabase.

## MVP Screens

### 1. Launch / Loading Screen

Shown while the app initializes Supabase, restores or creates auth state, loads the movie library, and signs poster URLs.

Required states:

- Loading indicator.
- Short loading label such as `Loading library`.
- Non-blocking recovery path if remote loading fails.

### 2. Library Screen

Primary screen after launch.

Required content:

- Movie poster grid.
- Search field.
- Controls for filter and sort.
- Add movie action.
- Toggle or navigation path to a list-style view if included in the first iOS build.

Required movie poster cell content:

- Poster image.
- Title.
- Year.
- Personal rating indicator.
- Metadata loading indication for newly added placeholder movies when enrichment is still pending.

Required interactions:

- Tap poster to open movie detail or poster preview.
- Tap trailer action to play trailer.
- Change personal rating.
- Delete movie through a confirmation flow.

### 3. Movie Detail Screen

Required content:

- Poster.
- Title.
- Year.
- Runtime.
- Genres.
- IMDb rating.
- Rotten Tomatoes rating.
- Personal rating.
- Director.
- Writer.
- Cast.
- Plot.
- Release date.
- Content rating.
- Country of origin.
- Box office.
- Production companies.

Required actions:

- Play trailer.
- Edit trailer URL.
- Replace poster.
- Delete movie.

### 4. Trailer Player Screen

Native iOS presentation for trailer playback.

Required behavior:

- Open from library or detail screen.
- Play YouTube embed-compatible trailer URLs.
- Close and return to the previous screen.
- Show a useful error if no trailer URL exists or playback cannot load.

Implementation note:

- The web app uses YouTube embed URLs in an iframe. iOS will likely need `WKWebView` for equivalent behavior.

### 5. Add Movie Screen

Required modes:

- Search by title.
- Add by IMDb URL or IMDb `tt...` ID.
- Optional trailer URL override.

Required title search behavior:

- Begin searching after the query has at least 2 characters.
- Show loading state while searching.
- Show search results with poster thumbnail, title, and year.
- Hide results already present in the current collection.
- Allow fast add from a result with an IMDb ID.

Required IMDb URL behavior:

- Accept a full IMDb title URL or any text containing a valid `tt...` ID.
- Reject invalid input with a visible error.

Required add behavior:

- Call `enrich-movie-from-imdb`.
- Save the enriched movie to Supabase.
- Insert a placeholder while enrichment is pending if implementing the web fast-add behavior.
- Remove the placeholder and show an error if enrichment or save fails.

### 6. Poster Preview / Poster Replacement Screen

Required content:

- Large poster image.
- Basic zoom or fit behavior.
- Replace poster action.

Required upload behavior:

- Pick an image from the device.
- Allow JPEG, PNG, or WebP if supported by the iOS picker/upload path.
- Upload to Supabase Storage.
- Save `poster_storage_path` on the movie row.
- Display the newly signed poster URL.

### 7. Edit Trailer URL Screen

Required behavior:

- Show current trailer URL.
- Accept YouTube watch/share/embed URLs if they can be normalized to an embed URL.
- Reject URLs that cannot be parsed as YouTube trailer URLs.
- Save only the trailer URL field.

### 8. Delete Confirmation

Required behavior:

- Confirm before deletion.
- Delete the movie row from the active collection.
- Show a recoverable error if deletion fails.

## Explicitly Excluded From MVP

- Android app.
- Web UI reuse.
- Marketplace features.
- Chat/social features.
- Poster designer database.
- IMCDb integration.
- Real-time IMDb or Rotten Tomatoes refresh after save.
- Advanced poster editing.
- Advanced poster preview hero animations from the web app.
- Complex keyboard shortcuts.
- Browser `localStorage` migration UI.
- Admin backfill tools.
- Public community library.
- Shared editing.
- Multiple library sharing modes.
- Offline-first sync conflict resolution.
- Push notifications.
- In-app account management beyond the chosen Supabase auth mode.

## First Launch Behavior

The iOS app should:

1. Initialize the Supabase client from app configuration.
2. Restore an existing Supabase session if present.
3. Ensure there is a signed-in Supabase user.
4. Load only the current user's rows from `filmbase_saved_movies`.
5. Convert any `poster_storage_path` values into signed URLs.
6. Show the library if remote data loads.
7. Show an empty state if the library is empty.
8. Show an error state if Supabase cannot be reached or authorization fails.

Data ownership decision:

- Each signed-in user has their own library.
- Users can only see, edit, and delete their own saved movies.
- Personal rating, custom poster, and trailer URL belong to the user.
- `filmbase_public_movies` must not be used as the iOS MVP's primary library table.

## Loading States

Required loading states:

- App startup library load.
- Poster image loading.
- Poster signed URL refresh.
- Title search in Add Movie.
- Movie enrichment after selecting a result or entering an IMDb URL.
- Saving a movie.
- Uploading a poster.
- Updating trailer URL.
- Deleting a movie.

## Empty States

Required empty states:

- No movies in collection.
- No results for current library search/filter.
- No Add Movie search results.
- Missing poster.
- Missing trailer.
- Missing optional detail metadata such as writer, box office, or production companies.

## Error States

Required error states:

- Missing or invalid Supabase configuration.
- Anonymous auth or login failure.
- Library load failure.
- Search API failure.
- Enrichment API failure.
- Save/update/delete failure.
- Poster upload failure.
- Poster signed URL failure.
- Trailer URL parse failure.
- Trailer playback failure.

Errors should be visible, concise, and recoverable. For library-level failures, the user should remain in the app instead of seeing a blank screen.

## Acceptance Criteria

The iOS MVP is ready when:

- A fresh install can launch, authenticate, and load a collection from Supabase.
- The library displays poster grid items with title, year, and personal rating.
- The user can search the local collection by title.
- The user can filter by genre, year bucket, rating, and recently added, or any intentionally reduced MVP subset documented before build.
- The user can sort by title, runtime, IMDb rating, Rotten Tomatoes rating, and personal rating, or any intentionally reduced MVP subset documented before build.
- The user can open movie details and see all available stored metadata.
- The user can play a trailer for a movie with a valid trailer URL.
- The user sees a useful missing-trailer state for movies without trailer URLs.
- The user can add a movie by title search result.
- The user can add a movie by IMDb URL or IMDb `tt...` ID.
- Add Movie rejects duplicates by IMDb ID.
- Add Movie handles enrichment failure without leaving broken rows in the UI.
- The user can edit a trailer URL and see the updated value after reload.
- The user can upload or replace a poster and see it after reload.
- The user can change personal rating and see it after reload.
- The user can delete a movie with confirmation.
- Supabase Storage posters continue to display after signed URLs expire by refreshing the signed URL.
- The app has explicit loading, empty, and error states for all network-backed operations.
- The app reads and writes the iOS MVP library through `filmbase_saved_movies`.
- The app does not use `filmbase_public_movies` as the primary iOS library.
- A user cannot see, edit, or delete another user's saved movie rows.
