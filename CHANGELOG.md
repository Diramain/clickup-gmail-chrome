# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.2.0]: https://github.com/Diramain/clickup-gmail-chrome/compare/v1.1.4...main
[1.1.4]: https://github.com/Diramain/clickup-gmail-chrome/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/Diramain/clickup-gmail-chrome/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/Diramain/clickup-gmail-chrome/compare/v1.1.0...v1.1.2
[1.1.0]: https://github.com/Diramain/clickup-gmail-chrome/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Diramain/clickup-gmail-chrome/releases/tag/v1.0.0
