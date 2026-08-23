# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-08-23

### Changed
- Gmail attachment selection now associates files with the correct message in a multi-message thread, including response attachment footers outside the message container.
- Explicit Gmail uploads now support bounded PDF, Office, text, ZIP, and RAR files in addition to images.
- Gmail-hosted images embedded in the message body can now be selected explicitly even when Gmail does not render a separate attachment card.
- Partial upload notices now identify a safe failure category without logging filenames, URLs, task identifiers, or file contents.
- Empty tracked-time input is omitted instead of being sent as an invalid `null` value.
- Gmail attachment downloads accept the exact `mail-attachment.googleusercontent.com` delivery redirect while continuing to reject other redirect hosts.
- Gmail attachment delivery also accepts numbered `ciN.googleusercontent.com` hosts and non-opaque URL-less responses from Gmail's service worker; opaque and unrelated hosts remain blocked.
- Deleted or unlinked ClickUp tasks receive an immediate second remote confirmation and are removed from the Gmail bar without waiting through two five-minute validation windows.
- The attachment selector can switch between compact rows and lazy image thumbnails without previewing documents or changing selection state.

### Security and privacy
- Gmail uploads require an allowlisted filename extension and MIME type, a recognized file signature or valid UTF-8 text, explicit user selection, and the existing per-file and per-action limits. SVG, macro-enabled Office formats, executables, and scripts remain excluded.

## [2.0.1] - 2026-08-23

### Added
- Visible feedback and repository links in the full application and minimal popup.
- Structured GitHub Issue forms for bug reports and feature proposals, with explicit guidance against sharing sensitive data publicly.

### Changed
- Spiritfox uses a light content surface, dark navigation, and the official brand lockup in both the full application and popup.
- GitHub README, contribution guidance, security policy, CI release validation, and wiki synchronization now reflect the current product and release process.

### Security and privacy
- GitHub private vulnerability reporting is enabled and linked from the extension, Issue forms, README, user guide, security policy, and wiki.
- Public Issue forms explicitly warn against attaching credentials, private URLs, Gmail or Meet content, account identifiers, or unreviewed diagnostics.

## [2.0.0-beta.1] - 2026-08-22

### Added
- Dual ClickUp authentication: validated personal tokens as the recommended setup and BYO OAuth as an advanced owner/admin option.
- Responsive full-tab application with dashboard, task search, agenda, tracking, connections, and settings surfaces.
- Read-only Google Calendar Agenda and Week views with seven-day range, overlapping-event layout, recurring occurrence/series mappings, and explicit ClickUp List destinations.
- Persistent Meet-to-task mapping management with task names, statuses, enable/disable, and delete actions.
- Configurable working days and daily hour targets with calculated weekly goals.
- Explicit Gmail image attachments for PNG, JPEG, GIF, and WebP with MIME/signature checks and bounded file/operation sizes.
- Gmail integration visibility preference mediated by the background service worker.

### Changed
- Replaced the toolbar workflow with a minimal launcher for the full application while retaining the setup surface.
- Compacted the Gmail task modal into a responsive two-column form.
- Aligned task descriptions with ClickUp Markdown: headings, emphasis, lists, links, quotes, and inline code; visual and Markdown views now round-trip edits.
- Enabled TypeScript unused-local and unused-parameter checks and removed confirmed dead declarations and modules.
- Production release packaging now includes the complete full-tab application and local fonts/assets.

### Security and privacy
- Personal tokens are validated before encrypted persistence, never drafted or echoed, and accepted only from trusted extension setup pages with an exact message schema.
- Successful authentication-method changes clear the previous OAuth/token boundary, authorization mode, account caches, and stale rate state; no credentials are hardcoded into the package.
- Gmail HTML sanitization now uses an explicit attribute allowlist and removes remote-loading attributes including `srcset` and `ping` plus embedded style elements.
- ClickUp API requests have a 30-second timeout and preserve caller cancellation.
- API and encryption-key initialization use single-flight promises to prevent concurrent startup races.
- Calendar actions refresh expired in-memory event details before creating/linking tasks or opening Meet.
- Popup task search ignores stale out-of-order responses.

### Validation
- Strict TypeScript compilation, full Jest suite, production/dev builds, exact release preflight, and blocked-file checks pass locally.
- The GitHub asset is an unsigned prerelease ZIP for unpacked installation. OAuth, Gmail, Calendar, Meet, and ClickUp writes with real accounts remain operator QA.

