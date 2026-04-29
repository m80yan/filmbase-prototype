# FilmBase Prototype

A Vite + React movie library prototype with a macOS-inspired interface. Movies are seeded from local project data and user edits are stored in browser `localStorage`.

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Motion
- Lucide React

## Run Locally

Prerequisite: Node.js.

```bash
npm install
npm run dev
```

The app runs on:

```text
http://localhost:3000
```

To use another port:

```bash
npm run dev -- --port 3001
```

## Build

```bash
npm run lint
npm run build
```

The production output is generated in `dist/`.

## Deploy To Vercel

Use the Vite defaults:

```text
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

## Notes

- The current movie library is stored in `src/constants.ts`.
- Existing `localStorage` movies are merged with the seeded movie list at runtime.
- The current add-movie flow still calls OMDb from the browser. A later backend API should move OMDb/TMDb calls server-side before production use.
- Some Google AI Studio compatibility configuration is intentionally still present in the Vite/env setup.
