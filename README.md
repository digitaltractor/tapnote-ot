# TapNote OT

A native iPhone and iPad app for a school-based occupational therapist. She taps in session data during sessions, reviews and signs fact-only notes at the end of the day, and drafts progress reports per student. Students appear by code (`K7-OTTER`) everywhere; real names live only in the phone's Keychain and are added to files at export time.

- **Clickable prototype:** [`docs/index.html`](docs/index.html), served by GitHub Pages when enabled.
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

## Build and run

Requirements: a Mac with Xcode 16 or later and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
brew install xcodegen
xcodegen generate
open TapNote.xcodeproj
```

1. In Xcode, select the **TapNote** target, then **Signing & Capabilities**, and pick your team. A free personal team works for running on your own iPhone.
2. Choose an iPhone simulator or a connected device and press Run.
3. On first launch, go to **Settings → Load sample students** to try it without real data.

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
docs/index.html             Clickable prototype (GitHub Pages)
```

## Roadmap

1. **v1 (this):** capture, review and sign, reports, exports, backup.
2. **Next:** full SBAP treatment-key list, COTA co-signature, missed-minutes tracker, iPad two-column review.
3. **Later:** optional AI polish of drafts through a zero-retention API (codes only), iCloud sync between phone and iPad.
