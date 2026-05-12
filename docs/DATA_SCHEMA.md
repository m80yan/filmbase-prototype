# Data Schema

## Main Table
filmbase_saved_movies

## Purpose
Stores each user's saved movie library.

## Important Fields
- owner_id: uuid
- movie_id: string
- title: string
- year: string | number
- genres: string[]
- poster_url: string | null
- poster_storage_path: string | null
- trailer_url: string | null
- personal_rating: number | null
- created_at: timestamp
- updated_at: timestamp

## Unique Key
(owner_id, movie_id)

This prevents the same user from saving the same movie multiple times.

## RLS
Users can only read, insert, update, and delete their own saved movies.

Rule:
owner_id = auth.uid()

## Storage
Bucket:
filmbase-posters

Path:
<auth.uid>/<movie_id>/poster.jpg

## Future Tables
- profiles
- movie_posters
- poster_artists
- user_collections
- social_follows
- user_comments
- marketplace_items

## Notes
Current schema is enough for the iOS MVP.

Before adding social, marketplace, poster designer pages, or Android support, the schema should be reviewed again.