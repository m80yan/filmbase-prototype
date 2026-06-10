# Film DNA Visual System Spec

## Overview

Film DNA is a cinematic relationship map shown inside the poster preview lightbox.

It is NOT:
- a technical graph editor
- a flowchart
- a node programming UI

It SHOULD feel like:
- a cinematic genealogy map
- a film influence constellation
- a visual relationship board

The Film DNA canvas exists inside Preview Mode and inherits the Info Mode visual environment.

The system contains:

- Background Poster
- Background Dim Overlay
- Influence Nodes
- Legacy Nodes
- Series Nodes
- Connection Lines
- Center Poster

## Current Implementation Problem

The current Film DNA behavior is treated too much like live generation.

Observed issues:
- node generation is slow
- repeated opens can produce different relationship nodes
- the same movie can receive different Film DNA graphs across sessions or clicks
- graph content is not stable enough to feel like library data

This feature should feel curated and repeatable. A user should not wonder whether the same movie will have a different DNA map tomorrow.

## Product Behavior Direction

Film DNA should be a stable cinematic relationship record, not a fresh AI response on every open.

Target behavior:

1. User opens Film DNA for the current preview movie.
2. App checks Supabase for an existing persisted Film DNA graph for that center movie.
3. If a ready graph exists, render the persisted graph immediately.
4. If no ready graph exists, generate it once.
5. Normalize the generated graph.
6. Save the normalized graph to Supabase.
7. Render the saved graph.
8. Future opens should read the stored graph and should not regenerate by default.

Architecture principle:

```txt
OpenAI API = creation path
Supabase persisted graph = source of truth
```

Film DNA relationship data is generated through the OpenAI API, but OpenAI output should not be treated as stable product data by itself.

The app should call OpenAI only when no persisted ready graph exists for the center movie.

This direction is intended to solve:
- slow node generation
- unstable relationship sets
- different results for the same movie across clicks
- inconsistent poster enrichment
- unpredictable graph layout data

Do not add a visible regenerate or refresh button unless explicitly requested.

## OpenAI Generation Role

Film DNA relationship data is generated using the OpenAI API.

OpenAI output is probabilistic and should be treated as draft graph data.

Product rule:
- OpenAI generates the first draft of a Film DNA graph.
- The app normalizes the generated result.
- Supabase stores the normalized graph.
- The stored graph becomes the repeatable source of truth.

The UI should not regenerate a different OpenAI result on every normal open.

Security rule:
- do not expose `OPENAI_API_KEY` to browser/client code
- do not store OpenAI API keys in frontend files
- prefer an existing Supabase Edge Function or trusted server-side path for calls that require `OPENAI_API_KEY`

Before changing OpenAI generation, inspect:
- where the OpenAI API is currently called
- whether the call is inside a Supabase Edge Function
- which OpenAI model is used
- what prompt or schema is sent
- how JSON output is parsed
- how failures are handled
- whether poster enrichment happens before or after OpenAI generation

## Layer Hierarchy

lightbox
├── Background
│   ├── Background Poster
│   └── Background Dim Overlay
├── Lines
│   ├── Line Influence 01
│   ├── Line Influence 02
│   ├── Line Influence 03
│   ├── Line Legacy 01
│   ├── Line Legacy 02
│   ├── Line Legacy 03
│   ├── Line Series Prev
│   └── Line Series Next
├── Influence Nodes
│   ├── Influence Node 01
│   ├── Influence Node 02
│   └── Influence Node 03
├── Center Node
├── Legacy Nodes
│   ├── Legacy Node 01
│   ├── Legacy Node 02
│   └── Legacy Node 03
├── Series Previous Node
└── Series Next Node

## Node Rules

### Shared Node Layout

Poster → 16px gap → Title → 0px gap → Year

All nodes:
- left aligned
- single-line title
- single-line year
- no title wrapping
- title overflow should not increase node width
- title overflow behavior:
  - default: ellipsis allowed
  - hover: horizontal marquee reveal
- node width remains fixed
- node height uses hug contents in Figma
- implementation should use `height: auto`

### Influence Node

