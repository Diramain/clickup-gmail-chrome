# TaskBridge for ClickUp
## User Guide

**Version:** 2.1.0
**Last Updated:** August 2026

---

# Getting Started

## Installation

1. Install TaskBridge from the [Chrome Web Store](https://chromewebstore.google.com/detail/gihebfjgjfnglhadpeemhpdoamklckdg) when the Store version is available, or download and extract the current ZIP from [GitHub Releases](https://github.com/Diramain/taskbridge-for-clickup/releases).
2. For a GitHub ZIP, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted folder.
3. Pin the extension to your toolbar for easy access.

## Initial Setup

### Step 1: Choose a ClickUp Connection

For the simplest setup, generate your own token in [ClickUp API settings](https://app.clickup.com/settings/apps). Personal tokens are long-lived credentials with the same ClickUp access as their owner. Do not share a token between users.

For an administrator-managed deployment, create an OAuth app in ClickUp and use the advanced setup. Only a Workspace owner or admin can create that app.

### Step 2: Connect the Extension

1. Click the extension icon
2. Paste your personal token under **Conexión rápida**
3. Click **Conectar con token personal**
4. Wait for ClickUp validation; invalid or unavailable credentials are not persisted

To use OAuth instead:

1. Expand **Configuración avanzada con OAuth**
2. Copy the Redirect URL into your ClickUp OAuth app
3. Paste its **Client ID** and **Client Secret**
4. Save the encrypted local configuration and click **Iniciar sesión con ClickUp**
5. Authorize the required Workspaces

---

# Features

## 📧 Creating Tasks from Gmail

### Quick Task Creation

1. Open an email in Gmail
2. Click "➕ Add to ClickUp" button
3. Select destination list
4. Edit task details
5. Click "Create Task"

### Full Task Form

The modal includes:

| Field | Description |
|-------|-------------|
| **Task Name** | Pre-filled with email subject |
| **Description** | Rich text editor with formatting |
| **Location** | Workspace → Space → Folder → List |
| **Status** | Select task status (dynamically loaded) |
| **Assignees** | Select team members |
| **Start Date** | When to begin the task |
| **Due Date** | Deadline |
| **Priority** | Urgent, High, Normal, Low |
| **Time Estimate** | Estimated duration (e.g., 2h 30m) |
| **Track Time** | Time to log immediately |
| **Attach Email** | Include email as attachment |

### Rich Text Editor

| Button | Format | Keyboard Shortcut |
|--------|--------|-------------------|
| **B** | Bold | Ctrl+B |
| *I* | Italic | Ctrl+I |
| ~~S~~ | Strikethrough | - |
| `</>` | Inline code | - |
| 🔗 | Link | - |
| • | Bullet List | - |
| 1. | Numbered List | - |
| > | Quote | - |

The Markdown tab and visual editor stay synchronized. Supported task-description formats are headings, emphasis, ordered/unordered lists, links, quotes, and inline code.

### Gmail Attachments

The task form lists eligible files from the selected Gmail message explicitly, including supported images embedded in the body when Gmail serves them from `mail.google.com`. Use **Miniaturas** to load a visual grid for supported images and **Vista lista** to return to compact rows; documents remain in list form. Nothing is uploaded to ClickUp unless selected. Supported formats are PNG, JPEG, GIF, WebP, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, ZIP, and RAR. SVG, macro-enabled Office formats, executables, scripts, remote third-party images, and declared tracking pixels are rejected. Limits are 10 MiB per file and 20 MiB per operation.

---

## 🔗 Linking Emails to Tasks

### Automatic Linking

When you create a task from an email:
- A comment is added with the Gmail link
- The email HTML is attached
- The Thread ID is stored (for future reference)

### Finding Linked Tasks

Tasks linked to an email appear:
- In the ClickUp bar below the email header
- As badges in your Gmail inbox list

---

## 📅 Google Calendar and Meet

1. Open the full app from the extension icon.
2. Connect Google Calendar from **Agenda**.
3. Switch between Agenda and Week views.
4. Create a task using an explicit ClickUp List, or link an existing task.
5. Choose occurrence or series scope for recurring events.

Calendar access is read-only. Event details remain in an expiring in-memory cache; saved mappings contain only reduced event/series keys and ClickUp task metadata.

---

## ⏱️ Time Tracking

### From the Full App

1. Click the extension icon to open the full app
2. Go to **Tracking**
3. Search for a task
4. Click "▶️ Start Timer"
5. Click "⏹️ Stop" when done

### Manual Time Entry

1. Go to **Tracking** tab
2. Search for a task
3. Enter duration (e.g., `1h 30m`, `90m`, `1:30`)
4. Click "Add Time Entry"

### Auto-Tracking on ClickUp.com

Enable auto-tracking in **Config** tab:

| Setting | Description |
|---------|-------------|
| **Auto-start when opening task** | Timer starts when you view a recognized ClickUp task |
| **Stop when changing task or closing its last tab** | Stops A before starting B. Gmail and other non-task pages keep A running, but closing its last direct or task-specific ClickUp Inbox tab stops it |

A manual stop prevents the same still-focused task from restarting automatically. Opening another task or starting a timer explicitly clears that guard.

If the same task remains open in another Chrome window, another direct task tab,
or a task-specific ClickUp Inbox notification detail, closing one copy does not
stop the timer. The general ClickUp Inbox does not represent a specific task.

---

## ⚙️ Configuration

### Preferred Workspace

Select your default workspace for:
- Quick task creation
- Task search
- Time tracking

### Custom Field for Thread ID

| Mode | Description |
|------|-------------|
| **ON** | Stores Thread ID in a custom field (configurable name) |
| **OFF** | Stores Thread ID in task description |

> **Note:** Custom fields require ClickUp Business plan or higher.

### Syncing Data

| Action | Purpose |
|--------|---------|
| **Sync Lists** | Refresh workspace hierarchy cache |
| **Sync Email Tasks** | Find tasks linked to emails |

### Data Management

| Action | Purpose |
|--------|---------|
| **Export Data** | Download email-task mappings as JSON |
| **Clear Data** | Remove cached data (keeps auth) |

Safe Diagnostics uses separate controls and is not included in the regular data backup.

---

# Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+B | Bold text (in editor) |
| Ctrl+I | Italic text (in editor) |
| Escape | Close modal |

---

# Troubleshooting

## "Not authenticated" Error

1. Open **Conexión** in the full application.
2. Confirm that your personal token is current, or that your advanced OAuth app configuration is still valid.
3. Reconnect explicitly. TaskBridge does not invent or silently refresh unsupported ClickUp OAuth grants.

## Tasks Not Appearing in Gmail

1. Go to **Config** tab
2. Click "Sync Email Tasks"
3. Refresh Gmail page

## Timer Not Auto-Starting

Check:
1. "Auto-start when opening task" is enabled
2. You're viewing a task URL (e.g., `app.clickup.com/t/xxxxx`)
3. Refresh the ClickUp page

### Exportar un diagnóstico seguro

Si el timer sigue sin iniciar y necesitás evidencia para soporte:

1. Abrí el popup y activá **Diagnóstico seguro**.
2. Reproducí el problema una sola vez.
3. Volvé al popup y elegí **Exportar JSON**.
4. Desactivá el diagnóstico y elegí **Borrar registro** cuando termines.

El diagnóstico está apagado por defecto y conserva como máximo 200 eventos técnicos durante la sesión actual del navegador. No incluye tokens, headers, URLs, IDs de workspace/tarea, nombres, emails, payloads ni contenido de Gmail o Meet. Revisá igualmente el archivo antes de compartirlo.

## Export Data Before Switching PC

1. Go to **Config** tab
2. Click "Export Data"
3. Save the JSON file
4. On new PC, manually import or recreate links

---

# Privacy & Security

## What Data is Stored

| Data | Location | Encryption |
|------|----------|------------|
| Personal or OAuth Access Token | Local | AES-256-GCM best-effort local encryption |
| OAuth Client Secret | Local | AES-256-GCM best-effort local encryption |
| Email-Task Links | Local | No |
| User Info | Local | No |
| Safe Diagnostics (opt-in) | Browser session memory | Allowlisted fields only |

## What Data is Sent

- **To ClickUp API:** Task data, time entries, comments
- **To Gmail:** None (read-only access)

## Permissions Explained

| Permission | Why Needed |
|------------|------------|
| storage | Store settings and tokens |
| identity | OAuth authentication flow |
| tabs | Coordinate active Gmail, ClickUp, and exact Meet tabs without browsing-history access |
| host access | Gmail, ClickUp API/app, and `https://meet.google.com/*` for the opt-in minimal Meet detector |

---

# FAQ

**Q: Can I use this without an OAuth app?**
A: Yes. Use your own ClickUp personal token under **Conexión rápida**. OAuth remains available as an advanced option for owners or admins who manage their own app.

**Q: Does this work with Google Workspace?**
A: Yes, as long as you have access to Gmail.

**Q: Can I change the custom field name?**
A: Yes, go to Config → Custom Field → enter name → Save Field Name

**Q: Is my data synced across devices?**
A: No, data is stored locally per browser.

---

# Support

- **GitHub:** [github.com/Diramain/taskbridge-for-clickup](https://github.com/Diramain/taskbridge-for-clickup)
- **Issues:** Use the [guided Issue forms](https://github.com/Diramain/taskbridge-for-clickup/issues/new/choose) for bugs and feature requests.
- **Security:** Use [private vulnerability reporting](https://github.com/Diramain/taskbridge-for-clickup/security/advisories/new), never a public Issue.
- **Wiki:** Read the [online documentation](https://github.com/Diramain/taskbridge-for-clickup/wiki).

---

**Built with ❤️ by Leandro Iramain**
