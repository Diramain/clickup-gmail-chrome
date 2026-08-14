# Privacy Policy for ClickUp Gmail Tracker

**Last Updated:** 2026-08-13

## 1. Overview

ClickUp Gmail Tracker is a Chrome extension that helps you create or attach ClickUp tasks from Gmail. The extension runs locally in your browser and does not operate its own servers or analytics service.

This policy describes what the extension handles for version 1.2.3. It does not replace the privacy policies of Google/Gmail, ClickUp, Chrome, or your browser profile provider.

## 2. Gmail Data

The extension reads Gmail data only when you initiate a create or attach action, such as opening the task modal from a Gmail thread or attaching the current email to an existing ClickUp task.

Depending on the action you choose, the extension may use or transfer to ClickUp:

- email subject;
- sender/from value;
- Gmail thread ID;
- Gmail URL for the thread;
- relevant email content used to create task descriptions, comments, or attachments.

When the sanitized HTML attachment option is selected, the extension may upload a sanitized HTML representation of the email as a ClickUp task attachment. In v1.2.0 this checkbox is enabled by default. Original Gmail file attachments are disabled in this version and are not uploaded by the extension.

When automatic ClickUp time tracking is enabled, the extension evaluates ClickUp tab URLs locally to identify a direct task or a task notification detail. Once a task timer is running, navigating to Gmail, Chatwoot, Inbox, or another non-task page does not by itself stop that timer. Opening another recognized task may switch the timer according to the enabled automatic controls. With Auto-Stop enabled, closing the last direct or task-specific ClickUp Inbox tab for the running task stops that timer; another tab for the same task in any Chrome window preserves it.

For this closure check, while Auto-Stop is enabled, a bounded in-memory browser-session index stores only `tabId → taskId` pairs and is restricted to trusted extension contexts. It does not store full ClickUp URLs, external browsing URLs, query strings, fragments, or encoded notification payloads. The index is cleared when Auto-Stop is disabled and on logout, confirmed authentication invalidation, clear-local-data, extension reload/update, or browser restart. A separate manual stop suppression stores only the stopped task ID in session storage so the same focused task does not immediately restart; it is cleared for another valid task, an explicit start, or the same identity/lifecycle boundaries.

## 3. Google Meet Priority Data

Google Meet Priority is optional and off by default. A minimal content script is loaded only on `https://meet.google.com/*`, but while the feature is off it remains dormant except for reading the local opt-in state through a narrow background message. When you enable the feature, it validates a canonical room code from the current path and looks for a limited local DOM signal representing an enabled Leave Call control. Home and prejoin pages do not start ClickUp timers.

Before any room identity leaves the Meet content script, the extension computes `SHA-256("cgc-meet-v1:" + roomCode)`. Runtime messages contain only a closed event type and the resulting 64-character room key. The raw room code, full URL, URL parameters, fragment, meeting title, Calendar event, invitees, and participants are not sent to the background worker, persisted, or logged by this feature.

The feature does not access or capture audio, microphone, video, camera, chat, captions, transcripts, screen content, screenshots, or participant lists. It does not request audio/video/tab/desktop capture, history, notifications, or Google Calendar permissions.

If you choose to remember a room association, local storage contains only the pseudonymous room key, ClickUp task ID, workspace ID, creation/last-use timestamps, and enabled state. A stable room hash is pseudonymous metadata, not anonymous data. You can disable or delete each association in the popup, remove all local mappings with the clear-data control, or uninstall the extension.

When a confirmed Meet session is assigned to a task, the extension may stop the current ClickUp timer and start/stop a ClickUp time entry through the existing authenticated ClickUp API connection. Meet Priority does not send meeting content to ClickUp.

The extension is not allowed to run in incognito mode.

## 4. ClickUp Data and OAuth

The extension sends requested task, comment, attachment, time-entry, and metadata operations directly to ClickUp through ClickUp APIs. Data sent to ClickUp is controlled by ClickUp after transfer and is subject to ClickUp's own policies and your workspace settings.