Poster size: 114 × 171  
Node width: 114px  
Text size: 14px  
Text opacity: 25%  
Text color: #ffffff  
Poster opacity: 25%

### Legacy Node

Poster size: 114 × 171  
Node width: 114px  
Text size: 14px  
Text opacity: 25%  
Text color: #ffffff  
Poster opacity: 25%

### Series Node

Poster size: 114 × 171  
Node width: 114px  
Text size: 14px  
Text opacity: 25%  
Text color: #ffffff  
Poster opacity: 25%

### Center Node

Uses the current preview poster.

Positioned at the center of Background Dim Overlay.

Center Node should be centered on both X and Y axis.

Poster size: 114 × 171  
Node width: 114px  
Text size: 14px  
Opacity: 100%

## Hover Behavior

Hovering a node should:
- scale the poster
- increase poster opacity to 100%
- increase title/year opacity to 100%
- highlight the connected path

Hover scale and transition timing should inherit from Poster View hover cards.

Default node opacity:
25%

Hover node opacity:
100%

### Hover Path Rules

Hover Influence Node:
- hovered Influence Node opacity: 100%
- connected Influence Line opacity: 100%
- Center Node opacity: 100%
- all other nodes and lines remain at 25%

Hover Legacy Node:
- hovered Legacy Node opacity: 100%
- connected Legacy Line opacity: 100%
- Center Node opacity: 100%
- all other nodes and lines remain at 25%

Hover Series Node:
- hovered Series Node opacity: 100%
- connected Series Line opacity: 100%
- Center Node opacity: 100%
- all other nodes and lines remain at 25%

Hover Center Node:
- Center Node opacity: 100%
- all directly connected lines opacity: 100%
- all nodes opacity: 100%

## Connection Rules

### Influence

Influence Node → Center Node

### Legacy

Center Node → Legacy Node

### Series Previous

Series Previous Node → Center Node

### Series Next

Center Node → Series Next Node

Connection style:
- start point: circle
- end point: triangle
- no glow
- default opacity: 25%
- hover opacity: 100%

## Background Rules

Background Poster opacity:
inherit from Info Mode

Background Dim Overlay opacity:
inherit from Info Mode

Z-index system:
inherit from Info Mode

## Drag Behavior

If the Film DNA canvas exceeds the lightbox viewport:

- allow X/Y dragging
- drag only the Film DNA canvas
- do not drag the preview window
- do not affect toolbar or sidebar

## Data Rules

### OpenAI Output Rule

OpenAI output must be normalized before it becomes app data.

Do not directly render raw OpenAI output without validation.

Do not persist raw untrusted OpenAI response text as the stable graph record.

Persist the normalized graph shape that the UI expects.

### Persistence Rule

Film DNA graph data should be persisted.

Default lookup flow:

```txt
open Film DNA
→ query persisted graph by stable center movie key
→ render ready graph if found
→ otherwise generate once
→ normalize
→ save
→ render saved result
```

The persisted graph should be the default source of truth after the first successful generation.

The implementation must inspect the current movie object before choosing the final cache key.

Possible stable keys:
- IMDb ID, if reliably available
- internal movie ID, if more stable in the app
- title + year fallback only if no stronger ID exists

Do not assume the final cache key without checking the current implementation.

### Node Count

Influence: max 3  
Legacy: max 3  
Series Previous: max 1  
Series Next: max 1

Influence and Legacy should be 0–3 nodes each.

Do not force exactly 3 nodes.

Strong relationship quality is more important than visual symmetry.

If a strong relationship does not exist, render fewer nodes and omit the corresponding line.

### Ordering

Influence 01/02/03:
left[0]/left[1]/left[2]

Legacy 01/02/03:
right[0]/right[1]/right[2]

Series Previous:
seriesPrevious[0]

Series Next:
seriesNext[0]

### Missing Data

If a node does not exist:
- do not render the node
- do not render the corresponding line

If poster data is unavailable:
- render text-only node

### Relationship Quality Rules

Influence means earlier works that clearly shaped, inspired, preceded, or strongly relate to the center film.

Legacy means later works that were clearly influenced by, descended from, or strongly connected to the center film.

