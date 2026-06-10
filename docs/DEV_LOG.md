# Dev Log

## 2026-05-12
Phase 0 started.

Goal:
Prepare Filmbase web project for iOS migration using Codex.

Notes:
- Core value remains movie poster collection and trailer watching.
- iOS MVP should reuse Supabase backend.
- Web UI will not be directly reused.

---

## 2026-06-10
Current FilmBase web work is focused on interaction polish, desktop-app feel, and Film DNA stabilization.

### Current branch context

Active working branch:
- `polish/interaction-details`

Project path:
- `/Users/test/Documents/cinevault`

The web app is still the active design and coding surface. iOS migration notes remain useful, but current work should not assume the web UI is being replaced immediately.

### Recent interaction polish areas

Recent work and discussion included:
- macOS-style desktop window shell and traffic-light behavior
- close, minimize, fullscreen, and disabled traffic-light states
- sidebar search and filter behavior
- toolbar disabled-state visual consistency
- Add Movie modal behavior and search-field icon opacity
- Delete Movie confirmation behavior
- Poster Preview entry points from poster grid and list view
- Poster Preview trigger semantics and tooltip copy
- Trailer playback background-inert behavior
- list view and poster view pressed / hover states
- sidebar reset / clear-filter interaction direction
- grid-size slider consistency across responsive card counts

Current interaction principle:
- preserve desktop-like behavior
- avoid broad visual redesign while fixing state issues
- make disabled states visually consistent without double opacity
- prefer precise local fixes over large refactors

### Film DNA current issue

Film DNA currently has a product/data problem:
- node generation is slow
- repeated opens can generate different node sets
- the same center movie can receive different Film DNA results across clicks or sessions
- this makes the feature feel unstable instead of curated

Target direction:
- generate once
- normalize generated data
- persist the graph to Supabase
- load the persisted graph on future opens

Architecture principle:

```txt
AI generation = creation path
Supabase persisted graph = source of truth
```

Film DNA should not regenerate a new graph every normal open once a ready persisted graph exists.

### Film DNA product rules

Influence and Legacy sides should each contain 0–3 nodes.

Rules:
- do not force exactly 3 nodes
- do not pad weak or generic recommendations
- strong relationship quality is more important than symmetry
- prefer clear film-level relationships over loose genre similarity
- remove duplicates across both sides
- remove invalid nodes without title or year
- remove low-confidence filler if confidence exists
- preserve `posterUrl`, `relationshipLabel`, and `relationshipReason` when available

### Known Film DNA technical risk

A previous Film DNA poster issue involved relationship node posters not rendering because relationship nodes expected `posterUrl`, while the center node used a separate center poster path.

When changing Film DNA generation, enrichment, or persistence, inspect current poster mapping for:
- center node
- influence nodes
- legacy nodes

Do not assume poster fields are consistent without checking current code.

### Claude Code onboarding direction

Before Claude Code edits Film DNA, it should inspect:
- where Film DNA mode is entered
- where graph generation is triggered
- whether generation uses Supabase Edge Functions or local helpers
- current Film DNA state shape
- current movie object shape
- stable cache key candidates such as IMDb ID or internal movie ID
- existing Supabase client/helper patterns
- existing loading and error states
- poster enrichment behavior for relationship nodes

The first Claude Code step should be investigation and a minimal implementation plan, not immediate code edits.

### Verification expectation

After implementation work, run:

```bash
npm run build
git diff --check
```

Final report should include:
- files changed
- database SQL or migration required
- chosen cache key and why
- how cached lookup works
- how first-time generation works
- how duplicate regeneration is avoided or reduced
- build result
- remaining risks or manual Supabase steps

Do not commit unless explicitly asked.