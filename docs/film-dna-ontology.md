# Film DNA Ontology

Formal semantic ontology for Film DNA relationship types. This document defines what each edge *means*, which directions it may take, what evidence is required, and when generation must refuse an edge.

Film DNA is evolving from a simple recommendation graph into a **cinematic relationship system**. All detailed relationship categories are **subtypes** attached to one of two top-level directional groups—or to orthogonal systems (Series, Remake, Adaptation) that do not use Influence/Legacy semantics.

---

## Core Direction System

Film DNA organizes chronological cinematic relationships around a **center film** (the subject work). Two primary directional groups govern craft and cultural inheritance.

### Influence

**Meaning:** What meaningfully shaped the center film *before* it existed.

**Time direction:** `past → center`

**Slot mapping:** Influence nodes appear on the **left** of the graph (`left[]` in the data model).

**Constraints:**
- Prefer films released **before** the center (or contemporaries that directly fed its formation during production).
- Must describe inheritance *into* the center—not symmetric “similar films.”
- Same-franchise prequels, remakes of the center property, and story continuations belong in **Series**, not Influence.

### Legacy

**Meaning:** What the center film later helped shape in cinema.

**Time direction:** `center → future`

**Slot mapping:** Legacy nodes appear on the **right** of the graph (`right[]`).

**Constraints:**
- Only films released **after** the center that plausibly inherit from it.
- Must describe propagation *from* the center—not unrelated prestige dramas that merely share tone.
- Franchise sequels belong in **Series**, not Legacy.

### Direction hierarchy

| Level | Role |
|-------|------|
| **Influence / Legacy** | Top-level directional system; every subtype below attaches to one or both |
| **Relationship subtypes** | Semantic edge types (`visual_dna`, `narrative_dna`, …) explaining *how* inheritance occurred |
| **Orthogonal systems** | Series, Remake, Adaptation Variant—separate semantics, separate slots |

**Rule:** Influence and Legacy remain the only top-level *directional* groups. Subtypes annotate edges; they do not replace direction.

---

## Relationship Subtypes

Each subtype is a **semantic edge type**. A single Influence or Legacy link should carry one primary subtype (secondary signals may be noted in evidence but not used to justify weak edges).

For generation: every emitted edge must (1) satisfy direction rules, (2) meet subtype evidence expectations, and (3) meet minimum confidence for that subtype.

---

### visual_dna

**Meaning:** Visual language inheritance between films—mise-en-scène, composition, lighting grammar, and image design that later works visibly carry forward.

**Allowed directions:** Influence, Legacy

**Confidence expectations:** Medium–High. Requires identifiable visual craft lineage, not mood alone.

**Evidence expectations:**
- Repeated critical or scholarly comparison of specific visual devices
- Documented homage or cited visual reference
- Clear continuity of silhouette, architecture, or cinematographic strategy

**Signals:**
- architecture and urban geometry
- lighting design and contrast grammar
- silhouette and figure blocking
- city density and scale
- industrial / mechanical visual mood
- cinematography and camera movement similarities

**Examples:**
- *Metropolis* (1927) → *Blade Runner* (1982) — Influence, `visual_dna` + `worldbuilding_dna`
- *Blade Runner* (1982) → *Ghost in the Shell* (1995) — Legacy, `visual_dna` + `cyberpunk_lineage`

**Weak examples to reject:**
- Generic “dark visuals” or “neon” without structural visual inheritance
- Vague aesthetic similarity (“both look cool”)
- Shared color grading tropes absent craft lineage

---

### narrative_dna

**Meaning:** Narrative structure or storytelling mechanism inheritance—how a film frames time, distributes information, or constructs plot and character arcs.

**Allowed directions:** Influence, Legacy

**Confidence expectations:** Medium–High. Structure must be defensible in criticism or documented homage.

**Evidence expectations:**
- Named structural parallel discussed in film writing
- Director/writer acknowledgment of structural debt
- Film-school or scholarly treatment as narrative lineage

