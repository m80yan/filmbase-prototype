# Skill System

This folder contains reusable AI collaboration knowledge collected during real production work.

Skills are not tutorials.
Skills are not generic best practices.

Skills are:
- production memory
- interaction philosophy
- historical battle scars
- AI workflow constraints
- reusable UX reasoning
- runtime behavior knowledge

---

# Structure

Skills are divided into:

- project-specific skills
- reusable interaction skills
- browser/runtime skills
- AI workflow skills
- cinematic UX skills

---

# Project Skills

## FILMBASE.skill.md

Project-level production knowledge for FilmBase.

Includes:
- cinematic desktop philosophy
- Film DNA interaction constraints
- window system behavior
- fullscreen logic
- preview transition lessons
- AI drift prevention
- data consistency rules

FilmBase skills are highly tied to:
- cinematic interaction design
- desktop illusion systems
- immersive media presentation

---

# Reusable Skills

## animation.skill.md

Shared motion and interaction knowledge collected across:
- FilmBase
- ASCII Camera
- chibi-snake
- other UI experiments

Includes:
- cinematic pacing
- spatial continuity
- transition stability
- physicality illusion
- shared transition behavior
- animation workflow safety

---

# Philosophy

## AI tends to normalize interfaces

AI models naturally tend toward:
- generic SaaS layouts
- standardized spacing
- common UI conventions
- over-optimized interaction patterns

Skills exist partly to preserve:
- product personality
- cinematic pacing
- interaction uniqueness
- emotional hierarchy
- visual identity

---

## Skills are production memory

The most valuable skills usually come from:
- failed experiments
- animation bugs
- runtime inconsistencies
- UX regressions
- AI-generated mistakes
- difficult debugging sessions

Real production failures often generate the highest-value skills.

---

## Skills evolve over time

Skills should be continuously refined.

As projects evolve:
- new lessons appear
- workflows improve
- runtime behavior changes
- AI behavior changes

Skill systems should evolve with them.

---

# Long-Term Goal

The long-term goal is to build:
- reusable AI collaboration memory
- reusable interaction philosophy
- reusable cinematic UI knowledge
- reusable workflow constraints

---

# Current FilmBase Onboarding Notes

These notes help a coding agent quickly understand the current FilmBase context before touching code.

## Active Project Context

FilmBase is a React + Vite + Tailwind web app that simulates a desktop-style macOS media library experience.

Current local project path:
- `/Users/test/Documents/cinevault`

Current working branch:
- `polish/interaction-details`

Core product priorities:
- desktop-like interaction feel
- stable visual hierarchy
- cinematic media presentation
- minimal code changes
- long-term maintainability
- no unrelated refactors

Primary verification commands:

```bash
npm run build
git diff --check
```

A coding agent should not commit unless explicitly asked.

---

## How AI Agents Should Work in This Repo

Before editing, inspect the existing implementation pattern.

Preferred workflow:

1. Read the relevant docs first.
2. Inspect the current code path.
3. Explain the smallest safe implementation plan.
4. Wait for approval before major edits.
5. Preserve unrelated behavior.
6. Run verification after implementation.
7. Report changed files, build result, and remaining risks.

Avoid:
- broad App.tsx refactors
- renaming established concepts
- changing UI styling while solving data problems
- introducing new abstractions before checking existing helpers
- treating AI output as stable product data without persistence

---

## Docs Claude Code Should Read First

For current FilmBase work, read these before editing code:

- `docs/skills/FILMBASE.skill.md`
- `docs/skills/ai-workflow.skill.md`
- `docs/film-dna-spec.md`
- `docs/SUPABASE_SCHEMA.md`
- `docs/DATA_SCHEMA.md`
- `docs/API_AND_BACKEND.md`
- `docs/DEV_LOG.md`
- root `README.md`, if present

If a file is missing or stale, say so before making assumptions.

---

## Recommended Claude Code First Prompt

Use this when handing FilmBase to Claude Code:

