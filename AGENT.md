# AGENT.md

## Project Overview

FilmBase is a desktop-style movie library and cinematic relationship exploration app.

The application combines:

- Personal movie collection management
- AI-generated Film DNA relationship graphs
- Poster preview and metadata browsing
- Desktop-inspired interaction design
- Cloud-backed persistence and AI-assisted metadata enrichment

The experience is heavily interaction-driven and visually refined.

Preserve UX feel and behavioral consistency during development.

---

# Interaction-First Development

When implementation tradeoffs appear between:

- feature quantity
- architectural purity
- interaction quality

prioritize interaction quality whenever reasonable.

FilmBase is an interaction-driven product.

---

# Architecture Governance

This project follows long-term system evolution principles.

The codebase is designed to support:

- established source-of-truth documentation
- architecture governance for AI-assisted development
- stable UI-facing data contracts
- reduced schema drift during feature evolution
- long-term system evolution documentation

Development decisions should prioritize consistency and maintainability over short-term convenience.

---

# Development Principles

## 1. Minimal Change Strategy

Do not rewrite large systems unless explicitly requested.

Prefer:

- targeted fixes
- isolated refactors
- incremental improvements

Avoid introducing architectural instability.

---

## 2. Preserve Existing UX Behavior

FilmBase is interaction-sensitive.

Do not alter:

- animation timing
- hover behavior
- preview transitions
- desktop window behavior
- drag behavior
- fullscreen/minimize logic

unless specifically requested.

Small visual regressions are considered important.

---

## 3. Read Before Editing

Before modifying code:

1. inspect related files
2. understand state flow
3. identify source of truth
4. avoid duplicate logic

Never assume state ownership.

---

# Source of Truth Rules

## Poster URLs

`movie.posterUrl` is always the UI-facing poster source.

Do not derive UI poster state from temporary preview state.

---

## Movie Data

`filmbase_public_movies` is the canonical movie dataset.

Avoid introducing parallel movie tables.

---

## Film DNA

Film DNA relationship nodes may contain:

- influence
- legacy
- previous / next entries

Poster enrichment must preserve existing node structure.

Do not mutate relationship trees during enrichment.

---

## Preview State

Preview UI state must remain separate from persistent movie data.

Temporary UI transforms should never overwrite database fields.

---

# Data Consistency & Evolution

Maintain long-term consistency across:

- database schema
- UI-facing contracts
- Supabase storage
- poster references
- Film DNA structures
- metadata synchronization

Avoid:

- duplicated sources of truth
- implicit data ownership
- schema fragmentation
- temporary compatibility hacks becoming permanent architecture

Backward compatibility matters.

Existing records and deployed behavior should remain stable whenever possible.

---

# AI Editing Rules

## Avoid Unsafe Refactors

Do not:

- rename large groups of variables
- move major file structures
- rewrite working animation systems
- replace existing interaction models

unless explicitly requested.

---

## Preserve Compatibility

Maintain compatibility with:

- existing Supabase schema
- existing poster storage
- existing deployed data
- existing Film DNA structures

Avoid breaking old records.

---

## Build Verification

Before suggesting deployment:

1. run build
2. check for TypeScript errors
3. verify imports
4. confirm no obvious runtime regressions
5. avoid introducing silent data regressions

---

# UI Philosophy

FilmBase is not a generic CRUD dashboard.

It should feel like:

- a desktop media application
- a curated film research tool
- a cinematic archive

Preserve atmosphere and interaction weight.

---

# Preferred Development Style

Prefer:

- clear data flow
- small composable functions
- stable interfaces
- explicit state ownership
- incremental evolution

Avoid:

- hidden magic
- unnecessary abstractions
- premature optimization
- duplicated state systems
- premature systemization
- over-engineered abstractions

Prefer straightforward architecture when additional complexity is not yet justified.

---

# Deployment Notes

Primary deployment target:

- Vercel frontend
- Supabase backend

Do not hardcode local development values into production code.

Use environment-aware configuration.