**Signals:**
- narrative framing (e.g. unreliable narration, nested time)
- ensemble or squad structure
- character arc templates carried forward
- plot construction and revelation mechanics
- storytelling devices (flashback economy, witness structure)

**Examples:**
- *Seven Samurai* (1954) → *Star Wars* (1977) — Influence, `narrative_dna` + `direct_influence`
- *Rashomon* (1950) → *The Usual Suspects* (1995) — Influence, `narrative_dna`

**Weak examples to reject:**
- Both having “a twist” without structural lineage
- Both being ensemble films without inherited narrative grammar

---

### worldbuilding_dna

**Meaning:** Inheritance of fictional world structure—social systems, spatial logic, and diegetic rules that define how a world operates on screen.

**Allowed directions:** Influence, Legacy

**Confidence expectations:** Medium–High.

**Evidence expectations:**
- Recognized world-model parallel in criticism or design writing
- Documented design or writing influence on setting logic

**Signals:**
- dystopian megacity organization
- social hierarchy and class stratification systems
- future urban logic and infrastructure
- technological society models and power structures
- diegetic rules for how institutions operate

**Examples:**
- *Metropolis* (1927) → *Blade Runner* (1982) — Influence
- *Blade Runner* (1982) → *The Matrix* (1999) — Legacy

**Weak examples to reject:**
- Both set in “the future” without inherited world logic
- Shared dystopia label without structural worldbuilding parallel

---

### direct_influence

**Meaning:** Explicit, documented influence—acknowledged by creators or established as historical fact in reputable sources.

**Allowed directions:** Influence (most common), Legacy when the center is the acknowledged source for a later work

**Confidence expectations:** **High** only. Do not assign `direct_influence` on inference alone.

**Evidence expectations:** **HIGH** — required:
- Director, writer, or principal creator publicly acknowledged the source, **or**
- Extremely well-documented historical influence (retrospectives, authorized making-of, major scholarly consensus)

**Examples:**
- *Seven Samurai* → *Star Wars* — George Lucas’s documented samurai/western structural debt
- *Metropolis* → works of Ridley Scott — widely documented visual and world-design lineage

**Weak examples to reject:**
- Fan-theory “Lucas must have seen X” without citation
- Interview vagueness (“many films inspired me”) without naming the center’s specific debt

---

### cultural_descendant

**Meaning:** A later work inheriting broad cultural or iconic DNA from an earlier film—imagery, tropes, or sensibility absorbed across media beyond a single craft thread.

**Allowed directions:** Primarily Legacy; Influence only when the center clearly absorbed prior cultural iconography

**Confidence expectations:** **Higher than generic thematic links.** Require recognizable cultural transmission, not fandom association.

**Evidence expectations:**
- Sustained critical or industry recognition of cultural descent
- Observable iconic imagery reuse or codified trope propagation
- Cross-media absorption (TV, games, advertising) traceable to the center or its ancestor

**Signals:**
- iconic imagery reuse and pastiche
- cultural absorption into genre or pop vocabulary
- broad media influence beyond film criticism alone

**Examples:**
- *Akira* (1988) → *Stranger Things* (2016–) — Legacy, `cultural_descendant`
- *The Matrix* (1999) → modern cyber-aesthetic in film and games — Legacy

**Weak examples to reject:**
- “Internet loves both films”
- Shared meme status without craft or icon lineage

---

### genre_lineage

**Meaning:** Genre evolution relationship—one film codifies or transforms conventions that later films in the genre inherit.

**Allowed directions:** Influence, Legacy

**Confidence expectations:** Medium–High. Genre must be **defining**, not incidental.

**Evidence expectations:**
- Historians or critics name the film as genre-defining or genre-pivot
- Later works explicitly work within conventions established by the earlier film

**Signals:**
- genre-defining conventions (rules of the genre body)
- later genre codification and textbook status
- widely recognized genre ancestry in criticism

