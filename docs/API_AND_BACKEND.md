# API and Backend

## Backend

FilmBase uses Supabase as the current backend.

Current backend responsibilities include:
- anonymous auth
- movie search / enrichment
- saved movie storage
- poster storage
- poster URL resolution
- trailer override persistence
- Film DNA graph generation path
- future Film DNA graph persistence

The web app remains the active implementation surface. Backend docs should describe the current web backend first; iOS migration notes should not override the current web implementation.

---

## Auth

Current direction:
- anonymous auth is used for the current web prototype
- future user login may be needed

Before changing auth behavior, inspect the current Supabase client setup and RLS policies.

Do not assume that all data is user-private. Some FilmBase data is app-level shared library data, while some data may be user-specific.

---

## Database

Known / referenced tables:
- `filmbase_saved_movies`
- `filmbase_public_movies`
- proposed: `filmbase_film_dna_graphs`

Current data-layer direction:
- `filmbase_public_movies` is intended to act as shared movie metadata / public library source of truth where applicable
- user-specific saved data should remain separate from shared movie metadata
- generated graph data that should remain stable should be persisted instead of regenerated every time

Before editing database access code, inspect:
- current Supabase helper file names
- current table names used by the client
- current movie object shape
- current RLS policies
- whether writes happen from client code or Edge Functions

---

## Storage

Known storage bucket:
- `filmbase-posters`

Storage is used for poster assets and poster override behavior.

Important poster behavior:
- center movie poster and relationship node posters may use different field paths
- Film DNA relationship nodes require `posterUrl`
- center node may use the current preview poster / center poster path

When changing enrichment or persistence, inspect poster mapping before assuming a shared poster field.

---

## Edge Functions

Known / referenced Edge Functions:
- `search-movies`
- `enrich-movie-from-imdb`

Possible Film DNA related responsibilities may include:
- OpenAI relationship generation
- poster enrichment for related nodes
- movie metadata lookup
- IMDb / TMDb / OMDb reconciliation
- future persisted Film DNA graph writes

Before implementing Film DNA persistence, inspect whether Film DNA generation currently happens in:
- `src/App.tsx`
- a frontend helper
- a Supabase helper
- a Supabase Edge Function
- another API path

Do not create a new Edge Function before checking whether an existing generation/enrichment path already exists.

---

## External APIs

Known / referenced external APIs:
- TMDb
- OMDb
- IMDb ID mapping
- OpenAI API for Film DNA relationship generation

External API responsibilities may include:
- title search
- IMDb enrichment
- poster lookup
- metadata refresh
- Film DNA relationship generation
- Film DNA related-node poster enrichment

External API results should be normalized before being persisted or rendered.

---

## OpenAI API Usage

Film DNA relationship generation is based on the OpenAI API.

OpenAI should be treated as a generation service, not the source of truth.

Target OpenAI behavior:
- call OpenAI only when no persisted ready Film DNA graph exists
- normalize OpenAI output before saving or rendering
- save normalized graph data to Supabase
- future opens should read Supabase instead of calling OpenAI again

Security constraints:
- do not expose `OPENAI_API_KEY` to browser/client code
- do not store OpenAI API keys in frontend files
- do not commit `.env` files or secrets
- prefer a Supabase Edge Function or trusted server-side path for calls that require `OPENAI_API_KEY`

Before changing OpenAI logic, inspect:
- where the OpenAI API is currently called
- whether the call is inside a Supabase Edge Function
- which model is used
- what prompt/schema is sent
- how JSON output is parsed
- how failures are handled
- whether poster enrichment happens before or after OpenAI generation

Implementation rule:

```txt
OpenAI API = generation path
Supabase persisted graph = source of truth
```

Do not solve Film DNA stability by repeatedly calling OpenAI and caching only in React state. Persistence must survive page refreshes and future sessions.

---

## Film DNA Generation and Persistence

Film DNA currently has a product/data stability problem:
- generation can be slow
- repeated opens can produce different relationship nodes
- the same center movie can receive different graph results across clicks or sessions
- unstable graph data makes the feature feel less curated

Target behavior:

```txt
open Film DNA
→ read persisted graph from Supabase
→ if ready graph exists, render it
→ if no graph exists, call OpenAI once through the existing trusted generation path
→ normalize generated data
→ save graph to Supabase
→ render saved graph
→ future opens read stored graph instead of regenerating
```

Architecture principle:

```txt
OpenAI API = creation path
Supabase persisted graph = source of truth
```

Proposed table:
- `filmbase_film_dna_graphs`

The implementation should not regenerate a new graph on every normal open once a ready graph exists.

### Film DNA Implementation Checklist

Before implementation, inspect:
- where Film DNA mode is entered from Preview Mode
- where graph generation is triggered
- whether generation is client-side or Edge Function based
- where OpenAI is called
- where `OPENAI_API_KEY` is stored / read
- which OpenAI model is currently used
- what prompt or schema asks OpenAI to return
- where Supabase reads/writes should live
- current Film DNA graph state shape
- current movie object shape
- stable cache key candidates such as IMDb ID or internal movie ID
- existing loading and error states
- current poster enrichment path
- whether generated relationship nodes already include `posterUrl`

Do not implement from assumptions if current field names or helpers differ from the docs.

### Film DNA Cache Key

Film DNA persistence needs one stable key per center movie.

Preferred order:
1. IMDb ID, if reliably available and normalized
2. internal movie ID, if more stable in the app
3. title + year fallback only if no stronger ID exists

Do not assume whether the current field is named:
- `id`
- `movieId`
- `movie_id`
- `imdbId`
- `imdb_id`

The chosen key must match both frontend movie data and Supabase persistence.

### Film DNA Normalization

Before saving or rendering generated Film DNA output:
- ensure influence nodes are an array
- ensure legacy nodes are an array
- cap influence nodes to 0–3
- cap legacy nodes to 0–3
- remove duplicate nodes across both sides
- remove invalid nodes without title or year
- remove low-confidence filler if confidence exists
- preserve `posterUrl` when available
- preserve `relationshipLabel` when available
- preserve `relationshipReason` when available

Strong relationship quality is more important than visual symmetry. Do not pad weak or generic recommendations just to fill three slots.

### Film DNA Write Path

Claude Code should inspect current backend conventions before choosing the write path.

Possible write paths:
- client-side insert/upsert into Supabase, if consistent with current prototype policies
- Edge Function write using trusted/server-side permissions, if generation already runs through an Edge Function

Expected direction:
- allow fast reads of ready graphs
- avoid unrestricted public updates
- prefer narrow policies or trusted writes where possible

If OpenAI generation already runs in an Edge Function, prefer keeping OpenAI and persistence close together so the browser does not need access to secret keys.

---

## Backend Change Rules

When editing backend-related code:
- inspect existing helper patterns first
- avoid duplicating Supabase client setup
- avoid broad schema assumptions
- preserve current working movie search and enrichment behavior
- preserve poster and trailer override behavior
- do not expose OpenAI API keys to the browser
- do not change auth or RLS behavior unless the task explicitly requires it
- document any manual SQL or Supabase dashboard steps required

Verification after backend-related implementation:

```bash
npm run build
git diff --check
```

Final report should include:
- files changed
- Edge Functions changed or added
- tables changed or added
- RLS policies changed or required
- manual Supabase SQL required
- chosen cache key and why
- OpenAI call path and model, if touched
- build result
- remaining risks