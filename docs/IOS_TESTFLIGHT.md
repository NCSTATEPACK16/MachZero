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
| Version / build | `1.0.0`; the build number is the git commit count (set by `npm run ios:sync`) |
| Devices | iPhone and iPad, landscape only, iOS 15+ |
| Controllers | Declared to the App Store as Extended Gamepad (Xbox / PlayStation / 8BitDo in X-input mode) |

## Every build

```bash
npm run ios:sync
```

It runs `npm run build`, copies `dist/` into the app (`npx cap sync ios`) and bumps the build number.
Commit the changed `project.pbxproj` with the release.

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