**Examples:**
- *Metropolis* → *Blade Runner* — sci-fi urban dystopia lineage
- *Night of the Living Dead* (1968) → modern zombie cinema — Legacy

**Weak examples to reject:**
- Both labeled “horror” or “sci-fi” on metadata alone
- Subgenre overlap without convention inheritance

---

### production_design_dna

**Meaning:** Inheritance of production design, industrial art direction, props, costumes, and environmental design language.

**Allowed directions:** Influence, Legacy

**Confidence expectations:** Medium–High.

**Evidence expectations:**
- Design criticism, art-direction interviews, or visual-effects history linking specific design vocabularies
- Cross-media design lineage (film → games) when production design is the primary carrier

**Signals:**
- industrial design and machinery language
- prop and vehicle design grammars
- costume and uniform systems
- environmental production style and set construction logic

**Examples:**
- *Metropolis* → *Star Wars* (1977) — Influence, production and industrial design lineage
- *Alien* (1979) → *Dead Space* (2008) — Legacy, `production_design_dna` (interactive medium)

**Weak examples to reject:**
- Both having “detailed sets” without inherited design language
- Generic sci-fi hardware without *Alien*-family biomechanical lineage

---

### cyberpunk_lineage

**Meaning:** Cyberpunk-specific lineage—megacity noir, corporate dystopia, and human–machine identity as an inherited *genre-movement* package.

**Allowed directions:** Influence, Legacy

**Confidence expectations:** Medium–High within the cyberpunk canon; **do not** use for generic sci-fi.

**Evidence expectations:**
- Film or media criticism places the work in cyberpunk genealogy
- Multiple cyberpunk signals co-occur (not a single neon shot)

**Signals:**
- megacities and vertical class stratification
- neon noir and rain-slick urbanism
- corporate dystopia and surveillance capitalism aesthetics
- human–machine boundary and cybernetic identity
- post-industrial decay paired with high technology

**Restrictions:**
- Do **not** classify generic sci-fi, space opera, or tech-thriller as cyberpunk without the signal bundle above.
- *Blade Runner* and *Ghost in the Shell* are anchor nodes; edges to them require cyberpunk-specific justification.

**Examples:**
- *Metropolis* → *Blade Runner* — Influence (proto-cyberpunk urban dystopia)
- *Blade Runner* → *Ghost in the Shell* (1995) — Legacy
- *Ghost in the Shell* → *The Matrix* (1999) — Legacy

**Weak examples to reject:**
- Any film with holograms or computers
- *Star Wars*–level space fantasy labeled cyberpunk

---

## Relationship Types NOT Covered By Influence/Legacy

These systems are **orthogonal** to directional inheritance. They describe continuity, remaking, or shared source material—not “what shaped the craft of the center” in the Influence/Legacy sense.

### Series

**Meaning:** Direct continuity within the same narrative property—sequel, prequel, interquel, or franchise installment sharing intentional story continuity.

**Direction:** Chronological within the property (`seriesPrevious` → center → `seriesNext`), not past→center craft inheritance.

**Slot mapping:** `seriesPrevious[]`, `seriesNext[]`

**Rules:**
- Same franchise, same intentional continuity chain
- Release-date order within each slot
- **Never** place franchise sequels in `right[]` (Legacy)
- **Never** place franchise prequels in `left[]` (Influence) when they are continuity installments
- A film must not appear in both Series and Influence/Legacy for the same center unless the ontology explicitly documents a *separate* craft edge (rare; prefer Series for continuity)

**Examples:**
- *The Godfather* (1972) → *The Godfather Part II* (1974) — Series, not Legacy
- MCU installments adjacent to the center title

---

### Remake

**Meaning:** A newer film recreating an earlier film—same narrative property, new production, typically acknowledged as remake or widely classified as such.

**Direction:** Earlier film ↔ later film (remake relationship is symmetric in ontology; UI may show prior version in `seriesPrevious` or a dedicated remake note per product rules).

