# Deep time, animated — a design note

Status: **proposal, nothing built.** This is a feasibility answer and a sketch
of how it would work, written so the decision can be made before any code is.

The idea: as the reader moves through the timeline, a panel shows the Earth of
that moment — the Hadean under permanent cloud, the rains that filled the
oceans, the first green on land, Carboniferous forest, Pangaea splitting, the
asteroid, ice. Drawn, not photographed. Every frame computed in JavaScript.

## The short answer

**Yes, this is possible, and the hard parts are not the ones people expect.**

Animation performance is a non-issue. The site already redraws a 494-entry
canvas chart on every pan, and this would be a few hundred polygon points plus
a texture pass.

The three things that actually decide whether it is good:

1. **Span.** The timeline covers 4.54 Ga. Plate reconstructions are credible
   back to roughly 600 Ma, a billion at a stretch. For ~87% of the timeline
   there is no map to draw.
2. **Licensing.** Every image on this site carries a resolved Commons licence.
   The famous palaeogeographic maps mostly do not permit reuse.
3. **Taste.** A scene that says "it rained for millennia" is asserting
   something the evidence supports only loosely. This site's habit is to say
   what is contested rather than to smooth it over, and an animation makes
   smoothing very easy.

## The two references

**Kevin Ngo's post** ([x.com, Sep 2026](https://x.com/kevin_t_ngo/status/2099477219877978289))
— a 23-second animation where every frame is computed procedurally on a canvas:
no images, no video, no base64, in a 506KB HTML file. That is the technique
this proposal assumes. It is the existence proof that "drawn in JavaScript" can
carry a scene, not just a chart.