## [1.2.3] - 2026-08-13

### Changed
- Automatic tracking now represents a task work session: Gmail, Chatwoot, Inbox, documentation, and other non-task tabs no longer stop the running task.
- Opening another recognized ClickUp task still uses the serialized validate → stop → start transition when both automatic controls are enabled.
- With Auto-Stop enabled, closing the last direct or task-specific ClickUp Inbox tab for the running task stops it; duplicate tabs across windows preserve it.
- A confirmed Meet without a linked task stops the current timer and waits for a task selection; a Meet linked to the same or another task keeps or switches tracking accordingly.
- Logout attempts to stop a verifiable running timer before removing local authentication.

### Fixed
- Repeated Gmail scans now preserve unchanged linked-task anchor nodes instead of replacing `innerHTML`, keeping links stable under pointer hover and keyboard focus.
- Manual stop now stores a session-only task ID guard so focus/URL events cannot immediately restart the same task.
- Direct ClickUp task pages using `/t/{workspaceId}/{taskId}` now validate the task segment instead of incorrectly sending the Workspace ID as a Task ID; historical alphanumeric `/t/{taskId}` URLs remain supported.

### Added
- Opt-in Safe Diagnostics with a 200-event `chrome.storage.session` buffer, separate JSON export, clear control, and categorical instrumentation for auth mode, workspace selection, task validation, timer polling, and timer transitions.
- A bounded session-only task-tab index records only `tabId → taskId` pairs so tab closure can be evaluated without retaining URLs or Inbox payloads.

### Security and privacy
- Across v1.2.1–v1.2.3, the permission delta is limited to the exact `https://meet.google.com/*` host introduced for the opt-in Meet detector; no audio, video, microphone, camera, capture, participant, chat, captions, history, notification, or Calendar permission was added.
- The manual-stop guard is session-only and contains only a ClickUp task ID; it is cleared on extension/browser lifecycle boundaries.
- The task-tab index exists only while Auto-Stop is enabled, is restricted to trusted extension contexts, capped at 256 entries, and cleared when disabled or at logout, confirmed authentication invalidation, and clear-local-data boundaries.
- Safe Diagnostics is off by default, extension-page-only, and rejects tokens, headers, URLs, workspace/task IDs, names, emails, payloads, and Gmail/Meet content through closed field/value allowlists.

### Validation
- TypeScript typecheck, 26 Jest suites / 310 tests, release build, exact 18-file allowlist preflight, `git diff --check`, and structured Senior Developer/CISO/QA checklist pass locally.
- Direct ClickUp URLs, A→B switching, and last-task-tab stop passed operator QA. Logout/reconnection and Meet Priority remain `No verificado` after an explicit owner waiver; Chrome Web Store distribution requires a separate gate.

### Not included
- No Chrome Web Store publication, signing, Calendar integration, credential handling, or agent-run real-service QA is included in this source release.

## 1.2.2 - 2026-08-13

### Added
- Opt-in Google Meet Priority on the exact `https://meet.google.com/*` origin, off by default.
- Synthetic home/prejoin/join/left detection, popup task selection, previous-task reuse, ignore/change/end controls, and a four-hour confirmation pause.
- Local recurring room-to-task mappings using `SHA-256("cgc-meet-v1:" + roomCode)` instead of storing room codes, full URLs, titles, or meeting content.
- Mapping enable/delete controls and explicit deletion through the existing clear-local-data flow.

### Changed
- Confirmed Meet sessions temporarily suspend the normal focused-ClickUp coordinator; finishing stops the Meet timer and reevaluates focus without restoring an old task automatically.
- Gmail and modal reads now cross the origin-validated background message boundary so all host content scripts can be denied direct `chrome.storage.local` access.
- Minimum supported Chrome version is 102 and incognito use is explicitly disabled.
- OAuth API requests negotiate compatibility between the previously working raw token header and the documented `Bearer` scheme for safe reads only. A confirmed rejected token requires explicit reconnection instead of an unsupported refresh-token request.

### Fixed
- Fixed automatic time tracking silently treating a ClickUp `401` as an invalid task while the popup still appeared authenticated from cached user data.
- `getStatus` now validates the current user against ClickUp before showing an authenticated session; transient availability failures remain distinct from rejected credentials.
- Fixed automatic-tracking switches shrinking beside wrapped labels and placing the checked thumb outside its track.
- Reduced false ClickUp reconnections by negotiating raw/Bearer authorization only for safe reads, confirming `/user` before invalidation, caching recent validation, and ignoring stale failures from replaced tokens/wrappers.

