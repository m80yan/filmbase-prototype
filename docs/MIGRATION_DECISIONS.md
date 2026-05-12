# Migration Decisions

## Decision 001: iOS MVP Library Model

The iOS MVP will use a personal library model.

Each signed-in user has their own movie library.

## Rules

- Users can only see their own saved movies.
- Users can only edit their own saved movies.
- Users can only delete their own saved movies.
- Personal rating belongs to the user.
- Custom poster belongs to the user.
- Trailer URL belongs to the user.
- The iOS MVP will not use a shared public movie library as the main model.

## Reason

The current web app uses a shared public table, but the iOS MVP should be safer and easier to scale as a user-based product.

## Impact

The iOS MVP should be built around:

filmbase_saved_movies

not:

filmbase_public_movies

## Excluded from MVP

- Public community library
- Social feed
- Chat
- Marketplace
- Shared editing