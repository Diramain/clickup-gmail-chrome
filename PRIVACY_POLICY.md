# Privacy Policy for TaskBridge for ClickUp

**Last Updated:** 2026-08-23

## 1. Overview

TaskBridge for ClickUp is a Chrome extension that connects Gmail, optional Google Calendar and Meet workflows, and ClickUp task/time tracking. The extension runs locally in your browser and does not operate its own servers or analytics service.

This policy describes what the extension handles for version 2.0.0. It does not replace the privacy policies of Google/Gmail, ClickUp, Chrome, or your browser profile provider.

## 2. Gmail Data

The extension reads Gmail data only when you initiate a create or attach action, such as opening the task modal from a Gmail thread or attaching the current email to an existing ClickUp task.

Depending on the action you choose, the extension may use or transfer to ClickUp:

- email subject;
- sender/from value;
- Gmail thread ID;
- Gmail URL for the thread;
- relevant email content used to create task descriptions, comments, or attachments.

When the sanitized HTML attachment option is selected, the extension may upload a sanitized HTML representation of the email as a ClickUp task attachment. This checkbox is enabled by default. The modal also lets you explicitly select supported attachments from the clicked Gmail message: PNG, JPEG, GIF, WebP, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, ZIP, and RAR. This may include images displayed inside the email body only when Gmail serves them from HTTPS `mail.google.com`; arbitrary third-party image hosts and declared tracking pixels are excluded. SVG, macro-enabled Office formats, executables, and scripts are also excluded. Activating the optional thumbnail view loads validated Gmail-hosted images into the modal but does not select them or send them to ClickUp. Each selected file starts from a validated HTTPS `mail.google.com` URL. The response may finish only on `mail.google.com`, Gmail's exact `mail-attachment.googleusercontent.com` host, a numbered `ciN.googleusercontent.com` Gmail image-delivery host, or a non-opaque response produced by Gmail's own service worker without an exposed final URL. Limits are 10 MiB per file and 20 MiB per action, and files are sent one at a time to ClickUp. The extension background service worker does not fetch Gmail attachments. Attachment URLs and bytes are not persisted or logged by the extension.

When automatic ClickUp time tracking is enabled, the extension evaluates ClickUp tab URLs locally to identify a direct task or a task notification detail. Once a task timer is running, navigating to Gmail, Chatwoot, Inbox, or another non-task page does not by itself stop that timer. Opening another recognized task may switch the timer according to the enabled automatic controls. With Auto-Stop enabled, closing the last direct or task-specific ClickUp Inbox tab for the running task stops that timer; another tab for the same task in any Chrome window preserves it.

For this closure check, while Auto-Stop is enabled, a bounded in-memory browser-session index stores only `tabId → taskId` pairs and is restricted to trusted extension contexts. It does not store full ClickUp URLs, external browsing URLs, query strings, fragments, or encoded notification payloads. The index is cleared when Auto-Stop is disabled and on logout, confirmed authentication invalidation, clear-local-data, extension reload/update, or browser restart. A separate manual stop suppression stores only the stopped task ID in session storage so the same focused task does not immediately restart; it is cleared for another valid task, an explicit start, or the same identity/lifecycle boundaries.

## 3. Google Meet Priority Data

Google Meet Priority is optional and off by default. A minimal content script is loaded only on `https://meet.google.com/*`, but while the feature is off it remains dormant except for reading the local opt-in state through a narrow background message. When you enable the feature, it validates a canonical room code from the current path and looks for a limited local DOM signal representing an enabled Leave Call control. Home and prejoin pages do not start ClickUp timers.

Before any room identity leaves the Meet content script, the extension computes `SHA-256("cgc-meet-v1:" + roomCode)`. Runtime messages contain only a closed event type and the resulting 64-character room key. The raw room code, full URL, URL parameters, fragment, meeting title, Calendar event, invitees, and participants are not sent to the background worker, persisted, or logged by this feature.

The feature does not access or capture audio, microphone, video, camera, chat, captions, transcripts, screen content, screenshots, or participant lists. It does not request audio/video/tab/desktop capture, history, or notifications. Google Calendar uses the separate optional read-only scope described below.

If you choose to remember a room association, local storage contains only the pseudonymous room key, ClickUp task ID, workspace ID, creation/last-use timestamps, and enabled state. A stable room hash is pseudonymous metadata, not anonymous data. You can disable or delete each association in the popup, remove all local mappings with the clear-data control, or uninstall the extension.

When a confirmed Meet session is assigned to a task, the extension may stop the current ClickUp timer and start/stop a ClickUp time entry through the existing authenticated ClickUp API connection. Meet Priority does not send meeting content to ClickUp.

The extension is not allowed to run in incognito mode.

## 4. Google Calendar Data

Google Calendar is optional and connects only after you press the explicit connect control and approve Google's consent screen. The extension requests only `calendar.events.owned.readonly` and reads at most 20 events from the primary calendar within the next seven days.

The extension reduces each response to the event title, start/end time, confirmed/tentative state, and whether a canonical Google Meet link exists. It does not retain or expose invitees, descriptions, locations, organizer data, attachments, full Meet URLs, or Calendar event IDs. Calendar event details remain in bounded memory for up to one minute and are cleared on disconnect, extension reload, or browser restart. Google OAuth tokens remain managed by `chrome.identity` and are not written to extension storage or diagnostics.