Rules:
- prefer clear film-level relationships over loose genre similarity
- avoid generic recommendations
- avoid duplicate titles, years, or IMDb IDs
- avoid filler nodes added only to fill visual slots
- fewer strong nodes are better than a full but weak graph
- low-confidence nodes should not be displayed if confidence exists

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

### Normalization Rules

Before rendering or saving generated Film DNA output:

- ensure influence nodes are an array
- ensure legacy nodes are an array
- cap influence nodes to 0–3
- cap legacy nodes to 0–3
- remove duplicate nodes across both sides
- remove invalid nodes without title or year
- remove low-confidence filler if confidence exists
- preserve `posterUrl` when available
- preserve `relationshipLabel` when available
- preserve `relationshipReason` when available

Normalization should happen before persistence so stored graph data stays stable and clean.

## Influence Node CSS

width: 114px;
height: auto; /* Figma: Hug contents */

### Poster CSS

width: 114px;
height: 171px;
aspect-ratio: 2/3;

### Title CSS

color: rgba(255, 255, 255, 0.50);
font-family: "SF Pro";
font-size: 14px;
font-style: normal;
font-weight: 510;
line-height: normal;

white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;

/* On hover, replace/augment ellipsis with horizontal marquee reveal. */

### Year CSS

color: rgba(255, 255, 255, 0.50);
font-family: "SF Pro";
font-size: 14px;
font-style: normal;
font-weight: 510;
line-height: normal;

white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;

## Center Node CSS

width: 114px;
height: auto; /* Figma: 221px visual height / Hug contents */

Positioning:
- centered on Background Dim Overlay
- centered on both X and Y axis
- uses current preview poster image

### Center Poster CSS

width: 114px;
height: 171px;
aspect-ratio: 2/3;
opacity: 100%;

### Center Title CSS

color: #FFF;
font-family: "SF Pro";
font-size: 14px;
font-style: normal;
font-weight: 510;
line-height: normal;

white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;

/* On hover, replace/augment ellipsis with horizontal marquee reveal. */

### Center Year CSS

color: #FFF;
font-family: "SF Pro";
font-size: 14px;
font-style: normal;
font-weight: 510;
line-height: normal;

white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;


## Film DNA Line Assets — Updated

Base stage:
- width: 1080px
- height: 871px

Center Poster:
- x: 483
- y: 350
- width: 114
- height: 171

Center poster anchor points:
- left edge center: x 483, y435.5
- right edge center: x 597, y435.5
- top edge center: x 540, y 350
- bottom edge center: x 540, y 521

---

### Line Influence 01

Figma bounding box:
- x: 51
- y: 415.5
- width: 426.5
- height: 133

Implementation SVG size:
- width: 426.5
- height: 133

Expected center anchor:
- ends at Center Poster left edge center: x 483, y435.5

Source anchor:
- starts at Influence Node 01 poster right edge center: x 51, y 533.5

SVG:
```svg
<svg width="432" height="124" viewBox="0 0 432 124" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M421.833 9.63743C421.833 10.1897 422.51 10.5802 422.988 10.3041L430.679 5.86393C431.157 5.58779 431.157 4.80674 430.679 4.5306L422.988 0.0904298C422.51 -0.185713 421.833 0.204812 421.833 0.757096V9.63743ZM220.333 5.19727V4.19727L219.333 5.19727H220.333ZM220.333 118.197V119.197L221.333 118.197H220.333ZM0.000162601 118.197C0.000162601 121.143 2.38798 123.531 5.3335 123.531C8.27901 123.531 10.6668 121.143 10.6668 118.197C10.6668 115.252 8.27901 112.864 5.3335 112.864C2.38798 112.864 0.000162601 115.252 0.000162601 118.197ZM422.833 5.19727V4.19727H220.333V5.19727V6.19727H422.833V5.19727ZM220.333 5.19727H219.333V118.197H220.333H221.333V5.19727H220.333ZM220.333 118.197V117.197H5.3335V118.197V119.197H220.333V118.197Z" fill="white" fill-opacity="0.25"/>
</svg>
```


