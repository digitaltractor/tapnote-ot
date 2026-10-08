# TapNote OT

A native iPhone and iPad app for a school-based occupational therapist. She taps in session data during sessions, reviews and signs fact-only notes at the end of the day, and drafts progress reports per student. Students appear by code (`K7-OTTER`) everywhere; real names live only in the phone's Keychain and are added to files at export time.

- **Web app (PWA):** [`web/`](web/), served at `https://tapnoteot.com/app/`. No Mac or App Store needed.
- **Clickable prototype:** [`docs/index.html`](docs/index.html), served at `https://tapnoteot.com/`.
- **Research and PRD:** kept in the project's Claude doc.

## What's in v1

| Area | What it does |
| --- | --- |
| Today | Start an individual or group session (2–4 students), or log an absence or make-up |
| Session capture | Activities, Correct/Miss trials per IEP goal, 7-level prompt hierarchy, regulation (Low/Calm/Heightened/High), engagement 1–5, SBAP progress indicator, quick comment |
| Review | Day list with self-audit badges modeled on the PA SBAP self-audit; SOAP/DAP/narrative drafts from taps; Face ID sign-and-lock; dated addenda after signing |
| Reports | Month/quarter/year/custom per student: chart per goal vs. criterion, editable draft, PDF with name added on device |
| Students | Pseudonym codes and aliases, IEP goals, identity vault (name, DOB, PA Secure ID, diagnosis) behind Face ID |
| Settings | Note format, prompt levels, activity catalog with SBAP keys, SBAP-format CSV, notes PDF, encrypted backup and restore, name-key export |

## Privacy design

- **Pseudonymous database.** SwiftData stores codes, aliases and session data only, under iOS Data Protection (`completeUnlessOpen`).
- **Identity vault.** Real identities sit in the Keychain as `WhenUnlockedThisDeviceOnly` items. They are never synced or backed up, and showing them requires Face ID or the passcode.
- **Name scrubbing.** A real name typed into a comment or addendum is replaced with the student's code.
- **On-device notes.** Notes are drafted by templates on the phone. Nothing is sent to any server.
- **Backups.** A backup is a passphrase-encrypted file (AES-GCM, PBKDF2-SHA256 at 310k rounds) and contains no names. The name key is a separate Face ID-gated export.
- **Audit trail.** An append-only log records start, end, edits, signing and addenda.

These are school records under FERPA, not HIPAA. If the district bills PA Medicaid (SBAP), confirm with them whether this app may serve as the record or whether notes must be re-entered in the district system.

## Web app (PWA)

The same v1 features as the iOS app, built with Vite, TypeScript and Preact. Install it on an iPhone or iPad from Safari: open the link, tap **Share → Add to Home Screen**. It runs offline, and data stays on the device in IndexedDB.

- **Vault.** Real identities are encrypted with a random data key (AES-GCM). That key is wrapped twice: once by a **passkey** (Face ID / Touch ID, through the WebAuthn PRF extension, iOS 18+) and once by a **passphrase** (PBKDF2-SHA256 at 310k rounds) for fallback and recovery. Names are decrypted only in memory, and the vault locks after 5 minutes idle or 1 minute in the background.
- **Signing and identified exports.** Both require Face ID, or the passphrase, every time.
- **Backups.** The backup file format is identical to the iOS app's, so a `.tapnotebackup` made on one restores on the other.
- **Storage.** Install to the Home Screen and export backups regularly. Safari can clear website data for sites that aren't installed.

```sh
cd web
npm install
npm test          # core logic, store, vault and backup tests
BASE=/ npm run dev
```

Deploys: `.github/workflows/pages.yml` publishes the prototype at `/` and the app at `/app` on every push to `main`. One-time setup: in the repo go to **Settings → Pages**, then under **Build and deployment → Source** choose **GitHub Actions**.

## Native iOS app: build and run

Requirements: a Mac with Xcode 16 or later and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
brew install xcodegen
xcodegen generate
open TapNote.xcodeproj
```

1. In Xcode, select the **TapNote** target, then **Signing & Capabilities**, and pick your team. A free personal team works for running on your own iPhone.
2. Choose an iPhone simulator or a connected device and press Run.
3. On first launch, go to **Settings → Load sample students** to try it without real data.

### Ship to TestFlight (no Mac needed)

`.github/workflows/testflight.yml` archives, signs (cloud-managed signing via an App Store Connect API key) and uploads a build. One-time setup:

1. **App Store Connect → Users and Access → Integrations → App Store Connect API**: create a team key with the **Admin** role, which is needed for cloud-managed signing certificates. Download the `.p8`, and note the **Key ID** and **Issuer ID**.
2. **App Store Connect → Apps → +**: create the app with bundle ID `com.digitaltractor.tapnote`. Register the bundle ID at developer.apple.com → Identifiers first if it isn't offered.
3. **GitHub → repo Settings → Secrets and variables → Actions**: add `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` (the full text of the `.p8` file).
4. **Actions → Ship to TestFlight → Run workflow.** The build shows up in TestFlight after Apple's processing. Add her as a tester there.

### Core logic tests

Note drafting, self-audit, CSV export, progress reports and pseudonyms live in `Packages/TapNoteCore`, a plain Swift package:

```sh
cd Packages/TapNoteCore && swift test
```

CI (`.github/workflows/ci.yml`) runs these tests on Linux and macOS and builds the app for the iOS Simulator on every push.

## Layout

```
project.yml                 XcodeGen project spec
TapNote/                    SwiftUI app
  App/  Model/  Security/  Export/  Features/  UI/
Packages/TapNoteCore/       Platform-neutral logic + tests
web/                        PWA (Vite + TypeScript + Preact) with the core logic ported to TS
docs/index.html             Clickable prototype (GitHub Pages)
```

## Roadmap

1. **v1 (this):** capture, review and sign, reports, exports, backup.
2. **Next:** full SBAP treatment-key list, COTA co-signature, missed-minutes tracker, iPad two-column review.
3. **Later:** optional AI polish of drafts through a zero-retention API (codes only), iCloud sync between phone and iPad.