```txt
This is the FilmBase project.

Project path:
/Users/test/Documents/cinevault

Before changing code, read the project docs first:
- docs/skills/README.md
- docs/skills/FILMBASE.skill.md
- docs/skills/ai-workflow.skill.md
- docs/film-dna-spec.md
- docs/SUPABASE_SCHEMA.md
- docs/DATA_SCHEMA.md
- docs/API_AND_BACKEND.md
- docs/DEV_LOG.md

Do not edit code yet.

After reading the docs, inspect the current implementation and answer:
1. Where is Film DNA opened from?
2. Where is Film DNA graph generation triggered?
3. Does it call a Supabase Edge Function or another API?
4. Where is the Supabase client/helper?
5. What is the current movie object shape?
6. What is the most reliable cache key for persisted Film DNA graphs?
7. How are posterUrl values handled for center and relationship nodes?
8. What is the smallest safe implementation plan to make Film DNA generate once, persist to Supabase, and load stored graph data afterward?

Constraints:
- Do not redesign the Film DNA UI.
- Do not refactor unrelated App.tsx areas.
- Preserve current Preview, Library, Trailer, Sidebar, and Add Movie behavior.
- Prefer minimal changes.
- Run npm run build and git diff --check only after implementation, not during this investigation step.

Output a concise implementation plan with exact files likely to change.
```

---

## Current Film DNA Direction

Film DNA should move away from repeated live AI generation.

Target behavior:

1. Open Film DNA for a center movie.
2. Check Supabase for an existing persisted Film DNA graph.
3. If a ready graph exists, render it immediately.
4. If no graph exists, generate once.
5. Normalize the generated graph.
6. Save the graph to Supabase.
7. Future opens should load the stored graph instead of regenerating.

Architecture principle:

```txt
AI generation = creation path
Supabase persisted graph = source of truth
```

This is intended to solve:
- slow node generation
- unstable results across clicks
- different graphs for the same movie
- poster enrichment inconsistency
- unpredictable UI layout data

---

## Film DNA Node Rules

Each side of the center node should contain 0–3 nodes.

Influence side:
- earlier works that clearly shaped, inspired, preceded, or strongly relate to the center film

Legacy side:
- later works that were clearly influenced by, descended from, or strongly connected to the center film

Rules:
- do not force exactly 3 nodes
- do not pad weak or generic recommendations
- strong relationship quality is more important than visual symmetry
- avoid duplicates across both sides
- preserve posterUrl when available
- preserve relationship labels and reasons when available
- remove low-confidence filler if confidence exists

Expected node shape:

```ts
type FilmDnaNode = {
  title: string
  year: number
  imdbId?: string
  posterUrl?: string
  relationshipLabel?: string
  relationshipReason?: string
  confidence?: "high" | "medium" | "low"
}
```

---

## Known Film DNA Risk

A previous Film DNA issue involved relationship node posters not displaying because poster enrichment did not return `posterUrl` for relationship nodes, while the center node used a separate `centerPosterUrl` path.

When changing Film DNA persistence or generation, inspect how poster fields are mapped for:

- center node
- influence nodes
- legacy nodes

Do not assume poster fields are consistent without checking the current implementation.

---

## Current Handoff Boundary

The immediate handoff goal is Film DNA stability and speed.

In scope:
- inspect Film DNA implementation path
- inspect Supabase helper / Edge Function path
- add persisted Film DNA graph lookup if needed
- add first-time generation save path if needed
- normalize generated graph data before save/render
- keep node count to 0–3 per side
- preserve existing Film DNA visuals

Out of scope unless explicitly requested:
- redesigning the graph layout
- changing node positions
- adding new visual states
- changing Preview Mode shell
- changing Sidebar / Library / Trailer behavior
- broad `App.tsx` cleanup
- migration to iOS
- marketplace, social, poster-designer, or account features

## Current Project Risk Pattern

Most recent regressions came from small interaction-state mismatches, not from missing large architecture.

When a task touches interaction state, check:
- pointer inert behavior
- disabled opacity stacking
- hover vs pressed states
- modal / popup scroll locking
- background shift while overlays are open
- whether Library, Preview, Trailer, and Sidebar states are accidentally coupled

Prefer one precise fix over structural cleanup.