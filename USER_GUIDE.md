# ClickUp Gmail Chrome Extension
## User Guide

**Version:** 1.1.0  
**Last Updated:** January 2026

---

# Getting Started

## Installation

1. Download the extension from Chrome Web Store
2. Click "Add to Chrome"
3. Pin the extension to your toolbar for easy access

## Initial Setup

### Step 1: Create ClickUp OAuth App

1. Go to [ClickUp Settings → Integrations](https://app.clickup.com/settings/integrations)
2. Click "Create an App"
3. Enter a name (e.g., "Gmail Tracker")
4. Copy the **Redirect URL** from the extension popup
5. Paste it in ClickUp
6. Copy the **Client ID** and **Client Secret**

### Step 2: Configure Extension

1. Click the extension icon
2. Paste your **Client ID** and **Client Secret**
3. Click "Save Configuration"
4. Click "Sign in with ClickUp"
5. Authorize the app in the popup

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
| `</>` | Code | - |
| 🔗 | Link | - |
| • | Bullet List | - |
| 1. | Numbered List | - |
| > | Quote | - |

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

## ⏱️ Time Tracking

### From Popup

1. Click the extension icon
2. Go to **Tracking** tab
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
| **Auto-start when opening task** | Timer starts when you view a task |
| **Auto-stop when closing task** | Timer stops when you leave the task |

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

1. Go to **Config** tab
2. Click "Test Token Refresh"
3. If fails, sign out and sign in again

## Tasks Not Appearing in Gmail

1. Go to **Config** tab
2. Click "Sync Email Tasks"
3. Refresh Gmail page

## Timer Not Auto-Starting

Check:
1. "Auto-start when opening task" is enabled
2. You're viewing a task URL (e.g., `app.clickup.com/t/xxxxx`)
3. Refresh the ClickUp page

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
| Access Token | Local | AES-256-GCM |
| Refresh Token | Local | AES-256-GCM |
| Client Secret | Local | AES-256-GCM |
| Email-Task Links | Local | No |
| User Info | Local | No |

## What Data is Sent

- **To ClickUp API:** Task data, time entries, comments
- **To Gmail:** None (read-only access)

## Permissions Explained

| Permission | Why Needed |
|------------|------------|
| storage | Store settings and tokens |
| identity | OAuth authentication flow |
| contextMenus | Right-click menu integration |
| tabs | Communicate with Gmail/ClickUp tabs |

---

# FAQ

**Q: Can I use this without an OAuth app?**
A: No, OAuth is required for security. ClickUp Personal API tokens are not supported.

**Q: Does this work with Google Workspace?**
A: Yes, as long as you have access to Gmail.

**Q: Can I change the custom field name?**
A: Yes, go to Config → Custom Field → enter name → Save Field Name

**Q: Is my data synced across devices?**
A: No, data is stored locally per browser.

---

# Support

- **GitHub:** [github.com/diramain/clickup-gmail-chrome](https://github.com/diramain/clickup-gmail-chrome)
- **Issues:** Report bugs on GitHub Issues
- **Feature Requests:** Create a GitHub Issue with "Feature" label

---

**Built with ❤️ by Leandro Iramain**
