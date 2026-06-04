# SYSTEM.md

# FilmBase System Architecture

FilmBase is a desktop-style cinematic archive system focused on:

- movie collection management
- AI-generated relationship mapping
- poster-centric browsing
- metadata enrichment
- long-term data consistency

This document defines the core architectural rules of the system.

---

# Core System Principles

## 1. Source of Truth First

Every major system must have a clearly defined source of truth.

Avoid:

- duplicated ownership
- derived persistence
- conflicting UI state
- multiple canonical datasets

---

## 2. UI State Is Not Persistent State

Transient UI behavior must never become persistent data.

Examples:

- preview transforms
- fullscreen state
- temporary poster zoom
- hover state
- animation state

must remain UI-only.

---

## 3. Stable UI-Facing Contracts

UI-facing fields should remain stable whenever possible.

Examples:

- `movie.posterUrl`
- movie identifiers
- Film DNA node structure

Avoid unnecessary breaking changes.

---

# Canonical Data Sources

## Movie Dataset

Canonical source:

`filmbase_public_movies`

This table represents the primary movie dataset.

Avoid introducing parallel movie tables.

---

## Poster Data

UI-facing poster source:

`movie.posterUrl`

Poster rendering should always rely on stable UI-facing references.

Avoid temporary override chains becoming permanent architecture.

---

## Film DNA Structures

Film DNA relationships are graph-like structures containing:

- influence
- legacy
- previous / next relationships

Relationship enrichment should not mutate structural hierarchy.

Enrichment layers should remain additive.

---

# System Evolution Rules

## Backward Compatibility

Preserve compatibility with:

- deployed records
- existing poster storage
- historical metadata
- older Film DNA responses

Avoid destructive migrations whenever possible.

---

## Schema Evolution

Schema changes should:

1. preserve compatibility
2. avoid duplicate ownership
3. maintain migration safety
4. minimize UI breakage

Avoid rapid uncontrolled schema drift.

---

## Storage Consistency

Poster storage and metadata references must remain synchronized.

Avoid:

- orphaned poster references
- stale cache chains
- inconsistent signed URL flows

---

# Frontend Architecture Principles

## Desktop Shell

FilmBase is designed as a desktop-style application.

Core interaction layers include:

- desktop shell
- window controls
- preview mode
- cinematic navigation
- metadata browsing

These layers should remain behaviorally consistent.

---

## Interaction Weight

Animations and transitions are part of the product identity.

Do not casually alter:

- transition timing
- hover behavior
- preview scaling
- fullscreen behavior
- minimize behavior

---

# AI-Assisted Development Governance

AI-assisted development must prioritize:

- consistency
- maintainability
- architectural stability
- explicit ownership
- minimal regression risk

AI-generated refactors should remain incremental unless explicitly requested.

---

# Deployment Architecture

Primary stack:

- Vercel
- Supabase
- TMDb
- OMDb
- OpenAI APIs

Environment configuration must remain deployment-safe.

Never hardcode local credentials or temporary development values.