Implementation notes:
- These line SVGs are exported from Figma as filled paths, not stroke paths.
- Render the exported SVG paths as-is inside React components.
- Do not recreate these lines with CSS.
- Do not calculate these line geometries with `getBoundingClientRect` or `ResizeObserver`.
- In React JSX, convert SVG attributes to camelCase, for example `fill-opacity` → `fillOpacity`.
- Default fill opacity is 25%; hover/focused-path state should set fill opacity to 100%.

### Line Influence 01

```svg
<svg width="434" height="139" viewBox="0 0 434 139" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M423.833 9.63743C423.833 10.1897 424.51 10.5802 424.988 10.3041L432.679 5.86393C433.157 5.58779 433.157 4.80674 432.679 4.5306L424.988 0.0904298C424.51 -0.185713 423.833 0.204812 423.833 0.757096V9.63743ZM221.333 5.19727V4.19727L220.333 5.19727H221.333ZM221.333 133.197V134.197L222.333 133.197H221.333ZM0.000162601 133.197C0.000162601 136.143 2.38798 138.531 5.3335 138.531C8.27901 138.531 10.6668 136.143 10.6668 133.197C10.6668 130.252 8.27901 127.864 5.3335 127.864C2.38798 127.864 0.000162601 130.252 0.000162601 133.197ZM424.833 5.19727V4.19727H221.333V5.19727V6.19727H424.833V5.19727ZM221.333 5.19727H220.333V133.197H221.333H222.333V5.19727H221.333ZM221.333 133.197V132.197H5.3335V133.197V134.197H221.333V133.197Z" fill="white" fill-opacity="0.25"/>
</svg>
```

### Line Influence 02
```svg
<svg width="320" height="145" viewBox="0 0 320 145" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M309.833 143.773C309.833 144.325 310.51 144.716 310.988 144.44L318.679 140C319.157 139.724 319.157 138.942 318.679 138.666L310.988 134.226C310.51 133.95 309.833 134.341 309.833 134.893V143.773ZM209.333 139.333H208.333L209.333 140.333V139.333ZM209.333 5.33301H210.333L209.333 4.33301V5.33301ZM0.000162601 5.33301C0.000162601 8.27853 2.38798 10.6663 5.3335 10.6663C8.27901 10.6663 10.6668 8.27853 10.6668 5.33301C10.6668 2.38749 8.27901 -0.00032568 5.3335 -0.00032568C2.38798 -0.00032568 0.000162601 2.38749 0.000162601 5.33301ZM310.833 139.333V138.333H209.333V139.333V140.333H310.833V139.333ZM209.333 139.333H210.333V5.33301H209.333H208.333V139.333H209.333ZM209.333 5.33301V4.33301H5.3335V5.33301V6.33301H209.333V5.33301Z" fill="white" fill-opacity="0.25"/>
</svg>
```

### Line Influence 03
```svg
<svg width="206" height="302" viewBox="0 0 206 302" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M195.833 9.63792C195.833 10.1902 196.51 10.5807 196.988 10.3046L204.679 5.86442C205.157 5.58828 205.157 4.80723 204.679 4.53109L196.988 0.0909181C196.51 -0.185225 195.833 0.2053 195.833 0.757585V9.63792ZM159.333 5.19775H158.333L159.333 6.19775V5.19775ZM159.333 4.86328H160.333L159.333 3.86328V4.86328ZM139.333 4.86328V3.86328L138.333 4.86328H139.333ZM139.333 295.863V296.863L140.333 295.863H139.333ZM0.000162601 295.863C0.000162601 298.809 2.38798 301.197 5.3335 301.197C8.27901 301.197 10.6668 298.809 10.6668 295.863C10.6668 292.918 8.27901 290.53 5.3335 290.53C2.38798 290.53 0.000162601 292.918 0.000162601 295.863ZM196.833 5.19775V4.19775H159.333V5.19775V6.19775H196.833V5.19775ZM159.333 5.19775H160.333V4.86328H159.333H158.333V5.19775H159.333ZM159.333 4.86328V3.86328H139.333V4.86328V5.86328H159.333V4.86328ZM139.333 4.86328H138.333V295.863H139.333H140.333V4.86328H139.333ZM139.333 295.863V294.863H5.3335V295.863V296.863H139.333V295.863Z" fill="white" fill-opacity="0.25"/>
</svg>
```

