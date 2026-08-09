# Demo testing guide: web, iOS, Android

A walkthrough for testing all three Moodish clients on your Mac before recording
a demo video — same backend, same script, same order, so the recording shows
one consistent product across three surfaces.

## 0. One-time environment check

Everything needed is already installed on this Mac from earlier setup:

- Xcode 26.6 (`xcode-select -p` should print `/Applications/Xcode.app/Contents/Developer`)
- Flutter (`flutter doctor` — Android toolchain should show a green check)
- Android emulator `Moodish_Pixel` (Pixel 7, Android 14) — `avdmanager list avd`
- `xcodegen` (`brew list xcodegen`)

If any of those are missing, they were installed via Homebrew earlier in this
project's history — re-run the equivalent `brew install --cask ...` command.

## 1. Start the backend

Pick **one** backend for the whole recording session so all three clients show
identical data — don't mix local and production mid-recording.

**Local (fixture mode, fastest, works offline):**
```bash
cd /Users/sankalpjha/Documents/projects/Moodish
npm run web
```
This serves both the web app and the API on `http://localhost:8787`.

**Production** (`https://moodish.onrender.com`) — no setup needed, just point
each client at it (see below). Pick this if you want the demo to show the
real deployed product, or if you want to show off the live multi-language
landing page and download buttons that only make sense on the real domain.

## 2. Test the website

```bash
open http://localhost:8787
```
(or `open https://moodish.onrender.com` for production).

Walk through:
- Landing page: mood-cloud bubbles cycling through languages, theme toggle, the
  two "Get the app" cards (Android downloads a real APK; iOS shows "TestFlight
  coming soon"), "View on GitHub" link.
- **Preview with demo access** → personal chat: type a mood → answer diet/budget
  quick-replies → recommendation deck → select an option + add-on → **Review
  cart** → confirm dialog → cart preview.
- Switch to **Moodish Enterprise** (rail nav) → create a group order → **Simulate
  3 teammates** → **Close responses & build plans** → approve a plan → **Creator:
  confirm final cart**.
- Toggle dark mode partway through if you want both themes on camera.

## 3. Test the iOS app (Simulator)

The project is XcodeGen-managed — `project.yml` is the source of truth, but the
generated `.xcodeproj` is checked in, so you can just open it:

```bash
open /Users/sankalpjha/Documents/projects/Moodish/apps/ios/Moodish/Moodish.xcodeproj
```

In Xcode: pick a simulator (top bar, e.g. "iPhone 17"), hit **Run** (▶ or `Cmd+R`).

**Which backend it hits depends on the scheme configuration:**
- **Debug** scheme → `http://localhost:8787` (make sure `npm run web` is running first)
- **Release** scheme → `https://moodish.onrender.com`

To switch: `Product → Scheme → Edit Scheme…` and change the Run action's build
configuration, or just use `Cmd+R` for Debug (local) vs archiving/running
Release for production. If you regenerate the project with `xcodegen generate`,
these configs are defined in `apps/ios/Moodish/project.yml`.

Walk the *exact same script* as the website: demo login → chat mood/diet/budget
→ recommendation → cart confirm → Corporate tab → create session → simulate
teammates → rank → approve → confirm cart.

## 4. Test the Android app (Emulator)

Boot the emulator first (skip if Android Studio already shows it running):
```bash
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
export PATH="$PATH:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator"
emulator -avd Moodish_Pixel &
```

Then run the app from the Flutter project:
```bash
export PATH="$PATH:/opt/homebrew/share/flutter/bin"
cd /Users/sankalpjha/Documents/projects/Moodish/apps/moodish_android
flutter run
```
`flutter run` auto-detects the booted emulator. It builds a **debug** build,
which points at `http://10.0.2.2:8787` — the Android emulator's special alias
for your Mac's `localhost` (make sure `npm run web` is running).

To point at production instead, build/install a **release** APK (already
configured for `https://moodish.onrender.com`):
```bash
flutter build apk --release
adb install -r build/app/outputs/flutter-apk/app-release.apk
adb shell am start -n com.moodish.moodish/.MainActivity
```

Or open `apps/moodish_android/android` in Android Studio and hit Run if you'd
rather drive it from a GUI — same emulator, same result.

Same script again: demo login → chat → recommendation → cart confirm →
Corporate → create → simulate → rank → approve → confirm.

## 5. Recording each surface

**Website (browser window):** macOS's built-in screen recorder —
`Cmd+Shift+5`, then "Record Selected Portion" and drag around just the
browser window. Cleaner than a full-screen recording for a demo cut.

**iOS Simulator:**
- Easiest: `Cmd+Shift+5` and select just the Simulator window, same as above.
- Or from the terminal, which gives a real `.mov` without the recording-control
  overlay:
  ```bash
  xcrun simctl io booted recordVideo ~/Desktop/ios-demo.mov
  ```
  Press `Ctrl+C` in that terminal when done.

**Android Emulator:**
- Android Studio's Emulator panel has a built-in record button (circle icon in
  the emulator toolbar) — records straight to an `.mp4` and is the least fiddly
  option.
- Or via adb (records on-device, then pull the file):
  ```bash
  adb shell screenrecord /sdcard/demo.mp4
  # Ctrl+C to stop, then:
  adb pull /sdcard/demo.mp4 ~/Desktop/android-demo.mp4
  ```

## 6. Known cosmetic differences (don't be surprised)

All three now share the exact same accent color, background, and surface
tones (transcribed from the web app's CSS variables — see
`apps/ios/Moodish/Moodish/Core/Theme/Theme.swift` and
`apps/moodish_android/lib/theme.dart`). A few things intentionally still look
native rather than pixel-identical to the web:

- The iOS/Android **corporate form screens** (create session, join by code,
  settings) use native `Form`/list styling (iOS grouped list, Android Material
  list) rather than the web's custom cream cards — this is normal platform
  convention, not a bug.
- The web login page has the serif "Say the mood." headline in Georgia; the
  apps use the system font (San Francisco / Roboto) for the same copy, since
  bundling a custom font wasn't done for the native apps yet.
- The web's "Developer lens" (raw trace JSON) and Slack/Teams/Discord adapter
  cards aren't present in either app — those are debug/integration surfaces,
  not core product functionality.

Functionality is otherwise identical across all three: same login options
(demo/Google/Swiggy-pending), same personal chat → recommend → cart-confirm
flow, same corporate create → rank → approve → confirm flow, same theme
toggle.
