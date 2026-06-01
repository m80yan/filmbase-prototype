

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

## GPT output instability

Film DNA generation is probabilistic.

Never assume:
- valid JSON
- stable relationship ordering
- complete node structures
- valid poster fields

Always normalize AI output before rendering.

---

## Poster reconciliation

Relationship nodes must use:
- posterUrl

Center node uses:
- centerPosterUrl

Do not mix these fields.

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