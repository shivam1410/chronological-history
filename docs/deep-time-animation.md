# Deep time, animated — a design note

Status: **proposal, nothing built.** This is a feasibility answer and a sketch
of how it would work, written so the decision can be made before any code is.

The idea: a view, reached from the sidebar, showing the Earth at whatever
moment the timeline is sitting on — the Hadean under permanent cloud, the rains
that filled the oceans, the first green on land, Carboniferous forest, Pangaea
splitting, the asteroid, ice, dinosaurs. Drawn, not photographed. Every frame
computed in JavaScript, and scrubbed by the cursor rather than played.

Three things are already decided and are marked **Settled** below: the view is
paper-themed throughout, it is not a video, and it lives behind the sidebar.

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

## What the technique actually looks like

A worked example is worth more than the description: a ChatGPT session
(shared by the user) produced a 15-second procedural motion study in this
exact aesthetic, and its source is instructive. Notes from it that change
decisions here:

**The effect has a name: halftone, not just grain.** The look is "risograph-
inspired motion graphics" — saturated pink, yellow and blue on paper, slightly
imperfect colour alignment, and *halftone dot patterns* doing the shading and
the colour mixing. Halftone is a separate technique from paper grain and we
need both. In canvas it is a 9×9 tile with one dot in it, turned into a
`createPattern` and filled through a clip:

```js
c.save(); c.clip(shape); c.globalAlpha *= 0.2;
c.fillStyle = dotPattern; c.fillRect(...); c.restore();
```

**Pick scenes whose content is repetition.** The example's subjects were a
Ferris wheel, fireworks, a sunflower, a forest — all things that are one shape
repeated around a circle or scattered across a field. That is why they looked
rich for so little code. It is a selection criterion, and our scene list
should be read against it:

- Repeats well: Carboniferous forest (trees), Snowball (ice), Cambrian (body
  plans in water), ice ages (drifting sheets), the rains (falling lines).
- Repeats badly: **dinosaurs.** A dinosaur is a one-off silhouette, not a
  pattern, and it is the scene most likely to look amateur. Either draw very
  few of them very deliberately, or show the era through what repeats — ferns,
  herds at a distance, footprints — rather than through a hero animal.

**One element should persist and morph across scenes.** The example's whole
trick is a pink ribbon that becomes steam, then a river, then a kite tail, by
interpolating between corresponding points rather than crossfading:

```js
return { x: mix(mix(steam.x, river.x, a), kite.x, b), … }
```

For deep time the obvious persistent element is **water**: steam condensing,
ocean, ice, swamp, sea. It is literally the through-line of the planet's
history, and it gives the eye something continuous to hold while everything
else changes. Worth designing around from the start rather than bolting on.

**Cache everything static.** The example pre-renders 67,000 paper fibres into
an offscreen surface once and reuses it every frame. Same rule as the grain
tile, applied more broadly: if it does not change with `t`, draw it once.

**One correction to the performance claim above.** Procedural is dramatically
cheaper to *download* — the example measured 9.3KB of JavaScript against a
2.79MB MP4 of the same thing, roughly 300× — but it is not necessarily cheaper
to *run*. Video decode is hardware-accelerated; recomputing curves and
compositing transparent layers is not. And file size is not memory: a
1200×1200 surface is about 5.8MB of RAM whatever produced it, and this design
wants several of them.

For our case that still comes out fine, because we are not playing 60fps for
30 seconds — we redraw on scrub, like the chart already does. But "performance
is a non-issue" was too breezy. The honest version: **the cost is per-redraw
and bounded by how many offscreen surfaces we keep.**

**The reality check from that session is worth repeating.** Producing a
plausible version of this is approachable. Reliably achieving a *particular*
polished result is demanding, and most of the difficulty is not in any one
scene — it is in sequencing, transition rhythm, and keeping one aesthetic
across all of them.

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

### Settled: the view is paper, all of it

Not a plate inside the dark app — the whole view switches to the paper theme
when you enter it. The animation is an artefact and the frame around it should
agree. The app's own dark chrome returns when you leave.

Practically this means the view owns its palette rather than inheriting
`--bg` and `--ink`. Easiest as a scoped override on the view's root, so the
rest of the token system is untouched:

```css
.deeptime { --bg: #f4ecd9; --ink: #153f4a; … }   /* paper, in both themes */
```

### Settled: it is not a video