The OAuth access token and OAuth configuration are stored locally in the browser profile. The extension encrypts these values using local best-effort encryption before storage where the secure helpers are used. The encryption key also lives in the same browser profile, so this protects primarily against casual at-rest inspection and does not protect a compromised device or browser profile.

The extension does not rely on an undocumented refresh-token grant. A `401` from a specific API operation does not automatically disconnect you: safe reads may try the alternate raw/Bearer header once, and the extension confirms the current token against ClickUp's user endpoint. Only a confirmed rejection of the token that is still current removes that token and cached identity data, keeps the encrypted OAuth app configuration, pauses automatic tracking, and asks you to reconnect explicitly.

## 5. Local Storage

The extension may store locally:

- the encrypted best-effort OAuth access token and OAuth configuration;
- Gmail-thread-to-ClickUp-task mappings and task metadata;
- user settings;
- hierarchy/team/user caches used to reduce repeated API calls;
- sync status metadata such as last local sync time/count.
- the Meet Priority opt-in setting and pseudonymous room-to-task mappings described above.
- the bounded session-only task-tab index described above, containing only browser tab IDs and ClickUp task IDs;
- when you explicitly enable Safe Diagnostics, up to 200 allowlisted technical events in in-memory browser-session storage. These events use timestamps, sequence numbers, categorical routes/outcomes, bounded counts, and allowlisted ClickUp error codes. They do not include tokens, authorization headers, URLs, workspace or task IDs, names, email addresses, API payloads, or Gmail/Meet content.

The email body is not retained as a local mapping. It may be processed temporarily for the action you initiate and may be sent to ClickUp if you create comments/descriptions or keep the sanitized HTML attachment selected.

Mappings persist until you delete them, clear local data, or uninstall the extension. Caches may expire, be replaced, or be cleared by the user. The extension does not claim automatic time-based purging of mappings.

Host content scripts for Gmail, ClickUp, and Meet are denied direct access to `chrome.storage.local`. Approved reads go through origin-checked, schema-validated background messages. This reduces exposure but does not protect a compromised browser profile or device.

Safe Diagnostics is off by default. Its state and bounded event buffer use `chrome.storage.session` with access restricted to trusted extension contexts. Chrome keeps that area in memory and clears it when the extension is disabled, reloaded, or updated, and when the browser restarts. You can also disable capture, export the allowlisted JSON, or clear the buffer from the popup at any time.

## 6. Export and Clear Controls

The safe export feature is intended to include Gmail mappings, task metadata, and selected non-sensitive settings. It does not include OAuth tokens, OAuth client configuration, or email HTML. It also excludes Meet room keys and Meet task mappings.

Safe Diagnostics has a separate export control. That JSON contains only its versioned, allowlisted session events and summary counts; it does not include the regular backup data or any of the excluded values listed above.

The clear local data action removes local links and non-auth caches from the extension's browser storage. It does not delete or modify data already sent to ClickUp. To remove tasks, comments, attachments, or other records in ClickUp, manage them in ClickUp.

## 7. No Extension Servers or Analytics

The extension does not send your data to servers operated by the extension author. It does not include extension-operated analytics, tracking pixels, or telemetry services.

Network communication is limited to browser/Gmail/ClickUp behavior needed for the actions you initiate and the extension permissions you grant. Meet detection and room hashing occur locally in the browser; time-entry changes are sent directly to ClickUp.

## 8. Your Controls

You can control or remove data by using:

- the extension's safe export control;
- the extension's clear local data control;
- the Meet Priority opt-in toggle and individual mapping enable/delete controls;
- the Safe Diagnostics opt-in toggle, separate JSON export, and clear-log control;
- ClickUp OAuth revocation in your ClickUp account/workspace settings;
- browser extension uninstall/removal;
- deletion or modification of tasks, comments, attachments, and other records directly in ClickUp.

## 9. Contact

For questions, contact the author via: https://leandroiramain.com.ar
