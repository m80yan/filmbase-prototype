# Filmbase iOS Architecture

## Source of Truth

This document proposes the SwiftUI architecture for the Filmbase iOS MVP using the current migration docs as the source of truth:

- `docs/MIGRATION_DECISIONS.md`
- `docs/IOS_MVP_SCOPE.md`
- `docs/SUPABASE_SCHEMA.md`
- `docs/DATA_SCHEMA.md`
- `docs/MIGRATION_TO_IOS.md`

The iOS MVP is a personal movie poster collection and trailer watching app. The target table is `filmbase_saved_movies`. The current web app's `filmbase_public_movies` table is web/shared legacy context only and should not be the main iOS library model.

## Architectural Goals

- Keep SwiftUI views thin.
- Keep Supabase and Edge Function calls behind services.
- Keep domain models independent from SwiftUI.
- Make signed poster URL refresh explicit and testable.
- Treat loading, empty, and error states as first-class UI state.
- Keep reusable business logic portable for a future Android app.

## App Structure

Proposed Xcode structure:

```text
Filmbase/
  App/
    FilmbaseApp.swift
    AppEnvironment.swift
    AppRootView.swift

  Models/
    Movie.swift
    MovieCastDetail.swift
    MovieSearchHit.swift
    EnrichMovieResponse.swift
    LibraryFilter.swift
    LibrarySort.swift
    AppError.swift
    LoadableState.swift

  Services/
    AuthService.swift
    MovieLibraryService.swift
    MovieSearchService.swift
    MovieEnrichmentService.swift
    PosterStorageService.swift
    SignedPosterURLCache.swift
    TrailerURLNormalizer.swift

  ViewModels/
    AppSessionViewModel.swift
    LibraryViewModel.swift
    MovieDetailViewModel.swift
    AddMovieViewModel.swift
    PosterViewModel.swift
    TrailerPlayerViewModel.swift

  Views/
    LaunchLoadingView.swift
    Library/
      LibraryScreen.swift
      MoviePosterGrid.swift
      MoviePosterCell.swift
      LibraryToolbar.swift
      FilterSortSheet.swift
      EmptyLibraryView.swift
    MovieDetail/
      MovieDetailScreen.swift
      RatingControl.swift
      MetadataSection.swift
    AddMovie/
      AddMovieScreen.swift
      MovieSearchResultRow.swift
    Poster/
      PosterPreviewScreen.swift
      PosterImageView.swift
      PosterReplacementSheet.swift
    Trailer/
      TrailerPlayerScreen.swift
      YouTubeWebView.swift
    Shared/
      LoadingOverlay.swift
      ErrorBanner.swift
      EmptyStateView.swift

  Persistence/
    LibraryCacheStore.swift
    CachedMovieRecord.swift

  Resources/
    Assets.xcassets
    Config/
      SupabaseConfig.plist
```

## App Flow

Startup flow:

1. `FilmbaseApp` creates `AppEnvironment`.
2. `AppRootView` owns `AppSessionViewModel`.
3. `AppSessionViewModel` initializes Supabase configuration.
4. `AuthService` restores an existing session or signs in according to the chosen MVP auth mode.
5. `LibraryViewModel` loads only the current user's rows from `filmbase_saved_movies`.
6. `PosterStorageService` signs all rows with `poster_storage_path`.
7. `LibraryScreen` shows loaded movies, empty state, or recoverable error state.

Primary navigation:

```text
AppRootView
  LaunchLoadingView
  LibraryScreen
    MovieDetailScreen
    AddMovieScreen
    PosterPreviewScreen
    TrailerPlayerScreen
```

Use `NavigationStack` for library to detail navigation and sheets/full-screen covers for add movie, poster replacement, and trailer playback.

## Screens

### LaunchLoadingView

Purpose:

- Show app initialization, auth restoration, library load, and signed URL hydration.

States:

- Loading.
- Failed with retry.
- Failed but local cache available.

### LibraryScreen

Purpose:

- Main poster collection screen.

Responsibilities:

- Display poster grid.
- Search local collection by title.
- Filter by genre, year bucket, rating, and recently added.
- Sort by title, runtime, IMDb rating, Rotten Tomatoes rating, and personal rating.
- Start Add Movie.
- Open movie detail, poster preview, or trailer playback.

View model:

- `LibraryViewModel`

### MovieDetailScreen

Purpose:

- Show the selected movie's metadata and user-owned controls.

Responsibilities:

- Display poster, title, year, runtime, genres, ratings, director, writer, cast, plot, release details, country, box office, and production companies.
- Edit personal rating.
- Edit trailer URL.
- Replace poster.
- Delete movie with confirmation.

View model:

- `MovieDetailViewModel`

### AddMovieScreen

Purpose:

- Add a saved movie to the personal library.

Responsibilities:

- Search by title using `search-movies`.
- Show only results with non-empty IMDb IDs.
- Hide results already in the user's library.
- Add by IMDb URL or `tt...` ID.
- Accept optional trailer URL override.
- Call `enrich-movie-from-imdb`.
- Save the enriched row to `filmbase_saved_movies`.
- Handle placeholder state if fast-add is implemented.

View model:

- `AddMovieViewModel`

### PosterPreviewScreen

Purpose:

- Show a large poster and allow replacement.

Responsibilities:

- Display signed poster URL or external poster URL.
- Provide simple fit/zoom behavior for MVP.
- Pick a replacement image.
- Upload poster under `<auth.uid>/<movie_id>/poster.jpg`.
- Update `poster_storage_path` and clear `poster_url`.
- Refresh signed URL after upload.

View model:

- `PosterViewModel`

### TrailerPlayerScreen

Purpose:

- Play YouTube-compatible trailers.

Responsibilities:

- Normalize trailer URLs to supported YouTube embed/watch format.
- Present a `WKWebView`-backed player.
- Show missing-trailer and playback-failed states.

View model:

- `TrailerPlayerViewModel`

## Swift Models

### Movie

Use a domain model independent from Supabase row naming:

```swift
struct Movie: Identifiable, Equatable, Codable {
    let id: String
    var ownerId: String
    var title: String
    var year: Int
    var genres: [String]
    var imdbRating: Double
    var rottenTomatoes: Int
    var personalRating: Int
    var posterURL: URL?
    var posterStoragePath: String?
    var trailerURL: String
    var director: String
    var language: String
    var runtime: String
    var cast: [String]
    var dateAdded: Date
    var isFavorite: Bool
    var badge: String?
    var contentRating: String
    var plot: String
    var writer: String
    var tagline: String
    var releaseDate: String
    var countryOfOrigin: String
    var alsoKnownAs: [String]
    var productionCompanies: [String]
    var boxOffice: String
    var castDetails: [MovieCastDetail]
    var mediaType: MediaType?
}
```

Notes:

- `id` maps to database `movie_id`.
- `genres` maps to database `genre`.
- `ownerId` maps to `owner_id`.
- `mediaType` is returned by enrichment but is not currently persisted by the web app. Persist it only if the schema is updated.

### Supabase Row DTO

Use a separate DTO for snake_case database fields:

```swift
struct SavedMovieRow: Codable {
    var owner_id: String
    var movie_id: String
    var title: String?
    var year: Int?
    var genre: [String]?
    var imdb_rating: Double?
    var rotten_tomatoes: Int?
    var personal_rating: Int?
    var poster_url: String?
    var poster_storage_path: String?
    var director: String?
    var language: String?
    var runtime: String?
    var cast_members: [String]?
    var trailer_url: String?
    var date_added: Date?
    var is_favorite: Bool?
    var badge: String?
    var content_rating: String?
    var plot: String?
    var writer: String?
    var tagline: String?
    var release_date: String?
    var country_of_origin: String?
    var also_known_as: [String]?
    var production_companies: [String]?
    var box_office: String?
    var cast_details: [MovieCastDetail]?
}
```

Keep mapping functions explicit:

- `SavedMovieRow.toDomain(signedPosterURL:) -> Movie`
- `Movie.toSavedMovieRow(ownerId:) -> SavedMovieRow`

### Supporting Models

```swift
struct MovieCastDetail: Codable, Equatable {
    var name: String
    var character: String
}

struct MovieSearchHit: Codable, Identifiable, Equatable {
    var id: Int { tmdbId }
    var tmdbId: Int
    var imdbId: String?
    var title: String
    var originalTitle: String
    var releaseDate: String
    var year: Int?
    var posterUrl: URL?
    var overview: String
    var popularity: Double
    var voteAverage: Double
}

enum LibrarySort: Equatable {
    case titleAscending
    case titleDescending
    case runtimeAscending
    case runtimeDescending
    case imdbAscending
    case imdbDescending
    case rottenTomatoesAscending
    case rottenTomatoesDescending
    case personalRatingAscending
    case personalRatingDescending
}

struct LibraryFilter: Equatable {
    var searchText: String = ""
    var genres: Set<String> = []
    var yearBuckets: Set<YearBucket> = []
    var ratings: Set<Int> = []
    var recentlyAddedOnly: Bool = false
}
```