### Line Series Next
```svg
<svg width="11" height="98" viewBox="0 0 11 98" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M0.000162601 5.33301C0.000162601 8.27853 2.38798 10.6663 5.3335 10.6663C8.27901 10.6663 10.6668 8.27853 10.6668 5.33301C10.6668 2.38749 8.27901 -0.00032568 5.3335 -0.00032568C2.38798 -0.00032568 0.000162601 2.38749 0.000162601 5.33301ZM0.893327 87.833C0.341042 87.833 -0.0494823 88.5094 0.22666 88.9877L4.66683 96.6783C4.94297 97.1566 5.72402 97.1566 6.00016 96.6783L10.4403 88.9877C10.7165 88.5094 10.326 87.833 9.77367 87.833H0.893327ZM5.3335 5.33301H4.3335V88.833H5.3335H6.3335V5.33301H5.3335Z" fill="white" fill-opacity="0.25"/>
</svg>
```

### Line Series Prev
```svg
<svg width="11" height="96" viewBox="0 0 11 96" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M0.000162601 5.33301C0.000162601 8.27853 2.38798 10.6663 5.3335 10.6663C8.27901 10.6663 10.6668 8.27853 10.6668 5.33301C10.6668 2.38749 8.27901 -0.00032568 5.3335 -0.00032568C2.38798 -0.00032568 0.000162601 2.38749 0.000162601 5.33301ZM0.893327 85.833C0.341042 85.833 -0.0494823 86.5094 0.22666 86.9877L4.66683 94.6783C4.94297 95.1566 5.72402 95.1566 6.00016 94.6783L10.4403 86.9877C10.7165 86.5094 10.326 85.833 9.77367 85.833H0.893327ZM5.3335 5.33301H4.3335V86.833H5.3335H6.3335V5.33301H5.3335Z" fill="white" fill-opacity="0.25"/>
</svg>
```

### Line Legacy 01

```svg
<svg width="230" height="305" viewBox="0 0 230 305" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M0.000162601 298.815C0.000162601 301.761 2.38798 304.148 5.3335 304.148C8.27901 304.148 10.6668 301.761 10.6668 298.815C10.6668 295.87 8.27901 293.482 5.3335 293.482C2.38798 293.482 0.000162601 295.87 0.000162601 298.815ZM53.3335 298.815V299.815L54.3335 298.815H53.3335ZM53.3335 5.19727V4.19727L52.3335 5.19727H53.3335ZM219.833 9.63743C219.833 10.1897 220.51 10.5802 220.988 10.3041L228.679 5.86393C229.157 5.58779 229.157 4.80674 228.679 4.5306L220.988 0.0904298C220.51 -0.185713 219.833 0.204812 219.833 0.757096V9.63743ZM5.3335 298.815V299.815H53.3335V298.815V297.815H5.3335V298.815ZM53.3335 298.815H54.3335V5.19727H53.3335H52.3335V298.815H53.3335ZM53.3335 5.19727V6.19727H220.833V5.19727V4.19727H53.3335V5.19727Z" fill="white" fill-opacity="0.25"/>
</svg>
```

### Line Legacy 02

```svg
<svg width="344" height="255" viewBox="0 0 344 255" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M0.000162601 5.33301C0.000162601 8.27853 2.38798 10.6663 5.3335 10.6663C8.27901 10.6663 10.6668 8.27853 10.6668 5.33301C10.6668 2.38749 8.27901 -0.00032568 5.3335 -0.00032568C2.38798 -0.00032568 0.000162601 2.38749 0.000162601 5.33301ZM177.333 5.33301H178.333L177.333 4.33301V5.33301ZM177.333 249.363H176.333L177.333 250.363V249.363ZM333.833 253.803C333.833 254.355 334.51 254.746 334.988 254.47L342.679 250.029C343.157 249.753 343.157 248.972 342.679 248.696L334.988 244.256C334.51 243.98 333.833 244.37 333.833 244.923V253.803ZM5.3335 5.33301V6.33301H177.333V5.33301V4.33301H5.3335V5.33301ZM177.333 5.33301H176.333V249.363H177.333H178.333V5.33301H177.333ZM177.333 249.363V250.363H334.833V249.363V248.363H177.333V249.363Z" fill="white" fill-opacity="0.25"/>
</svg>
```

