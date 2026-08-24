# TaskBridge for ClickUp 2.1.0

Technical reference for the Chrome and Firefox Manifest V3 extension. The canonical versioned source is this repository; the GitHub wiki mirrors the maintained user, technical, contribution, security, privacy, and release documents from `main`.

## Runtime Architecture

The extension has four runtime surfaces:

1. `background.ts`: trusted background runtime, ClickUp personal-token/OAuth boundary, ClickUp API client, Calendar runtime, mappings, timers, and message authorization.
2. `app/`: responsive full-tab application for dashboard, tasks, agenda, tracking, connections, and settings.
3. `src/gmail-native.ts` and `src/modal.ts`: Gmail content integration and create/link task form.
4. `src/clickup-tracker.ts` and `src/meet/meet-tracker.ts`: minimal host observers that send reduced events to the background worker.

The toolbar uses `popup/minimal.html` only as a launcher. `popup/popup.html` remains the durable ClickUp setup surface and its implementation is reused by the full app.

## Trust Boundaries

Host pages are untrusted. Gmail, ClickUp, and Meet content scripts cannot read trusted local persistence directly. Chrome uses `TRUSTED_CONTEXTS`; Firefox routes injected `storage.local` calls to extension-origin IndexedDB and denies storage in host contexts. Content scripts send closed, origin-validated messages through `src/message-security.ts`.

The service worker owns:

- ClickUp and Google API calls.
- personal-token, OAuth-token, and client-secret access.
- persistent task, Calendar, and Meet mappings.
- timer writes and concurrency controls.
- attachment upload validation.

No token, OAuth secret, raw Calendar event ID, Meet room code, Gmail HTML, or attachment bytes are written to logs.

## ClickUp API

`src/services/api.service.ts` provides:

- raw/Bearer authorization compatibility for safe reads;
- global rate governance;
- bounded retries for safe reads and rate-limited writes;
- a 30-second request timeout;
- confirmed authentication invalidation;
- task, hierarchy, time-entry, comment, and attachment operations.

The default connection accepts an individual `pk_` personal token only from the trusted setup pages, validates `/user` before encrypted persistence, and sets raw authorization explicitly. Advanced OAuth stores a locally encrypted BYO Client Secret and sets Bearer authorization. Successful method changes remove the previous credential boundary and account-derived caches. No credential is hardcoded or included in release assets.

Task descriptions are sent through `markdown_description`. The editor supports ClickUp-documented headings, emphasis, ordered/unordered lists, links, blockquotes, and inline code.

## Google Calendar

Calendar uses the exact read-only scope declared in `manifest.json`:

```text
https://www.googleapis.com/auth/calendar.events.owned.readonly
```

The runtime requests one bounded seven-day primary-calendar response. Full event IDs, Meet URLs, attendees, and descriptions are never returned to the UI or persisted. Event details remain in a short-lived memory cache; UI items expose SHA-256 reduced occurrence and series keys.

Expired details are refreshed before task creation, task linking, or opening Meet. Saved Calendar mappings contain only reduced keys and ClickUp task ID/name metadata.

## Gmail Attachments

The user explicitly selects eligible files from the clicked Gmail message. This includes inline body images only when Gmail serves them from `mail.google.com`; arbitrary third-party image hosts and declared tracking pixels are denied. Supported types are PNG, JPEG, GIF, WebP, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, ZIP, and RAR. SVG, macro-enabled Office formats, executables, and scripts are denied. The flow enforces:

- allowlisted Gmail attachment URLs;
- exact `mail-attachment.googleusercontent.com` and numbered `ciN.googleusercontent.com` allowlists for Gmail delivery redirects;
- non-opaque, URL-less responses from Gmail's own service worker while rejecting opaque responses;
- matching filename extensions and declared/response MIME types;
- file signatures;
- 10 MiB per file;
- 20 MiB per operation;
- background message size and origin validation.

The optional thumbnail mode lazily loads only validated Gmail-hosted PNG, JPEG, GIF, WebP, and inline image candidates. Non-image files remain compact rows, and thumbnail activation does not select or upload a file to ClickUp.

The sanitized HTML email copy uses an element and attribute allowlist. Remote image loads, `srcset`, `ping`, active elements, embedded styles, event handlers, forms, and unsafe URLs are removed.

## Local Storage

Persistent storage contains configuration, encrypted ClickUp credential material, the selected authentication method, reduced mappings, safe preferences, and bounded caches. Session storage contains diagnostics, focused-task coordination, and transient timer guards.

AES-GCM reduces accidental credential exposure in local snapshots. The encryption key resides in the same browser profile and does not protect against a compromised profile or device.

## Diagnostics

Safe Diagnostics remains opt-in, session-only, extension-page-only, and bounded to 200 allowlisted events in both browsers. Its JSON export uses a temporary object URL initiated from the popup.

The separate causal recorder writes incrementally when `showSaveFilePicker()` is available. Firefox uses the same sanitized JSONL schema through a 16 MiB in-memory fallback and downloads it when recording stops. This fallback adds no `downloads` permission; closing the recorder before stopping discards the pending in-memory capture.

## Build

```bash
npm run typecheck
npm test -- --runInBand
npm run build:dev-extension
npm run build:release
npm run validate:release
```

`scripts/release-allowlist.js` is the exact package contract for both targets.
It excludes TypeScript, tests, docs, credentials, backups, source maps, and
nested release artifacts. Chrome and Firefox are generated into isolated
`dist/chrome` and `dist/firefox` directories, validated independently, and
packaged deterministically with SHA-256 hashes in `dist/artifacts`.

Generated JavaScript and release directories are intentionally ignored by Git.

## Validation Policy

- TypeScript strict mode includes unused local/parameter checks.
- Jest covers message authorization, privacy, Calendar minimization, Meet mapping, Gmail uploads, timer behavior, release packaging, and UI contracts.
- Release preflight rejects CommonJS module loaders in manifest content scripts, which Firefox and Chrome execute as classic scripts.
- Real OAuth/API QA is operator-controlled and is not implied by synthetic test success.

## Community and Release Operations

- Public bug reports and feature proposals use the repository Issue forms.
- Suspected vulnerabilities use GitHub private vulnerability reporting and must not be disclosed in a public Issue.
- Pull requests target `main` and must pass typecheck, tests, the independent
  Chrome and Firefox release jobs, and Firefox `web-ext lint`.
- `.github/workflows/wiki-sync.yml` publishes maintained documentation to the separate GitHub wiki repository after relevant changes reach `main`.
- Release ZIP files are generated from the exact `scripts/release-allowlist.js` contract; `dist/` is never committed.

## Known Boundaries

- Manifest V3 service workers may restart at any time; initialization paths use single-flight promises.
- `document.execCommand` remains in the rich-text editor for browser compatibility and should be replaced only through a separately tested editor migration.
- Large UI/service-worker modules remain candidates for incremental extraction, not release-time rewrites.
- GitHub prerelease ZIP files are unsigned and intended for unpacked installation.