### Security and privacy
- Meet messages use a closed schema containing only `event` and a 64-character room hash; task and mapping actions remain extension-page-only.
- No permissions or APIs for audio, video, microphone, camera, captions, chat, participants, desktop/tab capture, notifications, history, or Calendar were added.
- Meet mappings remain local, are excluded from the safe backup export, and use a pseudonymous stable hash rather than claiming anonymity.

### Validation
- TypeScript typecheck, 24 Jest suites / 273 tests, release build, and the exact 18-file allowlist preflight pass locally.
- Real Google Meet DOM behavior and real ClickUp writes remain pending operator-only manual QA before any distribution.

### Not included
- No Google Calendar OAuth/API, activity ledger, dashboard, publication, signing, commit, or push.

## 1.2.1 - 2026-08-12

### Fixed
- Automatic time tracking now follows only the active tab of the focused Chrome window, including multi-window and multi-monitor use.
- The general ClickUp Inbox and other focused Chrome tabs are treated as no-task views instead of reusing the last task.
- Task notification detail URLs resolve their task ID from the encoded Inbox bundle without persisting or logging the URL or payload.
- Timer transitions are serialized and debounced; switching tasks validates the destination and confirms focus before starting it.

### Changed
- Automatic timer authority moved from per-tab DOM clicking to the background service worker and official ClickUp API wrapper.
- Popup copy now explains focused-window behavior and recommends enabling both automatic controls.

### Not included
- No contextual activity ledger, idle permission, daily JSON export, new host permissions, or publication action.

## [1.2.0] - 2026-08-11

### Added
- Versioned safe export format (`schemaVersion: 2`) for email-task links and non-sensitive settings, including counts and optional SHA-256 checksum.
- Local release build and validation scripts using an explicit allowlist for runtime/static extension files.
- Popup author footer and manifest/package author metadata for Leandro Iramain.
- Durable OAuth setup window that remains open while switching between Chrome tabs.
- Safe pending state for Gmail messages whose thread metadata is not available yet.
- Sanitized synchronization progress in the popup UI and console for hierarchy and email-task scans.
- Bounded in-memory task-title search for “Adjuntar a existente”, with ID lookup, normalization and relevance filtering.
- User-scoped recent time entries with the active timer surfaced and refreshed while the popup is visible.
- Safe links from recent time-entry task titles to their ClickUp tasks.

### Changed
- Gmail link validation now uses a safer V2 state model with pending/unverified/candidate states, retries, and reduced accidental cleanup.
- Runtime message validation now checks sender origin, action allowlists, message shapes, and bounded payload sizes.
- Gmail HTML and high-risk popup/modal render sinks are sanitized or routed through safe URL/color helpers.
- Local logger defaults to production-safe behavior and avoids raw sensitive payload output.
- OAuth token handling uses Web Crypto helper routines to reduce accidental local exposure; this is not a guarantee against a compromised browser profile or device.
- Active popup, setup, Gmail bar, task modal, notifications and generated attachment copy are now displayed in Spanish.

### Fixed
- Restored legitimate `savePreferredTeam`, `getSpaces`, `searchTasks`, and legacy `createTimeEntry` message shapes after B2 hardening.
- Fixed OAuth configuration state so encrypted credentials remain recognized after reopening the popup, stale Client ID drafts cannot disable Sign In, and complete pending fields are saved before authentication.
- Fixed Gmail `NotFoundError` by mounting the ClickUp bar against the email body's direct parent instead of a distant ancestor.
- Prevented nested Gmail body candidates and repeated scans from creating duplicate bars.
- Fixed title searches returning unrelated workspace tasks when the team task endpoint ignored the supplied query.
- Prevented stale modal-search responses from replacing a newer query and aligned modal hierarchy loading with `preferredTeamId`.
- Fixed recent time history using an unsorted same-day response without an explicit current-user filter.
- Cleared and periodically revalidated cached user identity before privacy-sensitive time-history queries.

### Security
- Removed broad ClickUp wildcard host permission in favor of `https://app.clickup.com/*` plus ClickUp API access.
- Safe clear now requires a recent local export and exact confirmation, and does not remove OAuth credentials.
- Release preflight checks version coherence, manifest-referenced files, allowlist exactness, and blocked file patterns.
- Legacy shell packaging scripts are excluded from the supported v1.2.0 release directory.
- Original Gmail file attachments are disabled in v1.2.0; only sanitized email HTML attachment remains supported.

