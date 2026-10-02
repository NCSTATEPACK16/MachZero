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
  - **Large-text HUD.**
  - **Remappable keyboard.**
- Icon-first UI: a 7-year-old who can't read "BOOST UNLOCKS LAP 2" can still see a locked padlock over the boost icon.

## 3. Platforms, input and performance

| Platform | Input | Target |
|---|---|---|
| Desktop (Chrome, Safari, Firefox, Edge) | Keyboard, gamepad | 60 fps on High (v1 visuals) |
| iPad (9th gen or newer), iPhone (12 or newer) | Touch, optional tilt | 60 fps on Low, **hard floor 30 fps** |
| Android tablets and phones | Touch, optional tilt | Best effort, same presets |

- **Landscape only** on phones and tablets (a rotate-device prompt appears in portrait).
- **Touch layout:**
  - Left thumb: steering slider (or tilt).
  - Right thumb: brake, boost and accelerate (accelerate is hidden when auto-accelerate is on).
  - Air-brakes: two shoulder buttons at the top corners.
  - Pause: top centre.
- **Tilt-to-steer** is optional. iOS asks for motion permission, which is requested from a tap inside Settings.
- **Web app manifest**, so "Add to Home Screen" gives full-screen landscape play on iPhone (Safari has no Fullscreen API on iPhone).
- **Quality presets** Low, Med and High are picked automatically on first launch from a short benchmark plus device hints, and can be changed in Settings. Presets scale render resolution, MSAA, bloom resolution, motion blur, shadows, scenery density, particle count, ship level of detail and draw distance. See IMPLEMENTATION §M1.

## 4. Game modes and progression

### 4.1 World Tour (the main path)
- The five worlds are played in order, one race each (3 laps).
- **Finishing in the top 3 unlocks the next world** (the unlock is global to the profile). Finishing 4th–8th still earns credits.
- The Tour can be played at any AI tier; cleared tiers show as trophies on the world map.

### 4.2 Grand Prix
- Unlocks once World Tour world 5 is cleared at any tier.
- All five tracks back to back, with points per race **10‑8‑6‑5‑4‑3‑2‑1**.
- The cup trophy goes to 1st overall, for each tier (Rookie, Pilot, Ace, Legend).
- A mid-cup retire costs that race's points, not the cup.

### 4.3 Time Trial and ghosts
- Solo, 3 laps, on any unlocked track.
- **Your best ghost** (per track, per profile) and a **dev ghost** (recorded from the Legend AI) race alongside as translucent ships.
- **Medals** are measured against the dev ghost's total time:
  - Gold within 2%
  - Silver within 8%
  - Bronze within 18%
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

- **Music:** a procedural sequencer (a small tracker in code), with **one original retro synthwave/chiptune song per world** plus menu and results themes. Download size is close to zero. The music ducks under countdown beeps and pauses with the game.
- **SFX:** synthesised at startup (jsfxr-style presets rendered into audio buffers) plus a few short CC0 samples for explosions and impacts. New sounds on top of v1's:
  - UI move, confirm and back
  - Purchase and part equip
  - Credit tally
  - Medal and trophy stingers
  - Drafting whoosh
  - Jump launch and landing thump
  - Pipe echo reverb
  - Ice crackle
  - Stone-gate rumble
  - Mine proximity beep and blast
  - Shield impact
  - Crowd and stadium ambience near the start line
  - A per-world ambience loop
  - Each ship class's own engine voice
- There is no voice or announcer. Text and icons carry all information.

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
