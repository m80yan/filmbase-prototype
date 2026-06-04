

# CHANGELOG

All notable system, architecture, UX, and infrastructure changes to FilmBase are documented here.

This changelog focuses on meaningful product and system evolution rather than every minor commit.

---

# [Current Evolution Phase]

## Architecture Governance

- Added `AGENT.md` for AI-assisted development governance
- Added `SYSTEM.md` for core architecture and source-of-truth rules
- Added `DESIGN.md` for interaction philosophy and UX consistency
- Introduced long-term system evolution documentation structure
- Established architecture governance for AI-assisted development workflows

---

## Data Consistency & Evolution

- Migrated toward stable source-of-truth architecture
- Reduced schema drift across evolving movie data systems
- Refined stable UI-facing data contracts
- Improved backward compatibility handling
- Consolidated canonical movie ownership into `filmbase_public_movies`
- Reduced duplicated data ownership patterns
- Improved poster reference consistency
- Added signed URL and cache-busting poster handling
- Improved metadata synchronization consistency

---

## Desktop Window System

- Added desktop-style application shell
- Added draggable window behavior
- Added fullscreen transitions
- Added minimize behavior and desktop restoration
- Added traffic-light window controls
- Added desktop layering behavior
- Refined rounded corner and shadow rendering
- Improved desktop interaction consistency

---

## Poster Preview System

- Added cinematic poster preview mode
- Added smooth preview transition behavior
- Improved zoom interaction consistency
- Added fullscreen-style poster exploration
- Improved preview spatial continuity
- Fixed preview transition positioning inconsistencies
- Improved preview rendering stability

---

## Film DNA

- Added AI-assisted Film DNA relationship system
- Added influence and legacy relationship visualization
- Added previous / next relationship support
- Added cinematic lineage annotations
- Improved Film DNA poster enrichment pipeline
- Improved relationship graph consistency
- Refined relationship node rendering behavior
- Improved compatibility for partially enriched graph structures

---

## Metadata & External Data

- Added TMDb metadata integration
- Added OMDb metadata integration
- Added metadata enrichment workflows
- Improved metadata refresh handling
- Added targeted metadata refresh flows
- Improved compatibility across mixed metadata sources

---

## Supabase & Storage

- Added Supabase integration
- Added shared poster storage system
- Added signed poster URL support
- Improved storage consistency handling
- Added anonymous authentication workflows
- Added RLS-compatible architecture preparation
- Improved deployment-safe environment handling

---

## UX & Interaction Evolution

- Refined interaction weight and timing
- Improved hover consistency
- Improved layered exploration flow
- Refined cinematic navigation behavior
- Improved desktop-inspired interaction patterns
- Reduced generic dashboard-style interaction behavior
- Improved UI hierarchy consistency
- Refined scrollbar behavior across layered interfaces

---

## Deployment & Infrastructure

- Added Vercel deployment support
- Improved production build consistency
- Improved environment configuration handling
- Improved deployment-safe architecture patterns

---

# [Early Prototype Phase]

## Initial Prototype

- Built initial Vite + React prototype
- Added local movie library system
- Added localStorage persistence
- Added macOS-inspired UI direction
- Established poster-grid interaction model
- Established early preview workflows