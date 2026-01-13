# ClickUp Gmail Chrome Extension

> 🤖 **Built with AI**: This extension was developed by **Leandro Iramain** with the assistance of AI (Anthropic Claude / Antigravity).

A Chrome extension to create ClickUp tasks directly from Gmail emails.

![Chrome](https://img.shields.io/badge/Chrome-MV3-green.svg)
![ClickUp](https://img.shields.io/badge/ClickUp-API%20v2-7B68EE.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)
![Tests](https://img.shields.io/badge/Tests-67%20passing-brightgreen.svg)

## ✨ Features

### Core
- **Create Tasks from Gmail** - Add emails to ClickUp with one click
- **Attach to Existing** - Link emails to existing tasks
- **Smart Defaults** - Auto-fills dates, assignee, and location
- **Priority Selector** - Set task priority (Urgent/High/Normal/Low)
- **WYSIWYG Editor** - Rich text description with markdown support
- **Success Popup** - Quick link to view created task
- **Task Search** - Find tasks by ID, URL, or name

### Performance
- **List Cache** - Pre-load all spaces/folders/lists for instant modal loading
- **Stale-While-Revalidate** - Use cached data while refreshing in background

### Sync & Migration
- **Email Tasks Sync** - Sync existing email-task links when migrating PC/browser
- **Thread ID Tracking** - Email links stored in task description for efficient sync
- **Email Attachments** - Attach email files directly to ClickUp tasks

## 🛠️ Tech Stack

- **TypeScript** - 100% typed codebase
- **Manifest V3** - Modern Chrome extension format
- **esbuild** - Fast bundling
- **Jest** - 67 unit tests

## 📦 Installation

### Development
```bash
# Clone the repo
git clone https://github.com/Diramain/clickup-gmail-chrome.git
cd clickup-gmail-chrome

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Load in Chrome
# 1. Go to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select this folder
```

## ⚙️ Configuration

1. Create a ClickUp OAuth App at https://app.clickup.com/settings/integrations
2. Click the extension icon
3. Enter Client ID and Client Secret
4. Sign in with ClickUp
5. Select your default list (optional)

## 📁 Structure

```
clickup-gmail-chrome/
├── manifest.json          # Chrome MV3 manifest
├── background.ts          # Service worker (ClickUp API)
├── src/
│   ├── gmail-native.ts    # Gmail DOM integration
│   ├── gmail-adapter.ts   # DOM abstraction layer
│   ├── modal.ts           # Task creation modal
│   ├── logger.ts          # Structured logging
│   └── types/             # TypeScript definitions
├── popup/
│   ├── popup.html
│   ├── popup.ts
│   └── popup.css
├── styles/
│   ├── gmail-native.css
│   └── modal.css
├── tests/
│   ├── background.test.js
│   ├── gmail-adapter.test.js
│   └── modal.test.js
└── build.js               # esbuild config
```

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
│  - OAuth flow                                               │
│  - API retry (exponential backoff)                          │
│  - Token management                                          │
│  - Task CRUD                                                │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   ClickUp API v2                            │
└─────────────────────────────────────────────────────────────┘
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch
```

## 📄 License

MIT License - Free and Open Source

## 🙏 Credits

- **Leandro Iramain** ([@diramain](https://github.com/Diramain)) - Project Manager
- **Anthropic Claude / Antigravity** - AI Pair Programming
- **ClickUp API** - Task management platform

## 📢 Disclaimer

> **Nota del autor:**
> 
> Soy **Product Manager, no desarrollador**. Reconozco mis limitaciones técnicas y este proyecto fue creado enteramente con asistencia de IA para resolver una necesidad personal de integración entre Gmail y ClickUp.
> 
> **Invito a cualquier desarrollador** a usar, mejorar, y contribuir a este código sin necesidad de pedir permiso. Solo respeta la licencia MIT.
> 
> Este proyecto fue hecho para uso personal, no con fines comerciales. Si te resulta útil, ¡genial! Si puedes mejorarlo, ¡aún mejor!

---

Built with ❤️ and AI by a PM who dared to code
