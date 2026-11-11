# World concept prompts (Gemini) for the 2.1 worlds

Paste a prompt into Gemini, generate 3–4 images, and save the ones you like as JPEGs (≤ 500 KB each, ≤ 4 per
world) in `assets/reference/worlds/<id>/`. Rename your favourite to **`chosen.jpg`**. If you want to mix
ideas, add a `notes.md` beside it, for example "sky from 2.jpg, towers from chosen.jpg".
Claude only builds a world's look once it has a `chosen.jpg`. See IMPLEMENTATION §X4–§X6.

The track, its gimmick and its hazard do not wait for the image: they are built and tested first with a
plain placeholder theme. The image decides the sky, the palette balance, the scenery and the props.

Start with **Tempest Spire**: it is built first. Cinder Forge is second and Abyss Line is third.

**How each prompt is built:** the shared style block, then one world block. Copy both into Gemini as a single
message. If Gemini drifts (cars, wheels, photographs, a real city), reply "keep it an original anti-gravity race
track with no wheels and no cars, retro-futuristic 1980s airbrush style, same two-part layout".

---

## Shared style block (start every prompt with this)

```
Environment concept art for an ORIGINAL anti-gravity racing video game called MachZero. It must not resemble any
track, world, vehicle or character from an existing game, film or brand; no logos, no text, no lettering, no people.

The subject is a race track and the world around it. The track is a smooth, dark, 18-metre-wide ribbon of road that
floats on slender supports, with a low glowing neon rail along each edge and glowing chevrons on the surface. There
are NO cars and NO wheels. At most, two or three tiny hovering racing craft may appear on the road for scale.

Style: retro-futurism, the way the 1980s imagined the future. Synthwave and airbrush poster art, chrome and glass,
strong silhouettes, a limited palette of two or three saturated neon colours against deep dark tones, glowing light
sources with soft bloom. Clean, readable, large shapes that would work as a low-poly real-time game scene. Not
photographic, not cartoon, not cluttered.

Layout: one landscape image in two parts. TOP TWO-THIRDS: a wide establishing view from just above and behind the
road, looking along the track as it runs into the distance, showing the sky, the horizon, the weather and the big
landmarks either side of the road. BOTTOM THIRD: a row of three separate landmark props from this world, each shown
alone on a plain dark-grey background at the same scale, like a model sheet.
```

---

## World blocks

### Tempest Spire (world 6), `assets/reference/worlds/tempest-spire/`

```
This world is TEMPEST SPIRE: a city of tall art-deco towers that rises above a permanent thunderstorm. The road
weaves between the towers, high above a floor of dark rolling storm cloud lit from inside by lightning. Heavy
slanting rain, wind-blown streamers and pennants on the rails, forked lightning striking tall lightning-rod masts
beside the road, sweeping searchlight beams, glowing windows in vertical strips. Palette: deep storm violet and
indigo, electric yellow, teal. Mood: dramatic, loud, exciting, but not frightening.
The three landmark props: a stepped art-deco tower with a glowing crown; a lightning-rod mast with coiled
insulators and a glowing tip; a searchlight platform on a cantilevered arm.
```

### Cinder Forge (world 7), `assets/reference/worlds/cinder-forge/`

```
This world is CINDER FORGE: a huge chrome foundry built inside a volcano crater. The road runs along the crater
rim, then dives steeply down the inner wall towards rivers of glowing lava and climbs back out. Black basalt rock,
polished chrome smelter towers and pipework, giant crucibles pouring molten metal, lava rivers and falls, clouds of
drifting embers, heat haze, columns of lava bursting up through vents beside the road. Palette: ember orange, cobalt
blue (cooling slag, furnace flames and the neon rails), basalt black. Mood: heavy industry, heat, power.
The three landmark props: a chrome smelter tower with glowing vents; a giant tilting crucible on a gantry; a
basalt rock spire with a lava vein.
```

### Abyss Line (world 8), `assets/reference/worlds/abyss-line/`

```
This world is ABYSS LINE: a retro-futuristic city on the sea floor. The scene is UNDERWATER. Glass domes and
towers trimmed in brass, joined by glass tubes. In the middle distance the road wraps around the OUTSIDE of a long
brass-ribbed tube, so the racing craft ride on its outer surface. Tall kelp forests, shafts of light slanting down
from the surface far above, streams of rising bubbles, schools of small glowing fish, jets of bubbles bursting from
vents on the tube. Palette: aqua and deep sea blue, brass gold, coral pink. Mood: calm, vast, dreamlike.
The three landmark props: a glass habitat dome on brass legs; a giant kelp cluster with glowing pods; a brass
vent tower releasing bubbles.
```

---

## What Claude takes from a concept (and what it ignores)

- **Taken:** the sky (colours, layers, where the light comes from), the horizon and ground, the palette balance,
  the kind and strength of weather, the silhouettes of the three landmark props, and how dense the scenery is
  beside the road.
- **Ignored or adapted:** the exact shape of the track (the track is designed and tested first), anything inside the
  80 m track corridor, fine detail below the prop budget (each world's props stay under 2.5 MB and are flat-shaded
  with baked vertex colours), and anything that would need a new render pass.
