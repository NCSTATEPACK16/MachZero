# MachZero 2.0 — Product Specification

> Status: **agreed** (design interview, 2026-09-29). This document says *what* 2.0 is and *why*.
> [`IMPLEMENTATION.md`](IMPLEMENTATION.md) says *how* and in what order, pinned to v1's actual code.
> v1 architecture: [`../TDD.md`](../TDD.md). Live v1: https://machzero.netlify.app

## 1. Vision

MachZero 1.0 proved the core: hover physics that holds a 360° corkscrew at 1,100 km/h, neon visuals, and 60 fps in a browser.
2.0 turns that tech demo into a **complete game that a 7-year-old and a 70-year-old can both enjoy on the same iPad**.
It has hand-made ships you upgrade, five worlds that each look and play differently, rivals with names and personalities, and a progression loop that always gives you something to do next.

### Pillars
1. **Speed you can feel, control you can trust.** Every change keeps v1's handling and frame rate. The headless race sims are the guardrail.
2. **Anyone can finish, experts can master.** Player assists and AI difficulty are independent dials.
3. **Every world has a gimmick.** You remember a track by what it does (jumps, pipe, split path, loop), not only by how it looks.
4. **Retro-futurism.** Synthwave, chrome and CRT glow in the style of 1980s visions of the future, rendered with modern post-processing.
5. **Always playable.** Every merged PR ships to the live site, so every merge leaves the game complete and fun.

### Non-goals (2.0)
- Online multiplayer, accounts, cloud saves and global leaderboards (candidates for 2.1; Supabase is available).
- Real-money purchases, ads and loot boxes. Never.
- Voice acting or an announcer.
- A Quick Race mode (Time Trial plus Grand Prix cover it).
- User-generated tracks or a track editor.

## 2. Audience and accessibility (ages 7–70)

Two **independent** dials:

| Dial | Options | Controls |
|---|---|---|
| **Player assists** (per profile) | Auto-accelerate · Steering assist (off / light / strong) · No-KO · Boost from lap 1 | How hard *you* find it |
| **AI difficulty** (per race) | Rookie · Pilot · Ace · Legend | How good the *rivals* are |

- **"Rookie" preset** (the default for a new profile when the player picks "I'm new to racing games"):
  - Assists: auto-accelerate, strong steering assist, No-KO, boost from lap 1.
  - AI: Rookie.
- **"Classic" preset:** no assists, Pilot AI.
- **Steering assist** blends your steering toward the racing line and gently pushes you off the rails. It never takes full control; at "strong" it is at most 60% assist.
- **No-KO:** energy never drops below 1, and collision damage is halved. You can still lose speed, but you can never explode.
- **Comfort and accessibility settings:**
  - **Reduced motion** turns off radial blur, camera shake, chromatic aberration and speed lines, and gives a gentler FOV change.
  - **Colour-blind-safe mode** uses a HUD and track-marker palette plus shape cues (arrows, icons), not colour alone.
  - Separate master, music and SFX volume.
  - **HUD size:** normal, large or extra large (§11; it replaces the large-text toggle).
  - **Remappable keyboard and pad.**
  - Details of every assist and comfort setting: §11.
- Icon-first UI: a 7-year-old who can't read "BOOST UNLOCKS LAP 2" can still see a locked padlock over the boost icon.

## 3. Platforms, input and performance

| Platform | Input | Target |
|---|---|---|
| Desktop (Chrome, Safari, Firefox, Edge) | Keyboard, gamepad | 60 fps on High (v1 visuals) |
| iPad (9th gen or newer), iPhone (12 or newer) | Touch, optional tilt | 60 fps on Low, **hard floor 30 fps** |
| Android tablets and phones | Touch, optional tilt | Best effort, same presets |

- **Landscape only** on phones and tablets (a rotate-device prompt appears in portrait).
- **Touch layout** (decided in §11, 2026-11-16, which replaces the first sketch of this list):
  - Left thumb: a floating steering slider (or tilt).
  - Right thumb: boost, brake and the item button (plus accelerate when auto-accelerate is off).
  - Air-brakes: push the slider past full lock, or two buttons (a setting).
  - Pause: at the top, beside the lap box.
- **Tilt-to-steer** is optional. iOS asks for motion permission, which is requested from a tap inside Settings.
- **Web app manifest**, so "Add to Home Screen" gives full-screen landscape play on iPhone (Safari has no Fullscreen API on iPhone).
- **Quality presets** Low, Med and High are picked automatically on first launch from a short benchmark plus device hints, and can be changed in Settings. Presets scale render resolution, MSAA, bloom resolution, motion blur, shadows, scenery density, particle count, ship level of detail and draw distance. See IMPLEMENTATION §M1.

## 4. Game modes and progression

### 4.1 World Tour (the main path)

> §12 (agreed 2026-11-16) completes §4.1–§4.4: the chain over 8 worlds, trophies, the map, the medal times and the rewards.

