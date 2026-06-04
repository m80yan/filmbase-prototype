

# FilmBase Architecture

This document describes the high-level architecture and data flow of FilmBase.

FilmBase is designed as a cinematic archive system with desktop-inspired interaction behavior, AI-assisted metadata enrichment, and long-term architecture evolution in mind.

---

# System Overview

FilmBase consists of:

- React frontend application
- Supabase backend and storage
- External movie metadata providers
- AI-assisted Film DNA generation workflows
- Shared poster storage and enrichment systems

Primary goals:

- stable UI-facing contracts
- cinematic interaction consistency
- scalable metadata enrichment
- long-term data consistency
- AI-assisted development governance

---

# High-Level Architecture

```text
Frontend (React / Vite)
        ↓
Application State Layer
        ↓
Supabase APIs + Storage
        ↓
External Metadata Providers
(TMDb / OMDb / OpenAI)
```

---

# Frontend Architecture

## UI Layers

FilmBase uses layered desktop-style navigation:

```text
Library
→ Preview
→ Info
→ Film DNA
```

Each layer progressively increases focus depth.

The frontend prioritizes:

- interaction continuity
- spatial consistency
- cinematic transitions
- desktop-style interaction metaphors

---

## State Ownership

FilmBase separates:

- persistent data state
- transient UI state
- interaction state

Examples of transient UI state:

- fullscreen state
- hover state
- preview zoom state
- drag state
- transition state

Transient UI state must never become canonical persisted data.

---

# Canonical Data Sources

## Movie Dataset

Primary movie ownership:

```text
filmbase_public_movies
```

This table is the canonical movie source.

Avoid introducing parallel ownership systems.

---

## Poster Ownership

UI-facing poster source:

```text
movie.posterUrl
```

Poster rendering should always rely on stable UI-facing references.

Poster enrichment pipelines should not mutate unrelated movie state.

---

## Film DNA Structures

Film DNA is a graph-like cinematic relationship system.

Relationship types include:

- influence
- legacy
- previous / next
- lineage annotations

Film DNA enrichment should remain additive.

Relationship hierarchy should remain stable during enrichment passes.

---

# Metadata Enrichment Pipeline

Metadata may originate from:

- TMDb
- OMDb
- OpenAI-assisted enrichment
- local user edits

Enrichment flow:

```text
External Sources
        ↓
Normalization
        ↓
Canonical Movie Data
        ↓
Poster Enrichment
        ↓
UI Rendering
```

The system prioritizes compatibility across partially enriched records.

---

# Supabase Architecture

Supabase is used for:

- movie persistence
- poster storage
- metadata synchronization
- authentication workflows
- future RLS-compatible ownership

---

## Storage Layer

Shared poster storage supports:

- signed URLs
- cache busting
- centralized poster ownership
- stable UI-facing references

Avoid fragmented poster ownership patterns.

---

# Authentication Strategy

FilmBase currently supports lightweight and anonymous-oriented workflows.

Architecture goals include:

- low-friction interaction
- optional identity persistence
- compatibility with RLS-based ownership models

Authentication should not heavily interrupt exploration flows.

---

# Desktop Window Architecture

FilmBase uses a desktop-inspired shell architecture.

Core interaction systems include:

- draggable windows
- fullscreen transitions
- minimize / restore behavior
- layered modal exploration
- traffic-light window controls

The desktop shell is treated as part of the product identity rather than decorative UI chrome.

---

# Preview Architecture

Preview mode is treated as a dedicated exploration layer.

Preview behavior prioritizes:

- spatial continuity
- cinematic scale transitions
- interaction stability
- poster-focused immersion

Avoid abrupt context switching.

---

# Film DNA Architecture

Film DNA combines:

- graph-like relationships
- metadata enrichment
- poster rendering
- cinematic relationship exploration

The system is designed for progressive enrichment rather than requiring fully complete datasets.

Partial compatibility is important.

---

# Deployment Architecture

Frontend:

- Vercel

Backend / Infrastructure:

- Supabase

External Services:

- TMDb
- OMDb
- OpenAI APIs

---

# Evolution Principles

FilmBase architecture evolves incrementally.

Primary architecture goals:

- minimize schema drift
- preserve backward compatibility
- maintain stable UI-facing contracts
- reduce duplicated ownership
- preserve interaction consistency

Avoid premature over-engineering.

---

# AI-Assisted Development

FilmBase is designed to support AI-assisted development workflows.

Governance rules are documented in:

- `AGENT.md`
- `SYSTEM.md`
- `DESIGN.md`

Architecture evolution should remain:

- incremental
- inspectable
- maintainable
- regression-aware

---

# Long-Term Architecture Goals

Future architecture goals include:

- richer Film DNA relationship systems
- improved metadata enrichment reliability
- stronger ownership consistency
- scalable poster pipelines
- more advanced exploration systems
- improved archival tooling

FilmBase prioritizes long-term evolution over short-term feature velocity.