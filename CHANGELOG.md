# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.2]: https://github.com/Diramain/clickup-gmail-chrome/compare/v1.1.0...v1.1.2
[1.1.0]: https://github.com/Diramain/clickup-gmail-chrome/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Diramain/clickup-gmail-chrome/releases/tag/v1.0.0
