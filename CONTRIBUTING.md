# Contributing to TaskBridge for ClickUp

Thank you for improving TaskBridge. Ordinary bugs and feature ideas belong in the guided GitHub Issue forms. Suspected vulnerabilities must use [private vulnerability reporting](https://github.com/Diramain/taskbridge-for-clickup/security/advisories/new), not a public Issue or pull request.

## Project Structure

```
taskbridge-for-clickup/
├── background.ts           # Service worker (router)
├── app/                    # Responsive full-tab application
├── popup/                  # Launcher and durable setup UI
├── src/
│   ├── calendar/           # Read-only Calendar agenda and mappings
│   ├── meet/               # Minimal Meet detector and task mappings
│   ├── constants.ts        # Centralized constants
│   ├── modal.ts            # Task creation modal
│   ├── gmail-adapter.ts    # Gmail DOM queries
│   ├── gmail-native.ts     # Gmail content script
│   ├── clickup-tracker.ts  # ClickUp page content script
│   ├── logger.ts           # Debug logging
│   ├── services/           # Service layer
│   │   ├── auth.service.ts     # OAuth, tokens, session
│   │   ├── api.service.ts      # ClickUp API wrapper
│   │   ├── timer.service.ts    # Time tracking + badge
│   │   ├── storage.service.ts  # Storage abstraction
│   │   └── crypto.service.ts   # Token encryption (AES-256-GCM)
│   ├── types/
│   │   └── clickup.d.ts    # TypeScript definitions
│   └── utils/
│       └── sanitize.utils.ts   # XSS prevention
├── tests/                  # Jest tests
├── scripts/                # Build and exact release validation
├── store-assets/           # Store artwork and reproducible fixtures
├── .github/workflows/      # CI/CD
├── build.js                # esbuild configuration
└── manifest.json           # Extension manifest (MV3)
```

## Services Architecture

```
┌─────────────────────────────────────────┐
│           UI Layer (popup, modal)       │
├─────────────────────────────────────────┤
│         chrome.runtime.sendMessage      │
├─────────────────────────────────────────┤
│        background.ts (Router)           │
├─────────────────────────────────────────┤
│              Services                   │
│  ┌─────────┬──────────┬───────────┐     │
│  │  auth   │   api    │   timer   │     │
│  ├─────────┴──────────┴───────────┤     │
│  │  storage       │    crypto     │     │
│  └────────────────┴───────────────┘     │
└─────────────────────────────────────────┘
```

## Development

Use Node.js 20, matching GitHub Actions.

```bash
npm ci
npm run typecheck
npm test -- --runInBand
npm run build:release
npm run validate:release
```

Use `npm run watch` only for local iteration. Do not commit generated JavaScript, `dist/`, ZIP files, credentials, browser profiles, exported diagnostics, or real Gmail/ClickUp/Meet data.

## Loading in Chrome

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Run `npm run build:dev-extension`
4. Click "Load unpacked" and select `dist/dev-extension`

## Using Services

```typescript
// Import services
import { authService } from './src/services/auth.service';
import { ClickUpAPIWrapper } from './src/services/api.service';
import { timerService } from './src/services/timer.service';
import { storageService } from './src/services/storage.service';

// Example usage
const token = await authService.getAccessToken();
const api = new ClickUpAPIWrapper(token);
api.setAuthenticationFailureCallback(async () => {
  // Invalidate the rejected local session and ask the user to reconnect.
});
```

## Change Boundaries

- Keep host pages untrusted and preserve sender/origin/schema checks on runtime messages.
- Never log, fixture, screenshot, or commit tokens, headers, account data, Gmail content, Meet content, private URLs, or diagnostic exports.
- Do not broaden Chrome permissions without a documented need, privacy review, and test coverage.
- Keep ClickUp writes non-replayed by default. Retries are limited to operations proven safe by the API layer.
- Treat AES-GCM storage as best-effort local protection, not protection from a compromised browser profile or machine.
- Preserve Calendar read-only scope and Meet data minimization.

## Security

Read the repository [security policy](https://github.com/Diramain/taskbridge-for-clickup/blob/main/SECURITY.md) before changing authentication, storage, API, message, HTML, Gmail, Calendar, Meet, or release boundaries.

## CI/CD

GitHub Actions runs on pushes and pull requests to `main`:

1. Install from the lockfile with Node.js 20.
2. Run strict TypeScript checks.
3. Run the Jest suite.
4. Build and validate the exact release directory.
5. Upload the validated release directory as a short-lived artifact.

Relevant documentation changes merged into `main` are synchronized to the GitHub wiki.

## Pull Requests

1. Open or reference an Issue when the change needs prior discussion.
2. Create a focused branch and keep unrelated changes out of the pull request.
3. Update tests and documentation for changed behavior.
4. Run the same checks used by CI.
5. Target `main` and describe behavior, security/privacy impact, validation, and remaining manual QA.

Real-account OAuth, Gmail, Calendar, Meet, or ClickUp-write testing is operator-controlled. A contributor must not use or request repository-owner credentials.