## Supabase Service Layer

### AuthService

Responsibilities:

- Initialize or receive the Supabase client.
- Restore the current session.
- Sign in according to the chosen MVP auth mode.
- Expose the current user id.
- Ensure every library operation has a user id.

Initial MVP auth may use anonymous auth if the Supabase project supports it, but the architecture should not hard-code anonymous auth into views.

Protocol:

```swift
protocol AuthServicing {
    var currentUserId: String? { get }
    func restoreOrSignIn() async throws -> String
    func signOut() async throws
}
```

### MovieLibraryService

Target table:

```text
filmbase_saved_movies
```

Responsibilities:

- Load movies scoped by `owner_id`.
- Upsert full saved movie rows using `(owner_id, movie_id)`.
- Update only trailer URL.
- Update only poster fields.
- Update personal rating.
- Delete only the current user's row.

Expected queries:

```text
select from filmbase_saved_movies where owner_id = currentUserId
upsert on owner_id,movie_id
update where owner_id = currentUserId and movie_id = movieId
delete where owner_id = currentUserId and movie_id = movieId
```

Do not query `filmbase_public_movies` for the primary iOS library.

### MovieSearchService

Responsibilities:

- Invoke `search-movies`.
- Debounce search from the view model, not the view.
- Return normalized `MovieSearchHit` values.
- Filter out hits without IMDb IDs.

### MovieEnrichmentService

Responsibilities:

- Invoke `enrich-movie-from-imdb`.
- Parse movie/TV metadata.
- Normalize missing values to app defaults.
- Return a domain-ready enrichment result.

### PosterStorageService

Responsibilities:

- Upload user-selected poster images to:

```text
<auth.uid>/<movie_id>/poster.jpg
```

- Create signed URLs with 3600 second TTL.
- Download/check poster existence if needed.
- Clear signed URL cache after upload.
- Return cache-busted signed URLs after replacement.

### SignedPosterURLCache

Responsibilities:

- Cache signed URLs by `poster_storage_path`.
- Track expiry time.
- Refresh when less than a small safety window remains.
- Force refresh on image load failure.

Cache key:

```text
poster_storage_path
```

Do not use the signed URL itself as durable identity.

## Auth Flow

Required MVP behavior:

1. App starts.
2. Restore existing Supabase session.
3. If no session exists, sign in using the chosen MVP auth method.
4. Read `auth.uid()`.
5. Load only `filmbase_saved_movies` rows where `owner_id` is the current user id.

Open implementation choice:

- Anonymous auth can match the current web startup style if enabled.
- Email/password, magic link, or Sign in with Apple can be added without changing library service boundaries.

RLS requirement:

- Reads, inserts, updates, and deletes must be owner-scoped by `owner_id = auth.uid()`.

## Image Loading And Signed URL Refresh

Poster source priority:

1. If `poster_storage_path` exists, create a signed URL and use it for display.
2. If signing fails, fall back to `poster_url`.
3. If no usable URL exists, show a local placeholder.

Signed URL behavior:

- TTL is 3600 seconds.
- Cache signed URLs in memory.
- Refresh signed URLs on expiry.
- Refresh signed URLs on image load failure.
- After poster upload, clear the cache entry and sign again with a cache-busting parameter.

SwiftUI implementation:

- Use a custom `PosterImageView` rather than raw `AsyncImage` everywhere.
- `PosterImageView` should accept a `Movie` or a `PosterSource`.
- It should report image failures to `PosterViewModel` or `SignedPosterURLCache`.
- It should show loading, placeholder, and failed states.

Local image cache:

- MVP can rely on `URLCache` for downloaded images.
- Store durable poster identity as `poster_storage_path`, not the signed URL.
- Do not persist signed URLs across app launches unless expiry is stored and respected.

## Trailer Playback Approach

The web app uses YouTube embed URLs in an iframe. iOS should use `WKWebView`.

Recommended MVP:

- `TrailerPlayerScreen` presented full-screen or as a sheet.
- `YouTubeWebView` wraps `WKWebView`.
- `TrailerURLNormalizer` converts accepted YouTube URL forms into a playable URL.
- Missing or invalid trailer URLs show a native error/empty state.

Supported input URL forms:

- YouTube watch URLs.
- YouTube share URLs.
- YouTube embed URLs.