Calendar-to-ClickUp task linking is an explicit user action. It persists reduced SHA-256 occurrence or recurring-series keys plus ClickUp task ID/name metadata; a Meet mapping may also be saved when the event has a canonical Meet room. Raw Calendar event IDs and full Meet URLs are not persisted. Disconnecting removes the known cached Google token and clears the in-memory agenda; you can also revoke access in your Google account.

## 5. ClickUp Data and Authentication

The extension sends requested task, comment, attachment, time-entry, and metadata operations directly to ClickUp through ClickUp APIs. Data sent to ClickUp is controlled by ClickUp after transfer and is subject to ClickUp's own policies and your workspace settings.

You can connect with your own ClickUp personal token or, as an advanced owner/admin option, with a ClickUp OAuth app that you manage. A personal token is validated against ClickUp before it replaces the current connection. It is not saved while you type and is not persisted if its shape is invalid, ClickUp rejects it, or validation is unavailable.

The selected personal or OAuth access token and any OAuth client configuration are stored locally in the browser profile. The extension encrypts these values using local best-effort AES-256-GCM encryption before persistence. The encryption key also lives in the same browser profile, so this protects primarily against casual at-rest inspection and does not protect a compromised device or browser profile. No ClickUp token, Client ID, or Client Secret is hardcoded into the extension package.

The extension does not rely on an undocumented refresh-token grant. A `401` from a specific API operation does not automatically disconnect you: safe reads may try the alternate raw/Bearer header once, and the extension confirms the current token against ClickUp's user endpoint. Only a confirmed rejection of the token that is still current removes that token and cached identity data, pauses automatic tracking, and asks you to replace a personal token or reconnect OAuth explicitly. OAuth configuration is retained only for an OAuth reconnection.

## 6. Local Storage

The extension may store locally:

- the encrypted best-effort personal or OAuth access token and, when selected, OAuth configuration;
- Gmail-thread-to-ClickUp-task mappings and task metadata;
- user settings, including the versioned enable/disable preference for native Gmail controls;
- hierarchy/team/user caches used to reduce repeated API calls;
- sync status metadata such as last local sync time/count.
- the Meet Priority opt-in setting and pseudonymous room-to-task mappings described above.
- the bounded session-only task-tab index described above, containing only browser tab IDs and ClickUp task IDs;
- when you explicitly enable Safe Diagnostics, up to 200 allowlisted technical events in in-memory browser-session storage. These events use timestamps, sequence numbers, categorical routes/outcomes, bounded counts, and allowlisted ClickUp error codes. They do not include tokens, authorization headers, URLs, workspace or task IDs, names, email addresses, API payloads, or Gmail/Meet content.

The email body is not retained as a local mapping. It may be processed temporarily for the action you initiate and may be sent to ClickUp if you create comments/descriptions or keep the sanitized HTML attachment selected.

Mappings persist until you delete them, clear local data, or uninstall the extension. Caches may expire, be replaced, or be cleared by the user. The extension does not claim automatic time-based purging of mappings.

Gmail, ClickUp, and Meet host content scripts are denied direct access to trusted local persistence. Chrome restricts `chrome.storage.local` to trusted extension contexts. Firefox uses extension-origin IndexedDB and a fail-closed facade because Firefox does not implement `StorageArea.setAccessLevel`. Approved reads and all privileged operations go through origin-checked, schema-validated background messages. This reduces exposure but does not protect a compromised browser profile or device.

Safe Diagnostics is off by default. Its state and bounded event buffer use browser session storage restricted to trusted extension contexts. Chrome applies `TRUSTED_CONTEXTS`; Firefox session storage is trusted-only by default. The browser clears this area when the extension or browser session ends. You can also disable capture, export the allowlisted JSON, or clear the buffer from the popup at any time.

## 7. Export and Clear Controls

The safe export feature is intended to include Gmail mappings, task metadata, and selected non-sensitive settings. It does not include personal tokens, OAuth tokens, OAuth client configuration, authentication method state, or email HTML. It also excludes Meet room keys and Meet task mappings.

Safe Diagnostics has a separate export control. That JSON contains only its versioned, allowlisted session events and summary counts; it does not include the regular backup data or any of the excluded values listed above.

The clear local data action removes local links and non-auth caches from the extension's browser storage. It does not delete or modify data already sent to ClickUp. To remove tasks, comments, attachments, or other records in ClickUp, manage them in ClickUp.

## 8. No Extension Servers or Analytics

The extension does not send your data to servers operated by the extension author. It does not include extension-operated analytics, tracking pixels, or telemetry services.

Network communication is limited to browser, Gmail, ClickUp, and the read-only Google Calendar behavior needed for the actions you initiate and the extension permissions you grant. Meet detection and room hashing occur locally in the browser; time-entry changes are sent directly to ClickUp.

## 9. Your Controls

You can control or remove data by using:

- the extension's safe export control;
- the extension's clear local data control;
- the Meet Priority opt-in toggle and individual mapping enable/delete controls;
- the Safe Diagnostics opt-in toggle, separate JSON export, and clear-log control;
- personal-token regeneration or OAuth revocation in your ClickUp account/workspace settings;
- Google Calendar disconnect in the app and OAuth revocation in your Google account;
- browser extension uninstall/removal;
- deletion or modification of tasks, comments, attachments, and other records directly in ClickUp.

## 10. Contact

For questions, contact the author via: https://leandroiramain.com.ar