- The worlds are played in order, one race each (3 laps).
- **Finishing in the top 3 unlocks the next world** (the unlock is global to the profile). Finishing 4th–8th still earns credits.
- The Tour can be played at any AI tier; cleared tiers show as trophies on the world map.

### 4.2 Grand Prix
- Unlocks once World Tour world 5 is cleared at any tier. (It ships earlier, unlocked, before World Tour exists; see IMPLEMENTATION §GP.)
- All five tracks back to back, with points per race **10‑8‑6‑5‑4‑3‑2‑1**.
- The cup trophy goes to 1st overall, for each tier (Rookie, Pilot, Ace, Legend).
- A mid-cup retire costs that race's points, not the cup.

### 4.3 Time Trial and ghosts
- Solo, 3 laps, on any unlocked track.
- **Your best ghost** (per track, per profile) and a **dev ghost** (recorded from the Legend AI) race alongside as translucent ships.
- **Medals** are measured against the dev ghost's total time (the numbers are from §12.3, which replaced 2 / 8 / 18% after the times were measured):
  - Gold within 2%
  - Silver within 6%
  - Bronze within 12%
- Each medal pays credits once.

### 4.4 Economy (credits)
- No real money, ever. Credits are earned only in play.

**Race payouts**

| Finish | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th |
|---|---|---|---|---|---|---|---|---|
| Credits | 1000 | 750 | 550 | 400 | 300 | 220 | 160 | 120 |

- **Tier multiplier:** Rookie ×1.0, Pilot ×1.3, Ace ×1.7, Legend ×2.2.
- **Grand Prix cup bonus:** 3000 × tier multiplier for 1st overall.
- **Time Trial medals:** 300 / 600 / 1000 credits (once each).
- **Design rule:** stock parts can win every Rookie race and are competitive on Pilot. Upgrades matter at Ace and Legend. A child playing Rookie never has to grind.

### 4.4a Items (powerups)
- Bought with credits in Garage → Items before a race (and between Grand Prix races); there are no pickups on the track.
- Every item shares one set of slots: 2 at the start, a 3rd at 3 wins, a 4th at 10. Unused items carry over to the next race.
- **The items:**
  - **EMP** (400): hits the racer directly ahead; 30% slower for 2.5 s and no boost for 5 s.
  - **Shield** (300): blocks one EMP or mine, for up to 8 s.
  - **Drop Mine** (350): a mine left behind you for 20 s.
- **Controls:** d-pad left/right (or C) picks the item, Ⓨ (or F) uses it.
- **CPU items:** none on Rookie. On Pilot, 1 per CPU. On Ace and Legend, 2 each. A CPU EMP aimed at you shows a 0.5 s warning, and a CPU can't EMP the same racer twice within 10 s.
- Details: IMPLEMENTATION §P (decided 2026-11-01).

### 4.5 Profiles and saves
- Several named profiles per device (families share tablets). Each has a name, a badge avatar, assists, credits, garage and records.
- Saves stay in the browser: localStorage for data, IndexedDB for ghosts. Profiles can be exported and imported as JSON (backup, or moving to another device).
- The save format is **versioned with migrations from day one**. v1's `machzero.recordLap` becomes a "Classic" record.

## 5. Ships, parts and pilots

### 5.1 Base ships: 6 in 3 weight classes

| Class | Ships | Character |
|---|---|---|
| **Light** | DART, WISP | Quick acceleration, sharp steering, fragile |
| **Balanced** | COMET, ARROW | The v1 feel |
| **Heavy** | TITAN, BASTION | Highest top speed and energy, slow to accelerate and turn, pushes other ships around |

- Each class's two ships share stats and differ in looks, so the choice is personal, not a trap.
- Ships are made in **Blender** (headless Python scripts in the repo; the live Blender MCP is available for iteration).
- They export as compressed GLB and are recoloured at runtime from the **livery editor**: primary, secondary and glow colour, plus 6 decal patterns.

### 5.2 Parts: 4 slots × 4 tiers
Tiers are **Stock → Mk II → Mk III → Prototype**. Every part is a separate model that swaps visibly onto the ship at named attachment points.

| Slot | Improves | Trade-off |
|---|---|---|
| **Engine** | Top speed, acceleration | + weight |
| **Booster** | Boost speed and duration, lower boost cost | — |
| **Stabilizer** | Steering rate, lateral grip | − a little top speed |
| **Hull** | Max energy, damage resistance | + weight |

- Prices: Stock free, Mk II 600, Mk III 1500, Prototype 3200 credits.
- The garage shows stat bars with a before/after preview when hovering a part.
- Exact numbers are in IMPLEMENTATION §Appendix A.
- AI rivals are fitted with tier-appropriate parts (Rookie: all Stock; Legend: Mk III and Prototype).

### 5.3 Pilots
The player uses their profile name and badge. The **7 rival pilots** have portrait badges drawn in code, signature colours and one-line catchphrases shown on the grid and results screens (no voice):