Avoid building a custom video player for YouTube in the MVP.

## Local Cache Strategy

MVP cache goals:

- Make startup feel stable.
- Avoid blank library if a refresh fails after a previous successful load.
- Avoid storing stale signed URLs as permanent data.

Recommended MVP:

- Store the last successfully loaded personal library rows locally.
- Store domain data or row DTOs in a lightweight cache.
- Use `UserDefaults` or a JSON file for the first MVP if the library is small.
- Move to SwiftData or SQLite only when offline editing or larger libraries are required.

Cache contents:

- Movie metadata.
- `poster_storage_path`.
- External `poster_url`.
- Last successful load timestamp.

Do not cache as source of truth:

- Signed poster URLs without expiry metadata.
- Supabase auth secrets outside the Supabase client/session storage.

Offline behavior for MVP:

- Reading cached library is allowed.
- Writes should require network.
- Failed writes should show an error and keep local state consistent with the last confirmed server state.

## Error And Loading State Handling

Use a shared state type for async operations:

```swift
enum LoadableState<Value> {
    case idle
    case loading
    case loaded(Value)
    case empty
    case failed(AppError)
}
```

Use operation-specific flags where needed:

- `isSearching`
- `isEnriching`
- `isSaving`
- `isUploadingPoster`
- `isDeleting`
- `isRefreshingSignedURL`

Error categories:

- Configuration error.
- Auth error.
- Library load error.
- Search error.
- Enrichment error.
- Save/update/delete error.
- Poster upload error.
- Signed URL error.
- Trailer playback error.
- Validation error.

UI rules:

- Startup errors should offer retry.
- Row-level errors should not blank the whole library.
- Failed optimistic updates should roll back or reload from the server.
- Add Movie enrichment failure should not leave broken placeholder rows.
- Poster signing failure should fall back to `poster_url` or placeholder.

## Reusable Logic For Future Android

Keep these pieces platform-neutral in concept and documented as contracts:

- Supabase table contract for `filmbase_saved_movies`.
- Storage path contract: `<auth.uid>/<movie_id>/poster.jpg`.
- Edge Function contracts:
  - `search-movies`
  - `enrich-movie-from-imdb`
- Movie identity rules using IMDb `tt...` IDs.
- Duplicate detection by IMDb ID.
- Field mapping between database rows and domain movie model.
- Genre normalization and display labels.
- Year bucket filtering.
- Rating filtering.
- Recently added calculation.
- Sort rules.
- Trailer URL normalization.
- Poster fallback priority.
- Signed URL refresh rules.
- Error categories and retry behavior.

Avoid making these platform-specific:

- Backend request/response contracts.
- Domain model naming.
- Filter and sort behavior.
- Add Movie enrichment sequence.
- Poster storage ownership rules.

Platform-specific pieces:

- SwiftUI views.
- `WKWebView` trailer player.
- iOS photo picker.
- iOS image cache implementation.
- iOS navigation and sheet presentation.

## Non-MVP Architecture Notes

Do not build these into the initial architecture unless the product scope changes:

- Shared community library.
- Public editing.
- Social feed.
- Chat.
- Marketplace.
- Offline write queue and conflict resolution.
- Advanced poster editing.
- Android UI implementation.

## Implementation Order

Recommended build order:

1. Models and row/domain mappers.
2. Supabase client configuration.
3. Auth restoration/sign-in.
4. `MovieLibraryService` reading `filmbase_saved_movies`.
5. Library cache read/write.
6. Library grid UI with loading/empty/error states.
7. Signed poster URL service and `PosterImageView`.
8. Movie detail screen.
9. Trailer playback with `WKWebView`.
10. Add Movie search and enrichment.
11. Upsert saved movie.
12. Rating, trailer edit, poster upload, and delete operations.
13. End-to-end verification against RLS and Storage policies.

## Verification Checklist

- Fresh install can sign in and load only current user's saved movies.
- A user cannot read another user's `filmbase_saved_movies` rows.
- A user cannot update or delete another user's rows.
- Custom posters upload to `<auth.uid>/<movie_id>/poster.jpg`.
- Signed poster URLs refresh after expiry or image failure.
- Add Movie saves to `filmbase_saved_movies`, not `filmbase_public_movies`.
- Personal rating persists per user.
- Trailer URL persists per user.
- Delete removes only the current user's saved movie row.
- Cached library can display after a subsequent load failure.
- `filmbase_public_movies` is never used as the primary iOS library source.