### Line Legacy 03
```svg
<svg width="458" height="11" viewBox="0 0 458 11" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M447.833 9.77318C447.833 10.3255 448.51 10.716 448.988 10.4398L456.679 5.99967C457.157 5.72353 457.157 4.94248 456.679 4.66634L448.988 0.226172C448.51 -0.0499706 447.833 0.340554 447.833 0.892838V9.77318ZM0.000162601 5.33301C0.000162601 8.27853 2.38798 10.6663 5.3335 10.6663C8.27901 10.6663 10.6668 8.27853 10.6668 5.33301C10.6668 2.38749 8.27901 -0.00032568 5.3335 -0.00032568C2.38798 -0.00032568 0.000162601 2.38749 0.000162601 5.33301ZM448.833 5.33301V4.33301H5.3335V5.33301V6.33301H448.833V5.33301Z" fill="white" fill-opacity="0.25"/>
</svg>
```


## Film DNA Stage Coordinate System

Base stage size:
- width: 1080px
- height: 871px

Coordinate rule:
- All nodes and lines use this 1080×871 virtual canvas.
- Runtime implementation should scale the whole Film DNA stage proportionally.
- Do not manually retune line positions per viewport size.
- Treat Figma `x` / `y` values as virtual canvas coordinates.
- For lines whose Figma bounding box width or height is `0`, use the exported SVG `width` / `height` as the implementation render size to preserve circles and arrowheads.


## Node Position Coordinates

All node coordinates use the 1080×871 Film DNA virtual stage.

### Center Node

- x: 546
- y: 317
- width: 114
- height: 221

### Influence Node 01

- x: -63
- y: 463
- width: 114
- height: 221

Note:
- This node intentionally extends beyond the left edge of the stage.
- Negative x coordinates are valid inside the Film DNA virtual coordinate system.

### Influence Node 02

- x: 51
- y: 196
- width: 114
- height: 221

### Influence Node 03

- x: 164
- y: 646
- width: 114
- height: 221

### Legacy Node 01

- x: 825
- y: 61
- width: 114
- height: 221

### Legacy Node 02

- x: 939
- y: 599
- width: 114
- height: 221

### Legacy Node 03

- x: 1053
- y: 330
- width: 114
- height: 221

### Series Previous Node

- x: 483
- y: 13
- width: 114
- height: 221

### Series Next Node

- x: 483
- y: 647
- width: 114
- height: 221

## Line Position Coordinates

### Line Influence 01

Figma bounding box:
- x: 114
- y: 427.5
- width: 428.5
- height: 128

Implementation size:
- width: 434px
- height: 139px

### Line Influence 02

Figma bounding box:
- x: 228
- y: 293.5
- width: 314.5
- height: 134

Implementation size:
- width: 320px
- height: 145px

### Line Influence 03

Figma bounding box:
- x: 342
- y: 427.5
- width: 200.5
- height: 291

Implementation size:
- width: 206px
- height: 302px

### Line Legacy 01

Figma bounding box:
- x: 660
- y: 133.5
- width: 224.5
- height: 293.62

Implementation size:
- width: 230px
- height: 305px

### Line Legacy 02

Figma bounding box:
- x: 660
- y: 427.47
- width: 338.5
- height: 244.03

Implementation size:
- width: 344px
- height: 255px

### Line Legacy 03

Figma bounding box:
- x: 660
- y: 427.5
- width: 452.5
- height: 0

Implementation size:
- width: 458px
- height: 11px

Note:
- Although the visual line is horizontal, use the exported SVG viewBox size for rendering to preserve the start circle and end triangle.

### Line Series Prev

Figma bounding box:
- x: 603
- y: 221
- width: 0
- height: 90.5

Implementation size:
- width: 11px
- height: 96px

Note:
- Although the visual line is vertical, use the exported SVG viewBox size for rendering to preserve the start circle and end triangle.
- If positioning by the visual centerline, render this SVG with `left = x - 5.5px` so the 11px-wide SVG remains centered on x: 603.