**Risograph printing** ([Risotto Studio](https://risottostudio.com/pages/what-is-risograph-printing))
— the look. A riso is a stencil duplicator: one spot colour at a time, the
paper fed through again for each ink, the colours overprinting where they meet.
The results are grainy, slightly misregistered, and limited to a handful of
rich flat inks. Crucially for us, the constraints are *generative*: a small
palette, hard-edged shapes, visible texture. That is a much better fit for
procedural drawing than photorealism, which JavaScript would lose at.

## Why riso is the right constraint

A procedural Carboniferous forest rendered realistically will look like a
screensaver. The same forest as four flat inks — a green, a warm brown, black
for the stencil detail, fluorescent pink for the sky — reads as an
illustration, and an illustration is allowed to be a simplification. It stops
the animation from claiming more precision than the science has.

It is also cheap. Flat colour, no gradients, no lighting model.

### The layer model

Each ink is its own offscreen canvas, drawn in greyscale — that is literally
what a riso stencil is. Compositing is where the look comes from:

```
for each ink layer:
    draw shapes to an offscreen canvas in greyscale
    tint it with the spot colour
    offset it by 1-3px  (misregistration — different per layer, drifting slowly)
    composite with 'multiply'  (overprint: pink over blue gives a third colour)
apply a grain texture over everything
```

Details that matter:

- **Palette: four inks, maximum five.** Real riso inks are the reference —
  Fluorescent Pink, Blue, Yellow, Green, Bright Red, Black. Picking a different
  set of four per era is a free way to make the Hadean and the Holocene feel
  unlike each other without changing the drawing code.
- **Misregistration is the whole trick.** Layers offset by a pixel or two, and
  the offsets drifting slowly, is most of what makes it read as printed rather
  than rendered.
- **Grain must be pre-generated.** A noise tile made once and reused, not
  per-pixel noise per frame. Per-pixel is the one way to make this slow.
- **Paper is off-white, never pure white**, and ink sits *on* it — so nothing
  is fully opaque.

### One conflict to settle

Riso is ink on paper, and the site's default theme is dark. Either the
animation is a lit panel — a paper-coloured plate inside the dark app,
deliberately — or the metaphor has to change. My preference is the plate: it
frames the animation as an artefact, which is honest about it being an
illustration rather than data.

## The scenes

Roughly a dozen. Each one is a stop, with the animation interpolating between
stops as the timeline window moves. Dates are from the dataset where the entry
already exists.

| When | Scene | Entry |
|---|---|---|
| 4.54 Ga | Formation, molten surface, no atmosphere to speak of | `earth-formation` |
| ~4.4 Ga | The rains. Steam condensing, the first oceans | **missing** |
| 4.1–3.5 Ga | First life, a flat shallow world | `origin-of-life` |
| 2.45–2.0 Ga | Great Oxidation — the sky changes colour | `great-oxidation` |
| 717–635 Ma | Snowball Earth, ice to the equator | **missing** |
| 538.8 Ma | Cambrian, the sea fills with body plans | `cambrian-explosion` |
| 500–420 Ma | First plants ashore | `land-plants` |
| 359–299 Ma | Carboniferous forest, high oxygen, giant insects | **missing** |
| 335–175 Ma | Pangaea whole, then rifting | **missing** |
| 251.9 Ma | Permian extinction | `permian-triassic-extinction` |
| 243–66 Ma | Dinosaurs | `dinosaur-era` |
| 66 Ma | Chicxulub | `kpg-extinction` |
| 2.58 Ma–11.7 ka | Ice ages, advancing and retreating | `pleistocene`, `last-glacial-maximum` |
| 300 ka → | Us | `homo-sapiens` (Africa lane) |

Four are missing — the first oceans, Snowball Earth, the Carboniferous, and
Pangaea itself — and they are worth adding whether or not the animation gets
built. Earth & Life has 40 entries, which is respectable, but over half of
them are hominin: from `sahelanthropus` onward is 7 Ma of a 4.54 Ga lane. The
deep end is thin in exactly the places a drift animation would want to stop.

Pangaea being absent is the striking one. It is the single most recognisable
fact about deep-time geography and the timeline does not mention it.

### The honesty problem, concretely

"It rained for millennia" is a good line and a shaky claim. The surface cooled,
water vapour condensed, oceans existed by 4.4 Ga on zircon evidence and
certainly by 3.8 Ga — but how long the rain lasted, and whether it was one
event, is inference. Estimates in the popular literature range from centuries
to millions of years and are not well constrained.

The site's existing convention handles this: entries carry a `note` that says
what is argued. The animation should do the same — a caption per scene that can
say "inferred" out loud. A scene without a caption is making a claim it cannot
support.

## Where it lives

**Not a separate tab.** This and the proposed Globe are the same feature: a
view of the Earth at the timeline's current position. One is the planet from
outside, the other is the scene from inside. Building them as two tabs would
mean two copies of "what time is it and what did that look like".

The natural shape is a panel that shares the timeline's window state, the way
the minimap already does — `minimap.setWindow(from, to)` is the pattern.

### The log scale will bite

The axis is piecewise-logarithmic. Drive the animation directly off the axis
and the drift will crawl for most of the pan and then lurch. The animation has
to be driven by the window's midpoint in **linear** years, converted through
`astro()` — not by pixel position.

Related: at full zoom the window spans 4.54 Ga, so "the current moment" is
meaningless. The panel probably only earns its place below some window width —
say, when the window is under ~500 Myr — and shows a static plate above that.

## Data, if real reconstructions are wanted

Two levels:

1. **Frame flipping.** Reconstruction outlines at intervals — every 25 Myr,
   say — cross-fading between them. Simple, honest, roughly 0.5–1.5MB of
   simplified polygons for 600 Ma of coverage. A day or two of work.
2. **True plate rotation.** Plate polygons plus Euler rotation poles, computing
   each plate's position at any *t*. Continuous rather than stepped, and the
   rotation data is small. This is what GPlates does. Days of work, and easy to
   get subtly and invisibly wrong.

Start with (1). (2) is only worth it if the stepping is visible, and with a
cross-fade and a riso texture over the top, it probably will not be.

**Sources.** GPlates / EarthByte publish open plate models and are the ones to
use — verify the licence on the specific model before shipping, but the ones
I have seen are CC BY. Scotese's PALEOMAP and Ron Blakey's reconstructions are
the beautiful ones you have probably seen, and are **not** freely reusable.
Given every image in `site/images/` has a resolved licence in `CREDITS.md`,
dropping in a copyrighted reconstruction would be out of character for the
project.

An alternative worth considering: **do not use real reconstructions at all.**
Draw stylised continents that are honestly stylised. A riso illustration is not
claiming to be a map, and it sidesteps both the licensing and the 87% of the
timeline where no reconstruction exists. Cheaper, more honest, and probably
better looking.

## Budget

| | |
|---|---|
| Frame cost | A few hundred polygon points, 4 layer composites, 1 grain blit |
| Target | 60fps, which is not in doubt |
| Grain | Pre-generated tile, reused. Never per-pixel per-frame |
| Payload | 0 bytes if stylised; 0.5–1.5MB if real reconstructions |
| Dependencies | None. Canvas 2D, same as the timeline |

The site has no framework, no build step and no runtime dependencies, and this
does not need to change that.

## Build order

1. **One scene, static.** Carboniferous forest as four inks on a plate. No
   animation, no timeline wiring. This answers "does the look work" for the
   cost of an afternoon, and it is the question everything else depends on.
2. **The riso compositor**, extracted from (1): layers, tint, offset, multiply,
   grain. Pure and testable — given layers and a palette, does it produce the
   right composite.
3. **Two scenes and a cross-fade.** Answers "does interpolation look like
   anything".
4. **Timeline wiring.** Window midpoint drives scene selection; panel hides
   above ~500 Myr window width.
5. **The remaining scenes**, one at a time.
6. **Captions**, including the ones that say "inferred".

Stop after (1) if it does not look good. That is the point of doing it first.

## What I would decide before writing any of it

- Stylised continents or real reconstructions? (I would say stylised.)
- Does the panel replace the minimap's row, share the card's drawer, or open
  full-screen? Each costs something that currently exists.
- On a phone, where does it go? The header fight at 1024–1100px is a warning:
  there is no spare room, and a 375px screen has less.
- Is this a feature of the timeline, or a separate piece that happens to live
  in the same repo? A "watch 4.5 billion years in 90 seconds" set-piece is a
  different product from a panel that tracks your scroll position, and the
  second is much harder to make good.

## Honest risk

The failure mode is not that it does not work. It is that it half-works — a
handful of pretty scenes that do not connect, driven by a scroll position that
makes them stutter, next to a timeline that was already doing its job. The
mitigation is step 1: build one frame, look at it, and only continue if it is
genuinely good.
