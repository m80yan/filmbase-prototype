

# animation.skill.md

Shared animation and interaction-motion knowledge collected across FilmBase, ASCII Camera, chibi-snake, and other UI experiments.

This file focuses on:
- motion feel
- cinematic pacing
- interaction continuity
- animation stability
- perceived physicality
- AI-safe animation workflows

---

# Motion Philosophy

## Motion should communicate spatial continuity

Animations should help users understand:
- where elements come from
- where they are going
- what layer they belong to
- how interfaces relate spatially

Avoid motion that feels disconnected from layout.

---

## Motion should feel physical, not decorative

Prefer:
- weight
- inertia
- spatial continuity
- readable acceleration
- believable movement

Avoid:
- random floating
- excessive bounce
- flashy UI motion
- purely decorative animation

---

## Cinematic pacing is slower than dashboard pacing

Cinematic UI should allow users to perceive:
- scale
- depth
- transition intention
- visual hierarchy

Avoid overly fast transitions.

Fast transitions often make interfaces feel:
- generic
- SaaS-like
- emotionally flat

---

# Shared Transition Skills

## Always preload dimensions before transition

Before animating images or previews:
- preload naturalSize
- compute geometry first
- lock aspect ratio logic

Never animate from unknown dimensions.

Otherwise:
- transitions may jitter
- elements may overshoot
- layout may snap mid-animation

---

## Shared transitions require stable geometry

Always:
- compute target rect before animation
- preserve source and destination continuity
- avoid recalculating layout during active transition

Shared transitions become unstable when layout changes mid-animation.

---

## Use double requestAnimationFrame for layout-sensitive animation

When applying transforms after layout updates:
- use double requestAnimationFrame
- wait for browser layout stabilization

This helps prevent:
- animation popping
- incorrect transform origins
- stale geometry calculations

---

# UI Motion Skills

## Modals should not feel like browser alerts

Avoid:
- instant opacity pop-in
- harsh scale transitions
- aggressive easing

Prefer:
- layered fade
- spatial continuity
- subtle scale transitions
- smooth opacity blending

---

## Preview systems should feel immersive

Preview motion should feel:
- cinematic
- immersive
- slightly heavy
- visually stable

Avoid:
- twitchy movement
- overly responsive scaling
- abrupt fullscreen jumps

---

## Hover motion should support readability

Hover states should:
- clarify interactivity
- reinforce hierarchy
- improve focus

Avoid hover animation that distracts from content.

---

# Animation Stability Skills

## Layout changes are dangerous during animation

Avoid:
- resizing containers during active transitions
- changing DOM hierarchy mid-animation
- recalculating layout every frame unnecessarily

These often cause:
- jitter
- snapping
- transition desync

---

## Resize behavior must remain continuous

Interfaces should remain visually stable during window resizing.

Always:
- recompute geometry continuously
- avoid stale viewport caches
- update layout progressively

---

## Aspect ratio consistency is critical

Opening and closing animations must use:
- identical aspect ratio logic
- identical target rect calculations

Mismatched aspect ratio calculations create visual instability.

---

# AI Workflow Skills

## AI tends to over-optimize motion

AI models often:
- speed up transitions
- remove intentional pauses
- simplify cinematic timing
- normalize unique interaction patterns

Protect intentional pacing.

---

## Preserve interaction personality

Animation is part of product identity.

Do not allow AI to:
- standardize motion language
- replace cinematic transitions with generic easing
- convert immersive interactions into dashboard patterns

---

## Create checkpoints before animation rewrites

Before changing:
- transition architecture
- fullscreen logic
- layout timing
- animation systems
- motion easing

Always create git checkpoints.

Animation regressions are often difficult to fully undo.

---

# Browser Runtime Skills

## Browser rendering behavior differs across environments

Animation timing and rendering may differ across:
- Chrome
- Safari
- Arc
- embedded preview environments
- iframe contexts

Always verify motion behavior in real runtime environments.

---

## Embedded preview environments may distort timing

Cursor preview environments may not perfectly match standalone browsers.

Do not assume animation smoothness observed in preview environments reflects production behavior.

Always verify:
- fullscreen transitions
- media rendering
- animation timing
- viewport calculations

in standalone browser environments.