### Line Series Next

Figma bounding box:
- x: 603
- y: 538
- width: 0
- height: 92.5

Implementation size:
- width: 11px
- height: 98px

Note:
- Although the visual line is vertical, use the exported SVG viewBox size for rendering to preserve the start circle and end triangle.
- If positioning by the visual centerline, render this SVG with `left = x - 5.5px` so the 11px-wide SVG remains centered on x: 603.

## Claude Code Investigation Checklist

Before implementing persistence, inspect the current code and identify:

- where Film DNA mode is entered from Preview Mode
- where the graph generation call is triggered
- whether generation is called from `App.tsx`, a helper, or a Supabase Edge Function
- where the OpenAI API is called
- where `OPENAI_API_KEY` is stored or read
- which OpenAI model is currently used
- what prompt/schema asks OpenAI to return
- how OpenAI JSON output is parsed and validated
- the current Film DNA graph state shape
- the current movie object shape
- the most stable movie cache key available
- the existing Supabase client/helper pattern
- the current loading and error states
- the current poster enrichment path
- whether relationship nodes already receive `posterUrl`

Do not implement from this spec alone if the current code has a different field name or helper pattern.

## Non-goals

This persistence work should not change:

- Film DNA visual layout
- node coordinates
- line SVGs
- hover behavior
- Preview Mode shell
- Info Mode behavior
- Library behavior
- Sidebar behavior
- Trailer behavior
- Add Movie behavior

The goal is data stability and load speed, not a visual redesign.

## React Implementation Notes

- Keep persistence as a data behavior, not a visual redesign.
- On Film DNA open, read persisted graph data before triggering generation.
- Do not regenerate on every normal open once a ready graph exists.
- Reuse existing loading and error patterns where possible.
- Avoid broad refactors of `App.tsx`.
- Prefer existing Supabase helper patterns before adding new data access code.
- Keep Film DNA as a mode inside poster preview, parallel to Info Mode.
- Do not add a separate Film DNA close button or title bar.
- Use the Film DNA toolbar icon and ESC to exit Film DNA mode.
- The Film DNA canvas may support X/Y dragging if the graph exceeds the lightbox viewport.
- The toolbar and sidebar should not be dragged with the Film DNA canvas.
- Related nodes without poster data should render as text-only nodes.
- Center Node must use the current preview poster image.


## Supabase Persistence Proposal

This is a proposed schema direction, not a confirmed migration. Claude Code should inspect the current Supabase conventions before creating or editing migration files.

Recommended table name:

```sql
filmbase_film_dna_graphs
```

Recommended columns:

```sql
id uuid primary key default gen_random_uuid(),
center_movie_id text,
center_imdb_id text,
center_title text not null,
center_year int,
influences jsonb not null default '[]'::jsonb,
legacy jsonb not null default '[]'::jsonb,
status text not null default 'ready',
model text, -- OpenAI model used to generate the graph, when available
version int not null default 1,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

The table should store normalized graph data, not raw OpenAI response text.

Uniqueness should prevent duplicate graphs for the same center movie.

Prefer unique by `center_imdb_id` if that field is reliable.

If the app uses an internal movie ID more consistently, prefer `center_movie_id`.

The implementation must inspect the current movie shape before finalizing the unique constraint.

## Known Implementation Risk

Previous Film DNA poster behavior used different poster fields:

- Center Node uses the current preview poster / center poster path.
- Relationship nodes require `posterUrl`.

When changing generation, persistence, or enrichment, inspect current mapping for:

- center node poster field
- influence node poster field
- legacy node poster field

Do not assume poster fields are consistent without checking the current code.

## Expected Implementation Report

After implementation, report:

- files changed
- database migration or SQL required
- chosen Film DNA cache key and why
- OpenAI call path and model, if touched
- how cached lookup works
- how first-time generation works
- how duplicate generation is avoided or reduced
- how generated output is normalized
- whether `npm run build` passed
- whether `git diff --check` passed
- remaining risks or manual Supabase steps

Do not commit unless explicitly asked.
