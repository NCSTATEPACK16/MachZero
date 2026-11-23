# MachZero on iOS: building and shipping to TestFlight

The iOS app is the web game in a native shell ([Capacitor](https://capacitorjs.com) 8). The Vite build in
`dist/` is copied into the app and runs offline in a full-screen WKWebView. The Xcode project lives in
`ios/App` and is committed; `ios/App/App/public` (the copied web build) is generated and git-ignored.

| | |
|---|---|
| App name | MachZero |
| Bundle ID | `com.ncstatepack16.machzero` |
| SKU (App Store Connect) | `machzero-ios` |
| Team | `Q82SM8NY2Y` (set in the project; automatic signing) |
| Version / build | The version is `"version"` in `package.json` (1.1.0 since MachZero 2.0); the build number is the git commit count. `npm run ios:sync` sets both in the Xcode project |
| Devices | iPhone and iPad, landscape only, iOS 15+ |
| Controllers | Declared to the App Store as Extended Gamepad (Xbox / PlayStation / 8BitDo in X-input mode) |

## Every build

```bash
npm run ios:sync
```

It runs `npm run build`, copies `dist/` into the app (`npx cap sync ios`), sets the app's version from
`package.json` and bumps the build number. Leave the changed `project.pbxproj` out of commits: every sync rewrites
those two lines from `package.json` and git.

**A new version** (what testers and the App Store show, e.g. 1.1.0 → 1.2.0): change `"version"` in `package.json`
(`npm version 1.2.0 --no-git-tag-version`) in the release's PR, then sync and upload as below. Within one
version, every upload only needs a higher build number, which the sync gives it.

```bash
npm run ios:open
```

That opens the project in Xcode.

## First upload (one time)

1. **Xcode → Settings → Accounts:** make sure your Apple ID is signed in and team `Q82SM8NY2Y` is listed.
2. In the project navigator click **App** → target **App** → **Signing & Capabilities**:
   - check that **Automatically manage signing** is on, the Team is yours and the Bundle Identifier reads
     `com.ncstatepack16.machzero`;
   - if Xcode shows a red signing error, click **Try Again**; it creates the certificates and profiles.
3. The bundle ID must match the app you created in App Store Connect (SKU `machzero-ios`).

## Build with unfinished features turned on

The live site keeps unfinished features behind flags (`src/core/features.ts`), and a web preview turns them on with
`?features=...`. The app has no URL, so set the flags when you build it:

```bash
VITE_FEATURES=expansion npm run ios:sync
```

`expansion` shows the 2.1 worlds, cups and parts. `VITE_FEATURES=all` turns every flag on. A plain
`npm run ios:sync` builds what the live site shows.

## Upload a build to TestFlight

1. Run `npm run ios:sync`, then open Xcode (`npm run ios:open`).
2. In the toolbar's device menu choose **Any iOS Device (arm64)**.
3. **Product → Archive.** When it finishes, the Organizer window opens with the new archive.
4. **Distribute App → App Store Connect → Upload**, keeping the defaults (automatic signing, upload symbols).
   The export-compliance question is answered in the app (`ITSAppUsesNonExemptEncryption = NO`).
5. Wait for the email "has completed processing" (usually 5–20 minutes).
6. **App Store Connect → Apps → MachZero → TestFlight:**
   - **Internal testing:** add yourself (and anyone on your team) to an internal group. Internal builds need
     no review and appear in the TestFlight app on your devices straight away.
   - **External testers** (friends outside your team) need a short Beta App Review the first time.
   - Fill in **What to Test**, e.g. "Pair a controller (8BitDo: X-input mode). Race 3 laps on each world.
     Buy an EMP in Garage → Items and fire it with Ⓨ at the racer ahead. Try Settings → Race → CPU difficulty.
     Settings → Graphics → Performance panel shows frame stats."
7. On the iPad and iPhone install **TestFlight** from the App Store, accept the invite and install MachZero.

## Controller

- 8BitDo pads: switch to **X-input mode** (the Xbox layout) before pairing. iOS then sees an Xbox controller.
- Pair in **Settings → Bluetooth**, then open MachZero. iOS only shows a controller to the game after its
  first button press, so press any button on the title screen.
- Driving: left stick steers, RT / Ⓐ accelerate, LT / Ⓑ brake, LB / RB air-brakes, Ⓧ boost (lap 2+), Ⓨ fires
  an EMP, Menu (☰) pauses. In menus the d-pad or stick moves the highlight (hold to repeat) and Ⓐ selects;
  Ⓑ goes back.
- EMPs are bought in **Garage → Items** (400 credits each; 2 slots, a 3rd at 3 wins, a 4th at 10). One hits the
  racer directly ahead: 30% slower for 2.5 s and no boost for 5 s. Unused EMPs carry over.
- **Settings → Race → CPU difficulty:** Rookie (default: slower rivals who don't catch up), Pilot, Ace.
- If the controller drops mid-race the race pauses until you resume it.

## Touch and tilt (M7)

- Touch is on by default: touch the screen in a race and the touch controls appear (steer with the left thumb from
  where it lands, BOOST and BRAKE under the right thumb). Use the pad or a key and they go away again.
- Touch settings are in **Settings → Controls → TOUCH**: slider or tilt, sensitivity, auto-accelerate, air-brake style,
  button size, left-handed. **HAPTICS** there turns off both the phone's taps and the pad's rumble.
- **Tilt asks for motion access** the first time you choose TILT, and iOS asks again after each launch of the app.
  The grid card then shows **ENABLE TILT**; skip it and that race uses the slider. If tilt steers the wrong way or
  never responds, report it: the motion data's direction is set in `src/physics/TiltInput.ts` (one sign flip for iOS)
  and has only been checked in tests, not on the device yet. The app uses WebKit's motion events, not
  `@capacitor/motion`. If iOS needs `NSMotionUsageDescription` in `Info.plist`, add "MachZero uses motion to steer when
  tilt steering is on."
- **CALIBRATE TILT** (Settings → Controls) makes the way you hold the device now straight ahead.

## Checking performance on a device

- In the app: **Settings → Graphics → Performance panel** shows frame times, missed frames and hitches, with a
  summary after each race. Screenshot it at the results screen.
- With a cable: on the Mac, Safari → Settings → Advanced → "Show features for web developers"; then
  Safari → **Develop → (your device) → MachZero** gives the console and a timeline profile of the live game.

## Things to know

- **Audio** starts without a tap: the app allows media playback without a user gesture, because controller
  presses don't count as one in WebKit.
- **The screen stays on** while the app is in front (a controller-only race has no touches).
- **App Review** (for a later public release, not TestFlight internal): Apple can reject apps that are only a
  website wrapper (guideline 4.2). MachZero runs fully offline, supports game controllers and uses haptics,
  which is the usual answer; keep the store description focused on the game.
- **Icon and splash** are generated: `npm run ios:art` re-renders them from `scripts/ios-art.mjs`.
