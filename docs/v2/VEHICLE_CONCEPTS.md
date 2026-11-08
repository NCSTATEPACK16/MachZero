# Vehicle concept prompts (Gemini) for §V

Paste a prompt into Gemini, generate 3–4 images, and save the ones you like as JPEGs (≤ 500 KB each, ≤ 4 per
chassis) in `assets/reference/ships/<id>/`. Rename your favourite to **`chosen.jpg`**. If you want to mix
ideas, add a `notes.md` beside it, for example "nose and canopy from 2.jpg, pods from chosen.jpg".
Claude only models a chassis once it has a `chosen.jpg`. See IMPLEMENTATION §V.

Start with **COMET**: it's the pilot for the whole pass (§V gate V1). The other five can wait until COMET is approved.

**How each prompt is built:** the shared style block, then one chassis block. Copy both into Gemini as a single
message. If Gemini drifts (wheels, cars, cartoon style), reply "keep it a hovering anti-gravity racer with no wheels,
grounded sci-fi materials, same three views".

---

## Shared style block (start every prompt with this)

```
Concept art sheet for an ORIGINAL anti-gravity racing craft for a video game called MachZero. It must not resemble
any ship, vehicle or character from an existing game, film or brand; no logos, no text, no lettering.

The craft hovers about half a metre above the track: there are NO wheels. It is about 4.5 m long, 2.6 m wide and
under 1 m tall: a low central fuselage with a single-seat cockpit canopy, and two engine pods carried on short
outrigger wings either side, with glowing thruster nozzles at the back.

Style: grounded, believable sci-fi motorsport engineering. Real-world materials: glossy two-tone painted panels,
exposed carbon-fibre weave, brushed and anodised metal, dark rubberised and composite parts, tinted canopy glass,
visible panel seams, air intakes, cooling vents, rivet lines, small access hatches, light edge wear and chipped
paint on corners. Emissive glow ONLY in the thruster nozzles and thin accent strips. Not cartoon, not toy-like, not
photographic; clean, readable shapes that would work as a low-poly game model.

Layout: one image, plain neutral mid-grey studio background, soft even studio lighting from the top-left, no
environment, no shadows on the backdrop. Show the SAME craft three times: a large three-quarter front view (top
half), a flat side elevation (bottom left) and a flat top-down plan view (bottom right), all at the same scale,
nose pointing left in the side and top views.
```

---

## Chassis blocks

### COMET (Balanced, default ship), `assets/reference/ships/comet/`

```
This craft is COMET, the balanced all-rounder: "the original MachZero feel, good at everything". Livery: deep
electric blue (#1F6BFF) main paint, off-white (#E8EEFF) secondary panels and stripes, cyan (#19F0FF) thruster glow.
Proportions: a smooth, rounded fuselage of medium width; moderately swept outrigger wings; two medium engine pods of
equal length to the fuselage; twin small tail fins angled slightly outward; a teardrop canopy set a little forward of
centre. It should look like the dependable factory racer every pilot starts on: tidy, confident, balanced.
```

### DART (Light), `assets/reference/ships/dart/`

```
This craft is DART, a light, twitchy sprinter: "needle-nosed and twitchy, quick off the line, fragile in a crowd".
Livery: hot orange-red (#FF5A2B) main paint, near-black graphite (#1A1D29) secondary panels, amber (#FFB319) thruster
glow. Proportions: the slimmest fuselage of the set with a long, sharp needle nose spike; small forward canard winglets
near the nose; sharply swept-back outrigger wings; long slender engine pods that run almost the full length; tall,
thin twin tail fins. Exposed structure and minimal armour: it should look fast and slightly fragile.
```

### WISP (Light), `assets/reference/ships/wisp/`

```
This craft is WISP, a light, agile glider: "a feather with fins, turns on a coin". Livery: violet (#8A4DFF) main paint,
pale ice-white (#E8EEFF) secondary panels, magenta-pink (#FF2BD6) thruster glow. Proportions: a short, wide, rounded
fuselage with a large bubble canopy; gently swept wings; two short rounded engine pods; very tall tail fins canted
strongly outward in a wide V, like a bird's spread tail. Elegant and light, almost organic curves, but still built
from real panels and composites.
```

### ARROW (Balanced), `assets/reference/ships/arrow/`

```
This craft is ARROW, a precise, balanced racer: "sharp lines, steady hands, no surprises". Livery: golden yellow
(#F2B705) main paint, dark gunmetal (#2B2B35) secondary panels, pale lemon (#FFE066) thruster glow. Proportions: a
narrow, angular, faceted fuselage with a long pointed nose; a long, low canopy set well forward; shallow-swept
straight-edged wings; slim engine pods; a single tall central tail fin plus two very small outer fins. Crisp folded
edges and straight lines everywhere, like a precision instrument.
```

### TITAN (Heavy), `assets/reference/ships/titan/`

```
This craft is TITAN, a heavy bruiser: "slow to wind up, impossible to stop, pushes rivals aside". Livery: racing red
(#D81B2A) main paint, black (#1A1A1A) secondary panels, bright red (#FF3344) thruster glow. Proportions: a broad,
muscular fuselage with bolted-on armour plates and a reinforced ram-style nose; short canard winglets; large, thick
engine pods; a central tail fin plus short twin fins; a small armoured canopy set well back. Heavy-duty: thick
plating, big intakes, chunky exhaust collars.
```

### BASTION (Heavy), `assets/reference/ships/bastion/`

```
This craft is BASTION, "an armoured freight hauler with a racing heart". Livery: deep racing green (#2E7D5B) main
paint, light silver-grey (#D8DDE6) secondary panels, lime (#7DFF3A) thruster glow. Proportions: the widest, boxiest
fuselage of the set, like an industrial cargo tug converted for racing, with flat armour panels, grab rails,
hazard-stripe accents and cargo-latch details; short, almost straight wings; big square-edged engine pods; low upright
tail fins; a large, wide canopy. Rugged and industrial, but clearly fast.
```

---

## Parts block (optional, for V2), `assets/reference/parts/`

Parts bolt onto every chassis and come in four tiers: **Stock → Mk II → Mk III → Prototype**. Each tier should look
visibly more advanced than the last. Do one prompt per slot (4 images in total). Start it with the shared style block,
but replace its "Layout" paragraph with the one below.

```
Layout: one image, plain neutral mid-grey studio background, soft even studio lighting. Show a row of FOUR versions
of the same bolt-on racing-craft part, left to right, labelled only by position (no text): Stock (plain, utilitarian,
painted steel), Mk II (refined, extra cooling fins), Mk III (carbon fibre and machined metal, more glow), Prototype
(exotic, exposed cores, the most glow, still believable engineering). Three-quarter view, same scale for all four.

The part is: <ONE OF THE FOUR BELOW>
```

- **Engine:** "a rear-mounted main thruster engine block with nozzle, the source of top speed and acceleration."
- **Booster:** "a pair of side-mounted boost thrusters (one shown) that fire for short bursts of extra speed."
- **Stabilizer:** "a tail stabilizer and airbrake assembly, a fin with control surfaces, for sharper steering and grip."
- **Hull:** "an armour and energy-shield plating kit that wraps the fuselage sides, for durability."

---

## What Claude takes from a concept (and what it ignores)

- **Taken:** silhouette within the locked size (±10%), the placement of intakes, vents and plates, panel-split lines,
  which surfaces are carbon or metal or paint, and the canopy shape.
- **Ignored or adapted:** exact colours (the livery editor sets those), anything that breaks the size lock or adds
  moving parts, fine detail below what LOD0's 12k-triangle budget can carry (that goes into the trim-sheet normal map).