There is no playback, no timeline of its own, no play button. The reader
scrubs the site's timeline with the cursor and the scene answers. This is the
most important constraint in the document, because of what it rules out:

**Every frame must be a pure function of the window position.** `draw(t)`,
where `t` comes from the window's midpoint — nothing accumulated, nothing
integrated, no state carried between frames.

That means no particle systems that evolve, no physics, no "the smoke has been
rising for 4 seconds". The reader can drag backwards, jump three billion years
in one flick, or hold still for a minute; all three must land on exactly the
same picture for the same position. A scene that drifts when you stop moving
is a scene that shows you something different each time you return to it.

Small caveat: some motion can be genuinely time-driven — a slow shimmer, a
drifting misregistration — as long as it carries no information. Anything the
reader might read as *content* must come from position alone.

## The scenes

Roughly a dozen. Each one is a stop, with the animation interpolating between
stops as the timeline window moves. Dates are from the dataset where the entry
already exists.

The scenes are inhabited, not just landscapes — dinosaurs, the giant insects of
the Carboniferous, Ediacaran fronds. See the note above on which of these
repeat well and which do not; the animals are the expensive part.

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

**Its own view, reached from the sidebar** — decided. It shares the timeline's
window state the way the minimap already does (`minimap.setWindow(from, to)`
is the pattern), but it owns the screen while it is open, and it owns its
palette.

Still worth resolving: this and the proposed Globe are arguably one feature
seen from two distances — the planet from outside, the scene from inside. Two
sidebar entries means two implementations of "what time is it and what did
that look like". If the Globe happens, it should share the scene's clock.

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

**Sources.** GPlates / EarthByte publish open plate models and are the obvious
place to start — verify the licence on the specific model before shipping, but
the ones I have seen are CC BY.

An earlier draft of this note said flatly that Scotese's reconstructions are
not freely reusable. That is too broad, and fetching the image for the new
Pangaea entry disproved it: the map now on that card is
`Mollweide Paleographic Map of Earth, 225 Ma (Norian Age).png`, credited to
Scotese, Vérard, Burgener, Elling and Kocsis, and Commons records it as
**CC BY 4.0**. The rule is the same one the image pipeline already enforces —
the licence is a matter of fact to be fetched, not a matter of reputation to
be assumed. Some of this material is open; check each file.

Ron Blakey's paintings remain the ones to avoid without permission.

Either way, dropping in a reconstruction whose terms we guessed at would be out
of character: every image in `site/images/` has a licence resolved from the
Commons API and recorded in `CREDITS.md`.

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

1. **One scene, static.** Carboniferous forest as four inks on paper — halftone
   and grain included, since they are most of the look. No animation, no
   timeline wiring. This answers "does the look work" for the cost of an
   afternoon, and it is the question everything else depends on.
2. **The riso compositor**, extracted from (1): layers, tint, offset, multiply,
   grain. Pure and testable — given layers and a palette, does it produce the
   right composite.
3. **Two scenes and the water morph.** Not a cross-fade — interpolate
   corresponding points, so the ocean becomes the ice. Answers the real
   question, which is whether the through-line works.
4. **Timeline wiring**, as `draw(t)` from the window midpoint. Scrub it
   backwards and forwards and confirm it lands identically both ways; that is
   the test that the render is genuinely stateless.
5. **The remaining scenes**, one at a time.
6. **Captions**, including the ones that say "inferred".

Stop after (1) if it does not look good. That is the point of doing it first.

## Still to decide

Answered: paper theme for the whole view; scrubbed, not played; its own view
from the sidebar.

Still open:

- Stylised continents or real reconstructions? (I would say stylised.)
- What is the persistent element? Water is the obvious candidate and the one
  I would design around, but it wants deciding before any scene is drawn,
  because every scene has to hand it on.
- On a phone, what drives the scrub? There is no cursor. Dragging the scene
  itself is the obvious answer, but that is also how the timeline pans, so the
  two gestures need separating — the axis-lock code in `timeline.js` is the
  precedent.
- Does the sidebar itself cost too much? A permanent sidebar is 200px+ and the
  header already ran out of room at 1024–1100px. It may need to be a rail of
  icons, or a bottom bar on phones.

## Honest risk

The failure mode is not that it does not work. It is that it half-works — a
handful of pretty scenes that do not connect, driven by a scroll position that
makes them stutter, next to a timeline that was already doing its job. The
mitigation is step 1: build one frame, look at it, and only continue if it is
genuinely good.
