# Contributing to ClickUp Gmail Extension

## Project Structure

```
clickup-gmail-chrome/
├── background.ts           # Service worker (router)
├── popup/
│   └── popup.ts            # Popup UI
├── src/
│   ├── constants.ts        # Centralized constants
│   ├── modal.ts            # Task creation modal
│   ├── gmail-adapter.ts    # Gmail DOM queries
│   ├── gmail-native.ts     # Gmail content script
│   ├── clickup-tracker.ts  # ClickUp page content script
│   ├── logger.ts           # Debug logging
│   ├── services/           # ⭐ Service Layer
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

```bash
npm install     # Install dependencies
npm run build   # Build extension
npm run watch   # Build with watch
npm test        # Run tests
```

## Loading in Chrome

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select project folder

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
api.setTokenRefreshCallback(() => authService.refreshToken());
```

## Technical Debt

| File | Status | Note |
|------|--------|------|
| `background.ts` | ⚠️ Large | Can migrate to use services |
| `popup.ts` | ⚠️ Large | Split by tab recommended |
| `modal.ts` | ⚠️ Large | Split into components |

## Security

See `SECURITY.md` for token encryption, XSS prevention, rate limiting.

## CI/CD

GitHub Actions runs on push/PR:
1. Type check
2. Tests
3. Build
4. Upload artifact

## Pull Requests

1. Run `npm run build` - no errors
2. Test OAuth flow after auth changes
3. Test in Gmail after content script changes
