# FilmBase

FilmBase is a desktop-style cinematic archive and movie relationship exploration app.

The project combines:

- personal movie collection management
- AI-generated Film DNA relationship graphs
- cinematic metadata exploration
- poster-centric browsing
- desktop-inspired interaction design

FilmBase is designed to feel closer to a native desktop media application than a traditional web dashboard.

---

# Core Features

## Movie Library

- Poster Grid view
- List view
- Sorting and filtering
- Local movie management
- Metadata editing

---

## Poster Preview System

- Large cinematic poster previews
- Smooth zoom transitions
- Fullscreen-style exploration
- High-resolution poster support

---

## Film DNA

Film DNA is an AI-assisted cinematic relationship system.

Movies may contain:

- influences
- legacy relationships
- previous / next connections
- cinematic lineage annotations

The feature is designed as a relationship exploration experience rather than a traditional recommendation engine.

---

## Desktop-Style Window System

FilmBase includes:

- draggable desktop windows
- traffic-light controls
- fullscreen transitions
- minimize behavior
- desktop shell interactions

The interaction system is heavily inspired by desktop operating systems and media software.

---

# Technology Stack

Frontend:

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Motion
- Lucide React

Backend / Infrastructure:

- Supabase
- Vercel

External Data Sources:

- TMDb
- OMDb
- OpenAI APIs

---

# Development Philosophy

FilmBase prioritizes:

- interaction feel
- cinematic atmosphere
- stable data architecture
- long-term system evolution
- AI-assisted development governance

The project intentionally avoids generic SaaS dashboard patterns.

---

# Architecture Documentation

Project architecture and development governance are documented in:

- `AGENT.md`
- `SYSTEM.md`
- `DESIGN.md`

Additional technical documentation can be found inside:

`/docs`

---

# Local Development

Prerequisite: Node.js.

Install dependencies:

```bash
npm install
```

Start development server:

```bash
npm run dev
```

Default local address:

```text
http://localhost:3000
```

To use another port:

```bash
npm run dev -- --port 3001
```

---

# Build

```bash
npm run lint
npm run build
```

Production output is generated in:

```text
dist/
```

---

# Deployment

Frontend deployment:

- Vercel

Backend and storage:

- Supabase

Recommended Vercel configuration:

```text
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

Environment variables are required for production deployment.

---

# Project Status

FilmBase is an actively evolving experimental cinematic archive system focused on:

- interaction-heavy UX
- AI-assisted metadata systems
- desktop-inspired interfaces
- long-term architecture consistency
