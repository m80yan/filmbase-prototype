

# FilmBase Data Model

This document defines the primary data ownership rules, canonical fields, and long-term data consistency strategy for FilmBase.

The goal of this document is to reduce:

- schema drift
- duplicated ownership
- unstable UI contracts
- enrichment conflicts
- silent data regressions

---

# Core Data Philosophy

FilmBase prioritizes:

- stable UI-facing contracts
- explicit ownership
- additive enrichment
- backward compatibility
- incremental evolution

Avoid implicit ownership and duplicated canonical state.

---

# Canonical Movie Ownership

Primary canonical movie dataset:

```text
filmbase_public_movies
```

This table represents the authoritative movie dataset.

Avoid introducing:

- parallel movie tables
- duplicated ownership systems
- temporary canonical datasets

---

# Primary Movie Fields

## Stable UI-Facing Fields

These fields should remain stable whenever possible.

| Field | Purpose |
|---|---|
| `movie.posterUrl` | Primary UI-facing poster source |
| `movie.title` | Display title |
| `movie.year` | Release year |
| `movie.imdbID` | External identity mapping |
| `movie.tmdbId` | TMDb relationship mapping |

Avoid unnecessary breaking changes to UI-facing contracts.

---

# Poster Ownership Model

## Canonical Poster Source

Primary UI-facing poster field:

```text
movie.posterUrl
```

Poster rendering should always depend on stable UI-facing references.

---

## Poster Storage Strategy

Poster storage supports:

- shared storage ownership
- signed URLs
- cache busting
- centralized poster consistency

Avoid:

- fragmented poster ownership
- multiple competing poster sources
- temporary override chains becoming permanent architecture

---

# Film DNA Data Model

Film DNA is treated as a graph-like enrichment layer.

Relationship types may include:

- influence
- legacy
- previous / next
- lineage annotations

Film DNA data should remain:

- additive
- progressively enrichable
- partially compatible
- structurally stable

---

## Film DNA Node Structure

Typical Film DNA nodes may contain:

| Field | Purpose |
|---|---|
| `title` | Display title |
| `posterUrl` | Relationship poster rendering |
| `relationshipType` | Influence / legacy / etc |
| `year` | Temporal context |
| `metadata` | Additional enrichment |

Relationship enrichment should not mutate unrelated hierarchy structure.

---

# Metadata Enrichment Model

Metadata may originate from:

- TMDb
- OMDb
- OpenAI-assisted enrichment
- local user editing

Enrichment pipeline:

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

# State Separation Rules

FilmBase separates:

- persistent data
- UI state
- interaction state
- transient animation state

Transient UI state must never become canonical persisted state.

Examples:

- fullscreen state
- hover state
- drag state
- preview zoom state
- transition state

---

# Data Consistency Rules

## Stable Ownership

Every major field should have:

- explicit ownership
- predictable mutation paths
- stable UI-facing behavior

Avoid implicit ownership chains.

---

## Backward Compatibility

Schema evolution should preserve:

- historical movie records
- older poster references
- partially enriched metadata
- existing Film DNA structures

Avoid destructive migration patterns whenever possible.

---

## Schema Evolution

Future schema evolution should prioritize:

- additive changes
- migration safety
- compatibility
- explicit ownership
- low regression risk

Avoid rapid uncontrolled schema drift.

---

# Authentication & Ownership

FilmBase currently supports lightweight and anonymous-oriented workflows.

Future ownership models may include:

- user-specific libraries
- RLS-based ownership
- collaborative enrichment
- curator-level editing systems

Ownership systems should remain compatible with stable UI-facing contracts.

---

# Long-Term Data Goals

Future goals include:

- richer Film DNA enrichment
- more stable metadata normalization
- improved poster consistency
- stronger ownership guarantees
- scalable archival systems
- safer schema evolution

FilmBase prioritizes long-term data stability over short-term feature velocity.