| Pilot | Ship | Personality | Catchphrase (grid) |
|---|---|---|---|
| NOVA BLAZE | DART | aggressive | "Try to keep up!" |
| CAPTAIN ZIGGY | COMET | steady | "Smooth is fast, cadet." |
| REX THUNDER | TITAN | aggressive (rams) | "Coming through!" |
| PIXEL | WISP | erratic (robot) | "BEEP. VICTORY. PROBABLE." |
| LUNA FROST | ARROW | precise | "I don't miss apexes." |
| TURBO TIA | DART | boost-happy | "Boost now, think later!" |
| OLD SPARKY | BASTION | veteran, steady | "Been racing since before hover was cool." |

## 6. Worlds and tracks

One hand-designed track per world (3 laps, target lap time 30–45 s on Pilot), built from hand-placed control points swept by v1's track system. v1's random-seed generator stays as a hidden **Bonus Track** (`?seed=N`).

| # | World | Look (retro × futuristic) | Signature gimmick | Hazards |
|---|---|---|---|---|
| 1 | **Neon Bay** | Synthwave city at night, magenta sun, neon grid ocean (v1 art, polished) | 360° corkscrew | — |
| 2 | **Sunset Mesa** | Chrome-and-sandstone canyon, 80s airbrush sunset, retro billboards | **Jump ramps**: open-air sections where the rails end | — |
| 3 | **Cryo Station** | Ice planet, frosted glass tubes, CRT control towers, aurora | **Full-pipe tube**: drive all the way around its inside | **Ice patches** (grip drops sharply) |
| 4 | **Jade Ruins** | Neon-lit jungle temple, holographic glyphs, mist and fireflies | **Split path**: a risky narrow shortcut vs the safe wide road | **Stone gates** that slide shut on a timer |
| 5 | **Orbital Ring** | Space station ring with Earth below, chrome ribs, starfield | **Loop-the-loop** + **low-gravity jumps** | **Magnetic mines** + drifting debris |

- **Hazards escalate** from world 3 onward. On **Rookie AI or with No-KO**, hazards are telegraphed earlier (glow and pulse), cause **no energy damage**, and only slow you down.
- Every world has its own sky, fog, colour palette, scenery set (Blender props + procedural instancing), music track and ambient sound.
- Dash plates and a pit strip remain on every track.

## 7. Racing field and AI

- **8 ships** per race: the player plus 7 rivals.
- **Drafting (slipstream):** tuck in behind a ship for a growing speed bonus, with a visual shimmer and a whoosh. It is a new overtaking tool.
- **AI tiers:**

| Tier | Pace | Line | Boost | Aggression | Rubber-band |
|---|---|---|---|---|---|
| Rookie | ~75% | Wide and safe, brakes early | Rarely | Never rams, yields | Strong (keeps the pack near you) |
| Pilot | ~88% | Good | Sensible | Light | Medium |
| Ace | ~97% | Tight | Smart, drafts | Blocks | Light |
| Legend | 100% | Near-optimal | Optimal, drafts | Rams when ahead on energy | Minimal |

- The pilots' personalities (§5.3) flavour behaviour *within* a tier.
- The tier sets the ceiling.

## 8. Audio

