

# FILMBASE.skill.md

Project-level AI collaboration and production knowledge for FilmBase.

This file documents historical lessons, UX intent, interaction constraints, animation behavior, data consistency rules, and AI workflow guidance discovered during real production.

---

# UX Philosophy Skills

## FilmBase should feel cinematic

FilmBase is not a generic SaaS dashboard.

Avoid:
- enterprise admin panel layouts
- analytics-style spacing
- overly dense information hierarchy
- aggressive UI optimization
- generic web-app motion

Prefer:
- cinematic pacing
- emotional spacing
- desktop-like physicality
- archival atmosphere
- immersive preview transitions

---

## Film DNA is an exploration surface

Film DNA should feel like:
- cinematic relationship discovery
- legacy exploration
- emotional lineage mapping

Avoid:
- engineering graph aesthetics
- highly technical node layouts
- overly dense visual structures
- drag-heavy interaction systems

Horizontal scrolling is acceptable.
Zooming is intentionally unsupported.

---

# Window System Skills

## Fullscreen behavior

FilmBase behaves differently depending on environment.

Inside iframe:
- default to fullscreen mode

Outside iframe:
- use desktop window mode
- default window size is 1280×960

Do not rely only on viewport size.
Always detect iframe context.

---

## Desktop illusion

The desktop environment is part of the FilmBase experience.

When minimized or closed:
- keep wallpaper visible
- keep FilmBase desktop icon visible
- preserve window state
- preserve window position

Do not destroy desktop continuity.

---

## Traffic light behavior

Traffic light controls should feel macOS-like.

Rules:
- only visible on hover
- keep pointer cursor
- avoid exaggerated hover animation

Green button:
- toggle fullscreen

Yellow button:
- minimize to desktop
- disabled in fullscreen mode

Red button:
- close into desktop state
- preserve recoverability

---

# Animation Skills

## Shared transition animation

Preview transitions depend on stable geometry.

Always:
- preload image naturalSize
- compute target rect before animation
- use consistent aspect ratio logic
- apply transforms after double requestAnimationFrame

Otherwise:
- preview may jitter
- preview may overshoot
- animation may start from incorrect dimensions

---

## Preview motion language

Preview transitions should feel:
- cinematic
- physical
- slightly heavy
- spatially readable

Avoid:
- snappy modal motion
- dashboard-style animation
- harsh easing
- abrupt opacity transitions

---

## Resize behavior

Preview layout and sliders must continuously respond to window resizing.

Do not permanently cache viewport dimensions.
Always recompute geometry after resize.

---

# Film DNA Skills

## Film DNA persistence direction

Film DNA should not behave like a fresh AI answer every time the user opens it.

Target architecture:
- generate once
- normalize once
- persist to Supabase
- read persisted data on future opens

Product rule:
- OpenAI generation is a creation path
- Supabase persisted Film DNA graph data is the source of truth

This avoids:
- slow repeated generation
- unstable node sets across clicks
- different graphs for the same center movie
- inconsistent poster enrichment
- unpredictable graph layout data

Default behavior:
1. Open Film DNA for a center movie.
2. Check Supabase for an existing ready graph.
3. If found, render the stored graph immediately.
4. If not found, call OpenAI once through the existing trusted generation path.
5. Normalize the generated graph.
6. Save it to Supabase.
7. Render the saved graph.

Do not add a visible regenerate or refresh control unless explicitly requested.

## OpenAI output instability

Film DNA generation uses the OpenAI API. OpenAI output is probabilistic and should be treated as draft graph data until normalized and persisted.

Never assume:
- valid JSON
- stable relationship ordering
- complete node structures
- valid poster fields

Always normalize OpenAI output before rendering or saving.

Normalization must:
- cap influence nodes to 0–3
- cap legacy nodes to 0–3
- keep series previous/next nodes independent from influence and legacy caps
- remove the center film from all relationship lists
- remove duplicate nodes across influence, legacy, and series lists
- remove same-title variants unless verified as a direct sequel, direct prequel, official remake, or same-continuity franchise entry
- remove invalid nodes without title or year
- remove low-confidence filler when confidence exists
- preserve posterUrl when available
- preserve relationshipLabel when available
- preserve relationshipReason when available

Do not persist raw OpenAI response text as the stable graph record.
Persist the normalized graph shape the UI expects.

## OpenAI API handling

Film DNA relationship data is generated through the OpenAI API.

Security rules:
- do not expose `OPENAI_API_KEY` to browser/client code
- do not store OpenAI API keys in frontend files
- do not commit `.env` files or secrets
- prefer an existing Supabase Edge Function or trusted server-side path for OpenAI calls

Before changing Film DNA generation, inspect:
- where OpenAI is called
- where `OPENAI_API_KEY` is stored or read
- which OpenAI model is used
- what prompt or schema asks OpenAI to return
- how OpenAI JSON output is parsed and validated
- whether poster enrichment happens before or after OpenAI generation

Implementation rule:

```txt
OpenAI API = generation path
Supabase persisted graph = source of truth
```

Do not solve Film DNA stability with React-only cache. The result must survive refreshes and future sessions.

