# Data Schema

## Main Table
filmbase_saved_movies

## Important Fields
- owner_id
- movie_id
- title
- year
- genres
- poster_url
- poster_storage_path
- trailer_url
- personal_rating
- created_at
- updated_at

## Storage
Bucket:
filmbase-posters

Path:
<auth.uid>/<movie_id>/poster.jpg