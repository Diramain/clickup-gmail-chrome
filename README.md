# ClickUp Gmail Chrome Extension

> 🤖 **Built with AI**: This extension was developed by [**Leandro Iramain**](https://leandroiramain.com.ar) with the assistance of AI.

A Chrome extension to create ClickUp tasks directly from Gmail emails with time tracking, email-task linking, safer local data handling, and local-first build validation.

![Chrome](https://img.shields.io/badge/Chrome-MV3-green.svg)
![ClickUp](https://img.shields.io/badge/ClickUp-API%20v2-7B68EE.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)
![Tests](https://img.shields.io/badge/Tests-local%20suite-brightgreen.svg)
![Version](https://img.shields.io/badge/Version-1.2.0-blue.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## 🆕 What's New in v1.2.0

- ✅ **Link reliability:** Gmail thread links now use a safer V2 state model with validation, retries, and less accidental unlinking.
- 🔐 **Message and render hardening:** Runtime messages are origin/schema checked; Gmail HTML and high-risk UI sinks are sanitized before use.
- 💾 **Safer local data tools:** Exports are versioned and limited to link/settings data; clear requires a recent export and explicit confirmation.
- 📦 **Release preflight:** Added local release build/validation scripts with an explicit allowlist and blocked-file checks. No ZIP/signing is performed by default.
- ✍️ **Author metadata:** Extension metadata and popup footer now identify Leandro Iramain as author.


---

## ✨ Features

### Core
- **Create Tasks from Gmail** - Add emails to ClickUp with one click
- **Attach to Existing** - Link emails to existing tasks
- **Smart Defaults** - Auto-fills dates, assignee, and location
- **Priority Selector** - Set task priority (Urgent/High/Normal/Low)
- **WYSIWYG Editor** - Rich text description with markdown support
- **Success Popup** - Quick link to view created task
- **Task Search** - Find tasks by ID, URL, or name

### Time Tracking
- **Timer Controls** - Start/stop timer from popup
- **Manual Entry** - Log time with ClickUp format (1h, 30m, 1:30)
- **Recent Entries** - View 7-day time history
- **Auto-Start** - Automatically start timer when opening a task on ClickUp.com
- **Auto-Stop** - Automatically stop timer when leaving task view
- **Toggle Settings** - Enable/disable auto-tracking per preference

### Performance
- **List Cache** - Pre-load all spaces/folders/lists for instant modal loading
- **Stale-While-Revalidate** - Use cached data while refreshing in background

### Sync & Migration
- **Email Tasks Sync** - Sync existing email-task links when migrating PC/browser
- **Thread ID Tracking** - Email links stored in task description for efficient sync
- **Sanitized Email HTML Attachment** - Attach a sanitized HTML snapshot of the email to ClickUp tasks. Original Gmail file attachments are disabled in v1.2.0.

---

## 🔐 Security

This extension reduces common local-extension risks but is not a security boundary against a compromised browser profile, machine, or malicious extension. OAuth credentials and tokens are handled locally; token storage uses Web Crypto helpers to reduce accidental exposure, not to provide absolute protection if the local profile is compromised.

| Feature | Description |
|---------|-------------|
| **Local token handling** | OAuth tokens are stored through Web Crypto helper routines where available |
| **Production-safe logger** | Debug and sensitive payload logging is suppressed in normal builds |
| **Message validation** | Runtime messages are checked by sender origin and expected shape |
| **Sanitized Gmail HTML** | Email HTML is sanitized before being attached or rendered through extension flows |
| **Narrower permissions** | Runtime host permissions are limited to Gmail, ClickUp API, and app.clickup.com |
| **No analytics** | No telemetry or analytics code is included |

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

---

## 🛠️ Tech Stack

- **TypeScript** - 100% typed codebase
- **Manifest V3** - Modern Chrome extension format
- **esbuild** - Fast bundling
- **Jest** - local unit/integration-style tests for hardening-critical paths
- **GitHub Actions** - CI/CD pipeline

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [User Guide](USER_GUIDE.md) | Legacy v1.1.3 usage snapshot; see this README and the changelog for v1.2.0 changes |
| [Technical Docs](TECHNICAL_DOCS.md) | Legacy v1.1.4 architecture snapshot; implementation and release docs are authoritative for v1.2.0 |
| [Changelog](CHANGELOG.md) | Version history and changes |
| [Contributing](CONTRIBUTING.md) | How to contribute |
| [Security](SECURITY.md) | Security policy |
| [Wiki](https://github.com/Diramain/clickup-gmail-chrome/wiki) | Online documentation |

---

## 📦 Installation

### From Release (Recommended)

1. Download the latest release from [Releases](https://github.com/Diramain/clickup-gmail-chrome/releases)
2. Extract the ZIP file
3. Go to `chrome://extensions`
4. Enable "Developer mode"
5. Click "Load unpacked"
6. Select the extracted folder

### From Source

```bash
# Clone the repo
git clone https://github.com/Diramain/clickup-gmail-chrome.git
cd clickup-gmail-chrome

# Install dependencies
npm install

# Build
npm run build

# Build the supported local release directory and validate it
npm run build:release
npm run validate:release

# Run tests
npm test

# Load in Chrome
# 1. Go to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select this folder
```

Only `npm run build:release` plus `npm run validate:release` is supported for the local release directory. Legacy shell packaging scripts are intentionally ignored and are not part of the v1.2.0 release process.

---

## ⚙️ Configuration

1. **Create ClickUp OAuth App** at https://app.clickup.com/settings/integrations
2. Click the extension icon
3. Enter **Client ID** and **Client Secret**
4. Click **Sign in with ClickUp**
5. Select your preferred workspace (optional)

---

## 📁 Project Structure

```
clickup-gmail-chrome/
├── manifest.json          # Chrome MV3 manifest
├── background.ts          # Service worker (ClickUp API)
├── src/
│   ├── services/          # API, Auth, Crypto, Storage, Timer
│   ├── clickup-tracker.ts # Auto time tracking on ClickUp.com
│   ├── gmail-native.ts    # Gmail DOM integration
│   ├── gmail-adapter.ts   # DOM abstraction layer
│   ├── modal.ts           # Task creation modal (59KB)
│   ├── logger.ts          # Structured logging
│   └── types/             # TypeScript definitions
├── popup/
│   ├── popup.html         # 3-tab UI (Tasks, Tracking, Config)
│   ├── popup.ts
│   └── popup.css
├── styles/
│   └── modal.css
├── tests/                 # Jest suites for service, UI, privacy, and release checks
└── .github/workflows/     # CI/CD pipeline
```

---

## 🔧 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Gmail Page                            │
├─────────────────────────────────────────────────────────────┤
│  gmail-native.ts → gmail-adapter.ts → DOM                   │
│       ↓                                                      │
│  modal.ts (Task Creation UI)                                │
│       ↓                                                      │
│  chrome.runtime.sendMessage()                               │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   background.ts (Service Worker)            │
├─────────────────────────────────────────────────────────────┤
│  ClickUpAPIWrapper                                          │
│  - OAuth flow (encrypted tokens)                            │
│  - API retry (exponential backoff)                          │
│  - Token refresh on 401                                     │
│  - Task CRUD, Time Tracking                                 │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   ClickUp API v2                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run with coverage
npm test -- --coverage
```

The local baseline includes typecheck, Jest, normal build, release build, release validation, and whitespace diff checks.

---

## 📄 License

[MIT License](LICENSE) - Free and Open Source

---

## 🙏 Credits

- **Leandro Iramain** ([website](https://leandroiramain.com.ar), [@diramain](https://github.com/Diramain)) - Author / Product Manager
- **Anthropic Claude / Antigravity** - AI Pair Programming
- **ClickUp API** - Task management platform

---

## 📢 Disclaimer

> **Nota del autor:**
> 
> Soy **Product Manager, no desarrollador**. Reconozco mis limitaciones técnicas y este proyecto fue creado enteramente con asistencia de IA para resolver una necesidad personal de integración entre Gmail y ClickUp.
> 
> **Invito a cualquier desarrollador** a usar, mejorar, y contribuir a este código sin necesidad de pedir permiso. Solo respeta la licencia MIT.
> 
> Este proyecto fue hecho para uso personal, no con fines comerciales. Si te resulta útil, ¡genial! Si puedes mejorarlo, ¡aún mejor!

---

<p align="center">
  Built with ❤️ and AI by a PM who dared to code
</p>