> Status: **agreed** (design interview, 2026-11-24, two rounds and a summary). [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §M6 has the build plan. The original 2.0 intent (first agreed 2026-09-29) still holds: a procedural soundtrack, one song per world, an expanded effects bank, no voice. **Changes from the original §8** are marked **[changed]** with the reason.

### 8.1 What M6 adds, and why

| Area | What | Why |
|---|---|---|
| **Music** | One original song per world (8), a menu theme, a results theme and 8 short stingers, all generated in code | Pillar 4 (retro-futurism): synthwave is half of the look. Download size stays close to zero |
| **Sound effects** | Sounds for every event that has none today (hazards, jumps, menus, the shop, the results), on top of v1's sounds | Every action gets an answer, and the hazards of the 2.1 worlds are heard before they hit |
| **Engine voices and ambience** | An engine voice per weight class, rivals you hear passing, one ambience per world, the crowd at the start | Speed you can feel (pillar 1): the sound changes with the ship, the world and the field |
| **A proper mix** | Buses, ducking, a limiter, safe levels | The music must never cover a sound that carries information, and the game must be safe for children on headphones |

### 8.2 Music

- **One original retro synthwave song per world, plus a menu theme and a results theme.** Each world song has its own tempo, mode and instruments (IMPLEMENTATION §M6, the song table). They come from one family: analog-style saw pads, pulse and square leads, arpeggios, drum machines, delay and reverb.
- **The menu theme introduces a short MachZero motif.** The stingers reuse it, so the game has a sound of its own.
- **Structure:** a short intro (4–8 bars) played once from the grid card, then a loop of 60–80 s. **On the final lap a lift layer** (a counter-melody and brighter drums) fades in at the next bar. There is no key change.
- **Time Trial plays the world's song**, with the same final-lap lift.
- **Stingers** (1–4 s): win, podium, finish off the podium, unlock, trophy, medal (bronze, silver and gold climb higher each time), champion, new record. **The off-podium stinger is warm and encouraging, never sad.** Children play this game.
- **Where each piece plays:** the menu theme on every menu screen (the garage and the world map too); the world song in the race; the results theme on every results screen and the cup standings. A KO or a respawn does not change the music.
- **[changed] Pause:** the music keeps playing, muffled (quieter and dull), under the pause menu. The race sounds stop. Menu sounds keep working. *Was:* "the music pauses with the game". *Why:* a silent pause menu feels broken to a child, and the muffled music tells the player the race is waiting.
- **Ducking:** the music gets quieter under the countdown, under a stinger and under every warning sound, and it sits below the effects at all times. It also has a dip at the pitch of the warning beeps, so they always cut through.
- **[changed] How the music is made:** a small synthesiser written in TypeScript renders each song into a looping buffer in a background thread (a Web Worker) while the track loads. The game then plays the buffer. *Was:* a sequencer playing notes live on the audio clock. *Why:* the experiment (IMPLEMENTATION §M6, "Facts") showed that live notes cost the main thread up to 1.4 ms on a busy step, more than the frame-time budget allows. The same synthesiser in plain code is about 7 times cheaper than the browser's built-in nodes, and it runs in the unit tests. A race never waits for its song: when the song is not ready, the race starts and the song fades in.
- **Claude composes every note; the owner approves every song by ear** in a preview, through a jukebox (8.6). A rejected song is reworked in a follow-up commit, as a rejected world look is.

### 8.3 Sound effects

- **v1's sounds stay as they are** (engine, boost, wind, rail scrape, pit hum, the countdown, hits, the dash, the items, mines, the KO, the lap chimes and the fanfares). They move into the new effects bank with the same parameters.
- **New sounds** (jsfxr-style presets, rendered in the background after boot):
  - **Menus:** move, confirm, back, locked, slider step, tab change. The same for the pad, the keyboard and touch.
  - **The shop:** purchase, equip, not enough credits.
  - **The results:** a tick for each tally line, a coin chime at the total.
  - **The tutorial:** a soft chime for each prompt, a sparkle at the end.
  - **The road:** jump launch and landing thump, ice crackle, stone-gate rumble and hit, debris hit, respawn.
  - **The 2.1 hazards, each with its own sound:** lightning (a crackle that builds through the warning, then a thunder crack), lava geysers (a rumble, then the eruption), pressure jets (a building hiss, then the blast), crosswind gusts (a whoosh from the side that pushes).
  - v1 already plays the drafting whoosh, the mine proximity beep and blast, and the shield impact; they stay.
- **[changed] No CC0 samples in M6.** Every sound, the crowd included, is generated in code. *Was:* "a few short CC0 samples for explosions and impacts". *Why:* v1's procedural explosions and impacts already work, and samples bring licence work and a second audio format for iOS. The allowance of at most 5 small CC0 samples stays: a sample replaces a sound only if the owner rejects that sound at the listening approval.
- **Who hears what:** only the player hears the menu sounds, the stingers, the chimes and the warnings. Physical sounds (hits, boosts, blasts) play for every ship within 60 m of the player, quieter with distance and panned to its side.
- **When too many sounds play at once,** warnings are never dropped, the player's own sounds come next, then the rivals', then sounds that are only decoration.

### 8.4 Engine voices and ambience

- **Each weight class has its own engine voice:** Light is higher and thinner; Balanced is v1's engine exactly; Heavy is lower, with more rumble. Boost keeps v1's bright layer. The Aero slot changes no sound.
- **Rivals:** the two nearest rivals within 60 m have their own engine voices, panned to their side, so you hear being passed.
- **Ambience:** each world has a quiet background loop (city hum, desert wind, the station's hum, the jungle, space, rain and thunder, the foundry, the deep sea). It fades as the ship speeds up, so it never fights the engine. The crowd is heard near the start line. Inside Cryo Station's pipe and on Abyss Line's Spine, the sounds get an echo.

### 8.5 Platforms

- **iOS:**
  - **The game respects the ringer switch,** as most games do: with the switch on silent, the game is silent. The player's own music app can keep playing under the game.
  - **The app going to the background pauses the race.** Coming back, the race waits on the pause menu, and the sound fades in from silence (it never blasts).
  - **AirPods and other Bluetooth headphones** add a short delay (about 0.2 s). Nothing in the game needs exact timing, so there is no correction.
  - No Capacitor plugin is needed.
- **The web:** sound starts on the first tap, click or key (the browser's autoplay rule). **A tab hidden mid-race pauses the race** (new: today only the sound stops).
- **The pad:** the menu sounds play for the d-pad and Ⓐ / Ⓑ exactly as for the keyboard and touch.

### 8.6 Accessibility, comfort and safe levels

- **No information is carried by sound alone.** Every warning sound has a visual or haptic twin (IMPLEMENTATION §M6 lists them): the countdown numbers, the lightning circle, the geyser glow, the jet bubbles, the mines on the road, the low-energy flash, and the EMP warning on the HUD. **The EMP warning is fixed in M6a:** today the HUD's "⚠ EMP INCOMING" is hidden when the player carries no items, so a CPU's EMP on its way to that player is told only by the alarm (and, in the iOS app, a haptic tap). M6a shows it whenever an EMP is on its way.
- **Sliders:** MASTER, MUSIC (shown once M6 is done) and EFFECTS (it sets the effects, the menu sounds and the ambience together), plus the mute. The defaults stay master 80%, music 70%, effects 100%. There is no "music off" default: the MUSIC slider at 0 does that.
- **MONO** (new, Settings → Sound): every sound plays in the centre, for one earbud or one ear.
- **Safe levels for children on headphones:** the mix is quieter than most games (−18 LUFS at the default volume), and a limiter stops any peak above −3 dBFS.
- **SOUND TEST:** the jukebox stays in the game as Settings → Sound → SOUND TEST. It plays every song, stinger and sound by name.
- **There is no voice and no announcer.** Text and icons carry all information.

### 8.7 Success criteria (M6 done)

- Every world has its song, and the owner has approved each song, each stinger and the sound set as a whole by ear.
- Every event in the event-to-sound table (IMPLEMENTATION §M6) makes its sound, and every warning has its twin.
- **60 fps on both devices at their own preset,** with the music and every sound playing in an 8-ship race on Jade Ruins and on Orbital Ring. The frame time p95 is no more than 1 ms above the build before M6.
- The ringer switch, AirPods, the background and the return, a race by pad only and a race by touch only all work on the iPhone and the iPad.
- App JS grows by no more than 25 KB gzip. `public/game` does not grow.
- With the `music` flag off (every M6 PR before the last), the live game sounds exactly as it does today.

## 9. Success criteria (2.0 done)

- All five worlds are playable in World Tour, Grand Prix and Time Trial, on desktop, iPhone and iPad.
- CI is green on every PR, including headless race sims on **5 tracks × 4 AI tiers**:
  - all 8 ships finish;
  - no respawns, except that the erratic personality may miss a jump;
  - finishing order roughly follows AI tier.
- **Balance targets**, checked by the sims with an autopilot standing in for the player:
  - A Rookie-assisted autopilot (strong steering assist) on stock parts finishes top 3 against Rookie AI on every track.
  - An unassisted Pilot-level autopilot on stock parts finishes mid-pack against Pilot AI.
- 60 fps on High on a desktop GPU; ≥ 30 fps (60 target) on Low on iPhone 12 / iPad 9th gen.
- Size: app JS ≤ 600 KB gzipped plus the Rapier physics chunk ≤ 1.7 MB gzipped (≤ 1.2 MB if its WASM moves to a separate file); game content ≤ 15 MB, loaded per world; first playable race ≤ 5 s on a 50 Mbps connection.
- No console errors in the smoke test. Saves survive every milestone's migration.

## 10. 2.1 expansion (agreed 2026-11-10)

> Status: **agreed** (design interview, 2026-11-10). This section adds to 2.0. It does not reopen any decision in §1–§9: the pillars and the non-goals still hold. [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §X has the build plan.

### 10.1 What 2.1 adds, and why

| Direction | What | Why |
|---|---|---|
| **New worlds** | Three worlds (6, 7, 8), each with a new track feature | Pillar 3: you remember a track by what it does. Eight worlds also let a second cup mix old and new |
| **Environment effects** | Weather, atmosphere, light and surface reactions on every world, old and new | The worlds look right but stand still. Motion in the air and on the road makes speed easier to feel (pillar 1) |
| **Cups** | The single 5-race Grand Prix becomes a list of cups | The cup must not grow by itself when a world is added, and a later championship needs a base |
| **Upgrades** | Two variants of each part from Mk II up, and a fifth slot (Aero) | More choice for speed, handling and armour without making ships stronger overall |

Out of scope for 2.1: audio (M6), touch and comfort (M7), World Tour, Time Trial and ghosts (M8), online features (a 2.0 non-goal), and anything with real money (never). 2.1 must not block them. In particular every new world has a song entry for M6 (IMPLEMENTATION Appendix B).

### 10.2 New worlds

| # | World | Look (retro × futuristic) | Signature gimmick (a new track feature) | Hazard |
|---|---|---|---|---|
| 6 | **Tempest Spire** | A city of art-deco towers above a permanent thunderstorm: rain, lightning rods, searchlights | **Crosswind zones**: gusts push every ship sideways | **Lightning strikes** (energy loss and a boost jam) |
| 7 | **Cinder Forge** | A chrome foundry in a volcano crater: lava rivers, smelter towers, ember clouds | **The Plunge**: a steep dive into the crater and a climb out, with gravity along the road | **Lava geysers** that erupt in lanes on a timer |
| 8 | **Abyss Line** | An undersea city of glass domes and brass: kelp forests, light shafts, bubbles | **The Spine**: ride around the outside of a tube | **Pressure jets** that knock ships around the tube |

- **Every gimmick is a new track feature**, not a new skin on an old one: a side force, a steep pitch with gravity, and a convex road. None of the five 2.0 worlds has any of these.
- **Hazard rules follow §6:** on Rookie AI (and later with No-KO) every new hazard has double the warning time, causes no energy loss, and only slows the ship. There is always a clear way through.
- **Reduced motion** removes full-screen lightning flashes and camera shakes. The warnings on the road stay.
- **Locks:** the new worlds are selectable with no unlock gate until M8's World Tour exists, as the 2.0 worlds were. World Tour then decides how worlds 6–8 unlock.
- **Each world's look comes from an owner-approved concept image** (`docs/v2/WORLD_CONCEPTS.md`), as the ships' looks did.
- Track rules are unchanged: one hand-designed track per world, 3 laps, a 30–45 s lap, dash plates and a pit strip.

### 10.3 Environment effects

- **The effects**, in order of visual impact for their frame-time cost:
  1. Per-world colour grading.
  2. Weather particles: rain, snow, embers, spores, dust, bubbles.
  3. Height fog and fog banks.
  4. Animated sky layers and lightning flashes.
  5. Track-surface reactions behind ships: spray, dust, sparks.
  6. Drifting set pieces: airships, shuttles, debris.
  7. A wet-look road: a glossier deck with stretched neon streaks. It is not a real reflection.
  8. Light-shaft cards (cheap god rays).
- **Rules for every effect:**
  - It is data in the world's theme, not code in the renderer.
  - It scales with the quality preset. Low may drop it. Effects 1–4 run on every preset; effects 5–8 run on Med and High.
  - Reduced motion turns off flashes and shakes.
  - It adds no draw calls per ship.
  - It never changes how the game plays. Wind, lightning, geysers and jets are track features with their own rules (§10.2); the effects only show them.
- **Budget:** 60 fps on the iPhone and the iPad at the device's own preset, with the 95th-percentile frame time no more than 1 ms above the build before the effect.
- **Time of day per race is not in 2.1.** The theme data leaves room for it.
- **The five 2.0 worlds each get a set:**

| World | Effects |
|---|---|
| Neon Bay | Light rain, wet-look deck, drifting airships |
| Sunset Mesa | Blowing dust, light-shaft cards, dust behind ships |
| Cryo Station | Snowfall, ice glitter, aurora pulses |
| Jade Ruins | Mist banks, floating spores, light shafts through the canopy |
| Orbital Ring | Micro-meteor streaks, drifting shuttles, sun glint |

### 10.4 Cups and the championship

This replaces "all five tracks back to back" in §4.2. Everything else in §4.2 still holds.

- **A cup is a named, ordered list of 5 worlds.** The cups:

| Cup | Races |
|---|---|
| **Neon Cup** | Neon Bay → Sunset Mesa → Cryo Station → Jade Ruins → Orbital Ring (the 2.0 cup, unchanged) |
| **Storm Cup** | Sunset Mesa → Tempest Spire → Jade Ruins → Cinder Forge → Abyss Line |

- The Storm Cup appears once world 8 is built.
- **Trophies** are per cup and per tier. Trophies won before 2.1 belong to the Neon Cup.
- **Unchanged:** points 10‑8‑6‑5‑4‑3‑2‑1, the tiebreak, the reverse-standings grid from race 2, no restarts, the retire rule, race payouts and the cup bonus (3000 × tier multiplier, per cup).
- **Unlocks:** every cup is open until World Tour exists (M8).
- **Championship (designed now, no screen yet):** a season is every cup in order at one tier.
  - The season score is the sum of the racer's cup points.
  - Ties break on cups won, then on the best cup finish.
  - The winner gets a Champion trophy for that tier.
  - 2.1 builds this as data and tested functions only. The screen and its rewards belong with M8's modes.

### 10.5 Upgrades

This extends §5.2. Tiers, prices and the design rule in §4.4 are unchanged: **stock parts win every Rookie race, and a child playing Rookie never has to grind.**

- **Sidegrades.** From Mk II up, each slot has two variants at the same price. Variant A is the 2.0 part with the same numbers, so every part a player already owns behaves exactly as before.

| Slot | Variant A (the 2.0 part) | Variant B (new) |
|---|---|---|
| Engine | **Velocity**: top speed and acceleration in balance | **Sprint**: much more acceleration, less top speed |
| Booster | **Longburn**: longer, cheaper boosts | **Burst**: a much faster, shorter boost |
| Stabilizer | **Grip**: more lateral grip | **Agility**: much sharper steering, little extra grip |
| Hull | **Cell**: more energy | **Plate**: little extra energy, much less damage taken, more weight, pushes rivals harder |

  - Each variant is bought separately. Both stay owned, and refitting an owned part is free.
  - **Balance rule:** within a slot and tier, neither variant is more than about 1% faster per lap than the other, averaged over every track. A variant is a choice of style, not a better part.
- **A fifth slot: Aero** (Stock → Mk II → Mk III → Prototype, no variants).

| Slot | Improves | Trade-off |
|---|---|---|
| **Aero** | Draft bonus; steering in the air; resistance to wind and jets | − a little top speed |

- **Every new part is its own model** that swaps visibly onto the ship: 12 variant-B parts and 4 Aero parts, 32 parts in total. Aero mounts on a new attachment point near the nose of every chassis.
- **Rivals** pick variants by personality (aggressive pilots take Sprint, Burst and Plate; steady and precise pilots take variant A). Rookie rivals stay all Stock. Exact fits are in IMPLEMENTATION Appendix A.

### 10.6 Success criteria (2.1 done)

- All eight worlds are playable in single races and in their cups, on desktop, iPhone and iPad, with only a controller.
- The §9 sim criteria hold on **8 tracks × 4 AI tiers**, with each new gimmick covered by its own hold test, and the §9 balance targets hold on every new track.
- Each sidegrade pair passes the 1% balance rule in the sims.
- The device budget in §10.3 holds at every gate. The §9 size budgets hold: app JS ≤ 600 KB gzipped, game content ≤ 15 MB loaded per world.
- Saves from every earlier version load with nothing lost.

## 11. M7: touch, tilt, assists and comfort (agreed 2026-11-16)

> Status: **agreed** (design interview, 2026-11-16). This section completes §2 and §3. It reopens nothing else. [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §M7 has the build plan in three PRs.

### 11.1 What M7 adds, and why

| Part | What | Why |
|---|---|---|
| **Assists that work** | Auto-accelerate, steering help, No-KO and boost from lap 1 act in real races, with a screen to change them | The "I'm new to racing games" preset already promises them, and until M7 only the test sims used them. Pillar 2: anyone can finish |
| **Touch driving** | A steering slider, boost, brake, items and pause under two thumbs, on the iPhone, the iPad and mobile web | Until M7 the game is playable on iOS only with a controller |
| **Tilt** | Optional steering by turning the device like a wheel | Some players, and many children, find it more natural than a slider |
| **Comfort** | Reduced motion, colour-blind mode, HUD size, haptics on/off, pad remapping | Ages 7 to 70 on the same iPad (§2) |

### 11.2 Assists

- The four assists and the two presets are as §2 says. They are saved per profile.
- A player can change an assist at any time, in the pause menu too, and in the middle of a cup.
- **Assists never cost anything:** no fewer credits, no blocked trophy, no blocked medal.
- **No-KO** halves damage, and damage never takes energy below 1. It also selects the Rookie hazard rules of §6 from the next race.
- **Boost from lap 1** applies to the player only.

### 11.3 Driving by touch

- **Where:** the iOS app and mobile web. Android is best effort. Pad and keyboard keep working, and the player can change device in the middle of a race; the prompts and the layout follow the device used last.
- **Landscape only**, with a rotate overlay on the web.
- **Auto-accelerate is on for every touch player.** It is a setting of the device, separate from the profile's assist. With it off, an accelerate button appears.
- **Steering:** a floating slider on the left half of the screen. The origin is where the thumb lands. Three sensitivities.
- **Right thumb:** a large boost button, a brake button, and the item button above them. A small chip switches the item. The pit needs no button.
- **Air-brakes:** by default, pushing the slider past full lock applies that side's air-brake. Two buttons are the other option. The owner chooses the final default on the devices.
- **The HUD on touch:** power and speed move to one strip at the bottom centre, between the thumbs. Nothing a player must read sits under a thumb.
- **Sizes** are physical: a button is as large on the iPad as on the iPhone. Settings: button size (S, M, L) and a left-handed layout.
- **Haptics:** a light tick on each button press, on top of the hit and boost haptics.

### 11.4 Tilt

- Steering is the device's roll, like a wheel, read from gravity. There is a calibrate button, a small deadzone and three sensitivities.
- **On curled road** (the corkscrew, the pipe, the loop, the Spine) the camera rolls with the ship, so right on the screen is always right for the ship. Tilt reads real gravity only: upside down in the pipe, tilting right still steers right on the screen.
- Permission is asked from a tap. Without it the slider is used.
- With tilt, the left thumb gets two air-brake buttons.

### 11.5 Menus by touch

Every target is at least 44 points. The Garage ship turns with a drag and zooms with a pinch. Lists scroll with a drag. Keyboard and pad hints are hidden on touch.

### 11.6 Comfort

- **Reduced motion** turns off motion blur, camera shake, colour fringing, speed lines, lightning flashes, hit flashes and menu transitions, and calms the field of view. The camera still rolls with the ship. A new save starts with it on when the device asks for reduced motion.
- **Colour-blind mode** is one blue-and-orange palette plus shapes: an icon and a clear-side arrow for every hazard warning, shapes for the ships on the minimap, a marker on low power.
- **HUD size:** normal, large, extra large.
- **Remapping:** the keyboard and the pad's driving buttons.
- **Haptics** can be turned off.

### 11.7 Success criteria (M7 done)

- A full race, and the whole Storm Cup, can be played by fingers alone on the iPhone and the iPad at 60 fps.
- A scripted two-thumb driver finishes 3 laps on all 8 tracks in the sims, with and without the Rookie preset.
- Every menu can be used by touch alone, with targets of at least 44 points.
- A Rookie-preset player cannot be knocked out. A Classic player with a pad or keyboard plays exactly as before.

## 12. M8: progression, modes and ghosts (agreed 2026-11-16)

> Status: **agreed** (design interview, 2026-11-16). This section completes §4 and decides what §10 left to M8. The pillars and the non-goals still hold. [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §M8 has the build plan in four PRs.

### 12.1 What M8 adds, and why

| Part | What | Why |
|---|---|---|
| **World Tour** | The worlds unlock in order on a world map, with trophies per tier | It gives the game a main path and always something to do next (§1) |
| **Time Trial and ghosts** | Solo runs against your best ghost and a dev ghost, for medals | A goal for experts that needs no rivals (pillar 2) |
| **The championship** | A season of every cup at one tier | The end game for a player who has won the cups |
| **Results and tutorial** | A credit tally with unlocks, and a first-race tutorial | A new player sees what they earned and learns the five controls |
| **2.0 complete** | The balance pass, every finished flag on and removed | The release |

### 12.2 World Tour

- **World Tour is the world map.** The main menu is: Continue Cup (when one is running), World Tour, Grand Prix, Time Trial, Garage, Settings. There is no separate single-race mode.
- **The chain:** world 1 is open. A top-3 finish at any tier clears a world and opens the next. Worlds 6–8 continue the chain after world 5. The chain covers the worlds the player can see, so it grows when a new world's look is approved.
- **Trophies:** a top-3 finish at a tier earns the world's trophy for that tier and every lower tier.
- **The map** shows each world as a planet with its lock, its four trophies, the best lap and the best medal. A locked world says how to unlock it.
- **Old saves:** a profile keeps every world up to the last one it had raced, and all its cup trophies.
- **Cups:** the Neon Cup opens when world 5 is cleared and the Storm Cup when world 8 is cleared. A profile that already holds a cup's trophy keeps that cup.
- **A Rookie player never grinds:** eight top-3 finishes on Rookie clear the Tour.

### 12.3 Time Trial and ghosts

- Solo, 3 laps, on any unlocked track, with your own ship and parts, no items, restart at any time. Assists are allowed and medals still count.
- **A ghost is a recording of where the ship was**, 20 times a second. It is about 21–30 KB. Your best ghost per track is kept on the device; a profile export holds times and medals, not ghosts.
- **The dev ghost** is a Legend autopilot alone on the track, on a COMET with the Legend rivals' parts.
- **Medals**, the same for every ship: gold within 2% of the dev ghost's time, silver within 6%, bronze within 12%. Measured: a perfect stock run is 3–6% off the dev time and a Prototype kit matches it. So bronze is for stock parts, silver for about Mk II to Mk III, gold for near-Prototype parts and clean driving.
- Each medal pays once per track: 300, 600, 1,000. A run pays every medal it newly reaches.
- Both ghosts show by default; each can be turned off.

### 12.4 The economy

- **Prices and payouts do not change.** Measured in the race sims: about 940 credits a race on Rookie, 800 on Pilot with stock parts, 700–970 on Ace with a Mk II to Mk III kit, and under 400 on Ace or Legend with stock parts.
- **Targets (they hold today, and a sim keeps them):** a first Mk II part after 1 Rookie race; a full Mk III kit after about 10 Pilot races; a full Prototype kit after about 25 more Ace races.
- **One-time rewards:** the first clear of a world pays 1,000. A cup pays 3,000 × the tier multiplier. The Champion trophy pays 5,000 × the tier multiplier, once per tier.

### 12.5 The championship

- A season is every available cup in order at one tier (10 races with two cups). It opens when the profile holds a trophy of every cup, and needs at least two cups.
- Each cup plays as a cup does. The season table sums the cup points (§10.4 has the tiebreaks). The winner gets the Champion trophy for that tier.
- A season is saved after every race and can be abandoned.

### 12.6 Results and tutorial

- **Results:** the credit tally line by line, then any unlock or trophy, then the winner's quote. Buttons: Next World (when one was unlocked), Race Again, Garage, World Map.
- **Tutorial:** once per profile, on the first World Tour race of a profile made with the Rookie preset. Prompts appear over the real race and clear when the player does the action: steer, boost, air-brake, pit, item. It can be skipped, and replayed from Settings. The first tutorial race starts with one free Shield so the item step has an item.

### 12.7 Flags and the release

- `expansion` stays off until each new world's look is approved. 2.0 ships with the worlds visible on that day.
- The last M8 PR turns `modes` on and removes the flags `profiles`, `garage`, `worlds`, `tiers`, `touch` and `modes`. `music` and `expansion` stay.
- **Release order:** M7a, M7b, M7c, M8a, M8b, M8c, M8d. The world looks and X7 are built when their images or approvals arrive and block nothing.

### 12.8 Success criteria (2.0 done)

§9 holds, with these changes: "five worlds" reads "every visible world"; the sims run on 8 tracks × 4 tiers; and new sims guard the economy targets, the medal times, the World Tour chain, a whole season and the touch scheme. Saves from every earlier version load as v9 with nothing lost.