---

## Film DNA node quality

Influence and Legacy nodes are lateral relationship nodes.
Each side of the center node should contain 0–3 nodes.

Series Previous and Series Next nodes are vertical Y-axis relationship nodes.
They are independent from the 0–3 lateral Influence and Legacy caps.

Influence side:
- earlier works that clearly shaped, inspired, preceded, or strongly relate to the center film

Legacy side:
- later works that were clearly influenced by, descended from, or strongly connected to the center film

Rules:
- do not force exactly 3 nodes
- for widely recognized, historically significant, or canonically influential films, aim for 2–3 Influence nodes when defensible
- for widely recognized, historically significant, or canonically influential films, aim for 2–3 Legacy nodes when defensible
- avoid sparse graphs for films with clear cinematic lineage
- for obscure, recent, niche, or weakly connected films, fewer nodes are acceptable
- do not pad weak or generic recommendations
- strong relationship quality is more important than visual symmetry
- avoid duplicate titles, years, or IMDb IDs
- prefer clear film-level relationships over loose genre similarity
- fewer strong nodes are better than a full but weak graph

Same-title and center duplicate rules:
- do not include the center film itself as any relationship node
- do not include same-title records as Influence, Legacy, Series Previous, or Series Next unless the relationship is verified as a direct sequel, direct prequel, official remake, or same-continuity franchise entry
- same-title records with different years must not be placed on the Y-axis by default
- if a same-title record appears to be a duplicate, malformed metadata entry, poster duplicate, or unrelated title collision, remove it during normalization

Series rules:
- series nodes are not counted as Influence or Legacy nodes
- series nodes represent direct franchise, sequel, prequel, or same-continuity ordering only
- Series Previous should contain earlier films in the same series or direct continuity
- Series Next should contain later films in the same series or direct continuity
- order series nodes from nearest to farthest relative to the center film
- do not place remakes, same-title variants, alternate adaptations, or shared-source works on the Y-axis unless they are verified as direct series continuity

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

## Poster reconciliation

Relationship nodes must use:
- posterUrl

Center node uses:
- centerPosterUrl

Do not mix these fields.

When changing Film DNA persistence, generation, or enrichment, inspect current mapping for:
- center node poster field
- influence node poster field
- legacy node poster field

Do not assume poster fields are consistent without checking the current implementation.

---

## Relationship graph readability

Prefer:
- centered composition
- emotional hierarchy
- readable node spacing
- cinematic annotation placement

Avoid:
- overly compressed layouts
- purely mathematical graph spacing
- visually noisy node structures

---

# Data Consistency Skills

## Persisted data should be the source of truth

For features that need stable repeatable output, prefer persisted Supabase data over repeated OpenAI generation.

Examples:
- Film DNA graphs
- curated movie metadata
- poster overrides
- trailer overrides

Repeated OpenAI generation is acceptable only as a first-time creation path, repair path, or explicitly requested regeneration path.

## movie.posterUrl is UI-facing

movie.posterUrl should always represent:
- stable UI-facing poster data

Avoid:
- temporary backend-only URLs
- mixed data ownership
- inconsistent poster source switching

---

## Never overwrite manual customization

Do not overwrite manually customized:
- trailer overrides
- poster overrides
- curated metadata

Automatic refresh systems must preserve manual edits.

---

## Migration safety

Before changing:
- storage structure
- auth system
- movie identifiers
- poster pipeline

Always:
- preserve backward compatibility
- maintain fallback logic
- test existing library rendering

---

# AI Workflow Skills

## Investigation before implementation

Before editing FilmBase code, a coding agent should first identify:
- the exact trigger path
- the relevant state shape
- existing helper functions
- existing Supabase access pattern
- existing OpenAI call path, if the task touches Film DNA generation
- existing OpenAI model and prompt/schema, if the task touches Film DNA generation
- existing loading and error states
- existing fallback behavior

Do not implement from assumptions when a current pattern already exists.

## Use Ask mode before Agent mode

Before changing:
- animation systems
- desktop layout
- Film DNA rendering
- fullscreen behavior
- transition architecture

Use Ask mode first.

Large AI-generated refactors may damage interaction consistency.

---

## Create checkpoints before risky changes

Before changing:
- animation timing
- layout systems
- preview transitions
- fullscreen logic
- state synchronization

Always create git checkpoint first.

---

## AI tends to normalize custom UI

AI models tend to:
- simplify cinematic layouts
- standardize unique UI
- remove asymmetrical spacing
- convert interfaces into generic SaaS patterns

Protect:
- large cinematic tabs
- desktop illusion
- immersive spacing
- cinematic hierarchy
- distinctive interaction behavior

---

# Browser & Runtime Skills

## iframe behavior differs from standalone browser

Notion iframe mode and standalone browser mode behave differently.

Do not assume:
- identical fullscreen behavior
- identical sizing
- identical viewport calculations

Always test both environments.

---

## Browser media behavior can differ

Camera, audio, autoplay, and rendering behavior may differ across:
- Chrome
- Safari
- Arc
- embedded preview environments

Verify browser-level behavior before debugging application logic.