### Not included
- No local signing, import of real backups, OAuth/API live test, or credential handling in this release process.

## [1.1.4] - 2026-01-21

### Added
- **Multiple Thread IDs** - Attach multiple emails to the same task; Thread IDs are stored comma-separated in custom field

### Fixed
- **Date Timezone Bug** - Dates no longer show -1 day offset; fixed by using local time instead of UTC midnight

## [1.1.3] - 2026-01-20

### Improved
- **Task Search** - "Attach to Existing" search now prioritizes exact title matches and supports flexible multi-word queries
- **Email Sync** - Now scans ALL tasks in date range via pagination (fixes 100 task limit)
- **Validation** - Robust link verification on reload: validates Thread ID presence in Custom Field or Description. Automatically removes button if link is broken.

### Added
- **Status Selection** - Added "Status" dropdown in Create Task modal (dynamically populated from selected List)

### Fixed
- **Custom Field Logic** - "Attach to Existing" and Sync now correctly respect the "Use Custom Field" toggle
- **Sync Detection** - Fixed detection of Thread IDs in custom fields during sync
- **API Optimization** - Reduced invalid API calls by refining Task ID detection logic

## [1.1.2] - 2026-01-19

### Fixed
- **List Cache Status** - Now correctly displays sync status and list count after popup reopen
- **Hierarchy Resolver** - Fixed "Invalid workspace id: undefined" error in getHierarchy
- **Task Search** - Fixed searchTasks and getTaskById handlers reading parameters correctly
- **Email Sync Status** - Now persists foundCount so status survives popup close

### Improved
- **Fuzzy List Search** - Now supports word-based search in any order (e.g., "talleres soporte" finds "Soporte | Talleres")
- **Search Scoring** - Results sorted by relevance (exact match > name match > path match)
- **Cache Staleness** - Extended auto-refresh timeout from 5 minutes to 24 hours
- **Manual Sync Only** - Removed auto-preload on popup open; sync only via "Sync Lists" button

### Added
- Detailed progress logging during list and email task synchronization
- Console logs for each space synced with list counts

## [1.1.0] - 2026-01-18

### Fixed
- **Rich Text Editor** - Line breaks (`<br>`) now properly convert to newlines in task descriptions
- **Time Tracking** - "Track Time" field in task modal now correctly records time entries
- **Thread ID Storage** - Thread ID now saves to description when custom field is disabled
- **Auto-Start Timer** - Now works when opening tasks via direct URL (not just SPA navigation)
- **Recent Entries** - Now fetches last 7 days of time entries instead of stale cached data

### Added
- **Toggle Saved Feedback** - "✓ Saved" indicator when changing custom field toggle
- **Debug Logging** - Thread ID storage method logged for troubleshooting

### Security
- All OAuth tokens encrypted with AES-256-GCM
- Production-safe logger suppresses debug output

## [1.0.0] - 2026-01-15

### Added
- Initial release
- Create ClickUp tasks from Gmail emails
- Attach emails to existing tasks
- Rich text editor with markdown support
- Time tracking (start/stop timer, manual entry)
- Auto-tracking on ClickUp.com
- Task search and quick create
- Workspace hierarchy browser
- Email-task sync for migration
- Encrypted OAuth token storage
- CI/CD with GitHub Actions

---

[Unreleased]: https://github.com/Diramain/taskbridge-for-clickup/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/Diramain/taskbridge-for-clickup/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/Diramain/taskbridge-for-clickup/compare/v2.0.0-beta.1...v2.0.1
[2.0.0-beta.1]: https://github.com/Diramain/taskbridge-for-clickup/compare/v1.1.4...v2.0.0-beta.1
[1.2.3]: https://github.com/Diramain/taskbridge-for-clickup/compare/0c7313326f6bcdc0f6e61364c2b80d8b97af89dd...main
[1.2.0]: https://github.com/Diramain/taskbridge-for-clickup/commit/0c7313326f6bcdc0f6e61364c2b80d8b97af89dd
[1.1.4]: https://github.com/Diramain/taskbridge-for-clickup/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/Diramain/taskbridge-for-clickup/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/Diramain/taskbridge-for-clickup/compare/v1.1.0...v1.1.2
[1.1.0]: https://github.com/Diramain/taskbridge-for-clickup/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Diramain/taskbridge-for-clickup/releases/tag/v1.0.0