**Not Influence/Legacy:** Remaking is adaptation/reproduction, not proof that the remake’s *craft* inherited from unrelated third films.

**Evidence expectations:** High for classification as remake (title lineage, studio marketing, critical consensus).

**Examples:**
- *Scarface* (1932) → *Scarface* (1983)
- *All Quiet on the Western Front* (1930) → *All Quiet on the Western Front* (2022)

**Rules:**
- Do not treat remake pairs as chronological sequels
- Do not infer `narrative_dna` Legacy from remake to unrelated films

---

### Adaptation Variant

**Meaning:** Independent adaptations of the **same source material** without continuity linkage between adaptations.

**Direction:** None (peer variants, not a chain)

**Not Influence/Legacy:** Later adaptation does not “legacy” the earlier adaptation’s cinematic DNA unless a separate documented craft edge exists.

**Evidence expectations:** High that both adapt the same underlying work (novel, play, game).

**Examples:**
- *Dune* (1984) and *Dune* (2021) — Adaptation variants of Herbert’s novel
- Multiple *Hamlet* film adaptations

**Rules:**
- **Do not** treat adaptation variants as chronological sequels
- **Do not** place them in `seriesNext` / `seriesPrevious` unless explicit shared continuity exists (rare)

---

## Confidence System

Confidence governs whether an edge may be emitted. When in doubt, **omit**.

### High Confidence

Assign when **at least one** holds:
- Explicit or direct documented influence (interviews, commentaries, authorized books)
- Film-school or textbook canon treated as established lineage
- Scholarly consensus across multiple reputable sources
- Subtype `direct_influence` criteria fully met

**Generation:** Eligible for all subtypes; required for `direct_influence` and Remake classification.

### Medium Confidence

Assign when:
- Widely accepted community or critical relationship repeated across major publications
- Strong craft parallel consistently named in retrospectives, even without creator quote
- Genre or movement lineage with clear convention inheritance

**Generation:** Eligible for craft subtypes (`visual_dna`, `narrative_dna`, etc.) when signals are specific in the note.

### Low Confidence

Indicators:
- Weak thematic similarity
- Vague tone or mood matching
- Single blog post or fan wiki
- “Feels inspired by” without craft specificity

**Generation:** **Do not emit.** Prefer omitting weak edges over filling slots.

### Global rule

> Prefer omitting weak edges over generating filler relationships.

Slot caps (e.g. max 3 Influence, max 3 Legacy) are upper bounds, not targets. Zero strong edges is valid.

---

## Evidence Levels

Evidence level records *how we know* the edge—not how strong the cinematic inheritance is (that is confidence). Both must pass minimum bars for generation.

| Level | Definition | When to use |
|-------|------------|-------------|
| **explicit** | Creator or rights-holder stated the relationship; on-record interview, commentary, or authorized publication | `direct_influence`; Remake; acknowledged homage |
| **scholarly** | Academic film studies, peer-reviewed work, or major critical monograph establishes the link | Canon chains taught as lineage; movement history |
| **widely_accepted** | Multiple major critics, historians, or industry retrospectives agree without single explicit quote | Strong `genre_lineage`, `visual_dna` in consensus criticism |
| **inferred** | Reasonable craft inference from sustained specific parallels, not yet creator-confirmed | Use sparingly; never for `direct_influence`; Medium confidence at best |
| **weak** | Anecdotal, fan-level, or purely thematic | **Never emit** — internal rejection only |

**Cross-rules:**
- `explicit` or `scholarly` → may support High confidence
- `widely_accepted` → typically Medium–High depending on subtype
- `inferred` → Medium at ceiling; omit if signals are generic
- `weak` → discard

---

## Generation Constraints

Hard rules for automated or human-assisted Film DNA generation.

### Prohibited sole bases for an edge

Do **not** generate Influence or Legacy relationships based only on:

| Prohibited pattern | Why |
|--------------------|-----|
| Both being critically acclaimed | Prestige ≠ lineage |
| Both being dialogue-heavy | Talkiness is not inheritance |
| Both being psychological | Theme ≠ craft |
| Both being dark in tone | Mood ≠ visual_dna |
| Both being ensemble casts | Cast size ≠ narrative_dna |
| Broad genre overlap | Metadata genre ≠ `genre_lineage` |
| Same decade or movement label without craft signals | Period cohabitation ≠ edge |
| Same director without specific film-to-film craft thread | Filmography proximity ≠ automatic edge |

### Required standard

Every Influence/Legacy edge must assert **meaningful cinematic inheritance**—identifiable craft, structure, world, design, or documented cultural transmission—and name it in the edge note (max ~12 words in product copy).

### Chronology

| Direction | Release constraint |
|-----------|-------------------|
| Influence | Prior (or formation-era contemporary with direct feed-in) |
| Legacy | Subsequent |
| Series | Property continuity order |
| Remake / Adaptation | Orthogonal; no faux sequel ordering |

### Slot hygiene

- No duplicate titles across `left`, `right`, `seriesPrevious`, `seriesNext`
- Franchise continuity → Series slots only
- Remake / adaptation peer → not Legacy sequels
- Center title must not appear as Influence or Legacy of itself

### Subtype discipline

- One primary subtype per edge
- `cyberpunk_lineage` only with full signal bundle
- `cultural_descendant` at elevated confidence threshold
- `direct_influence` requires `explicit` evidence

---

## Canonical Example Chains

Reference chains for calibration, testing, and prompt alignment. Direction arrows show primary Influence (→) or Legacy (→) flow relative to the chain reading order.

### Cyberpunk / tech-noir visual line

```
Metropolis (1927)
  → [Influence: visual_dna, worldbuilding_dna, cyberpunk_lineage proto]
Blade Runner (1982)
  → [Legacy: visual_dna, cyberpunk_lineage]
Ghost in the Shell (1995)
  → [Legacy: visual_dna, cyberpunk_lineage, narrative_dna elements]
The Matrix (1999)
```

Center=*Blade Runner*: Influence ← *Metropolis*; Legacy → *Ghost in the Shell*, *The Matrix* (among others, if evidence bar met).

### Samurai structure → space opera

```
Seven Samurai (1954)
  → [Influence: narrative_dna, direct_influence]
Star Wars (1977)
```

### Zombie genre codification

```
Night of the Living Dead (1968)
  → [Legacy: genre_lineage]
modern zombie cinema (representative successors, not a single title)
```

### Production design → interactive media

```
Alien (1979)
  → [Legacy: production_design_dna]
Dead Space (2008)
```

### Western iconography → urban alienation

```
The Searchers (1956)
  → [Influence: visual_dna, narrative_dna — antihero/isolation grammar]
Taxi Driver (1976)
```

### Courtroom craft line (calibration)

For center=*12 Angry Men* (1957):

- **Good Legacy:** *Anatomy of a Murder*, *Judgment at Nuremberg*, *The Verdict*, *A Few Good Men* — `genre_lineage` / `narrative_dna` in jury/courtroom craft
- **Reject:** *The Social Network* (2010) — prestige drama without rigorous courtroom lineage

---

## Appendix: Edge Record Shape (informative)

Future implementations may attach ontology fields to each node edge:

```json
{
  "title": "Blade Runner",
  "year": 1982,
  "direction": "influence",
  "subtype": "visual_dna",
  "confidence": "high",
  "evidence": "widely_accepted",
  "note": "Megacity dystopia and noir lighting grammar"
}
```

Until the schema adopts these fields, generation and prompts should still **apply** this ontology internally even if the API returns only `title`, `year`, and `note`.

---

## Document status

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Scope | Semantic ontology only; UI layout in `film-dna-spec.md` |
| Code coupling | None required for v1.0 adoption |
