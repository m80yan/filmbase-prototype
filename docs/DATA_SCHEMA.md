# Data Schema

## Main Table
filmbase_saved_movies

## Purpose
Target table for the iOS MVP. Stores each signed-in user's personal movie library.

The current web app also uses `filmbase_public_movies` as a shared public library, but that table is not the target table for the iOS MVP.

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
