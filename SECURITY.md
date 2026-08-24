# TaskBridge for ClickUp Security

## Supported Versions

Security fixes are applied to the current `2.1.x` line. Older GitHub releases and unpacked builds should be upgraded before reporting behavior that may already have been corrected.

## Reporting a Vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/Diramain/taskbridge-for-clickup/security/advisories/new) for suspected security issues. Do not disclose vulnerabilities, credentials, emails, ClickUp IDs, private URLs, Gmail or Meet content, or personal data in a public Issue.

Public GitHub Issues are reserved for ordinary bug reports and feature proposals. Review every diagnostic export or screenshot before attaching it, even when TaskBridge generated it through Safe Diagnostics.

## Token Encryption

The personal token, OAuth access token, and OAuth client secret are encrypted at rest using **AES-256-GCM** via the Web Crypto API.

### How it works:
1. On first auth, a unique AES-256 encryption key is generated
2. The key is stored in trusted local persistence: restricted `chrome.storage.local` on Chrome and extension-origin IndexedDB on Firefox
3. The selected ClickUp credential is validated before it replaces the current connection and is encrypted before storage
4. Legacy plain-text tokens are automatically migrated to encrypted format; obsolete refresh-token values are removed

### Files:
- `src/services/crypto.service.ts` - Encryption/decryption functions

---

## Client Secret Handling

> ⚠️ **Important**: ClickUp's OAuth API requires a `client_secret` for token exchange.

Since browser extensions cannot truly hide secrets in client-side code, we recommend:

1. **Keep your OAuth app private** - Don't share the client ID/secret
2. **Create a new OAuth app** if you suspect compromise
3. **Consider a backend proxy** for production apps with many users

The OAuth client secret is stored locally after the user enters it during setup. In v2.1.0 it is encrypted locally with **AES-256-GCM** through `saveSecureOAuthConfig` before trusted local persistence.

This is best-effort at-rest protection: the encryption key is stored in the same browser profile, so it does not protect against a compromised host or compromised browser profile. The client secret is decrypted only when needed for OAuth or token exchange with ClickUp.

For broad distribution or higher-risk deployments, a backend OAuth proxy remains recommended so the client secret does not need to live in the browser extension profile.

## Personal Token Handling

ClickUp documents personal tokens for individual and testing use. TaskBridge accepts only a bounded `pk_` token shape from the trusted setup pages, validates it against ClickUp's `/user` endpoint before persistence, and never writes it to a draft, URL, log, diagnostic event, export, or visible status string.

Each user must use their own token. Personal tokens are long-lived and carry the ClickUp access of their owner, so they must not be shared as an organization-wide credential. Switching successfully to a personal token deletes the previous OAuth configuration and account-derived caches; switching successfully to OAuth replaces the token and records the OAuth authorization mode.

## Reauthentication on `401`

ClickUp's documented OAuth token endpoint exchanges `client_id`, `client_secret`, and an authorization `code` for an access token; it does not document a refresh-token grant. Runtime requests therefore do not attempt synthetic refresh requests. Because previous extension versions successfully used the raw access token while current ClickUp documentation specifies `Bearer`, safe GET requests can try the alternate header once. Non-idempotent writes are never replayed automatically. When a request returns `401`, the extension:

1. confirms the current token against `/user` before treating endpoint-specific denial as a lost session;
2. removes the rejected token and caches only when `/user` rejects both supported header shapes and that exact token is still current;
3. ignores late failures from replaced tokens/wrappers and serializes auth-state changes;
4. preserves the selected authentication method, preserves encrypted OAuth app configuration only for OAuth reconnection, pauses automatic tracking authority, and shows the correct token-replacement or OAuth-reconnection path.

Transient network/upstream errors and endpoint-specific `401` responses with a valid `/user` probe do not clear the session or ask the user to replace OAuth configuration. A user validated during the last five minutes may be reused locally when opening the popup.

## Safe Diagnostics Boundary

Safe Diagnostics is off by default and intended for operator-led troubleshooting. It keeps at most 200 events in browser session storage: Chrome explicitly applies `TRUSTED_CONTEXTS`, while Firefox session storage is trusted-context-only by default. The state is in memory for the current browser/extension session and can be disabled, exported, or cleared from the popup.

- Event names, fields, and string values use closed allowlists. Unknown fields and values are discarded before storage and sanitized again when restoring a session buffer.
- Permitted data is limited to timestamps, sequence numbers, bounded counts, categorical request routes/methods/auth modes/results, and allowlisted ClickUp workspace-authorization codes.
- Tokens, headers, URLs, workspace/task IDs, names, emails, API payloads, and Gmail/Meet content are never accepted into the buffer.
- Diagnostic runtime actions are extension-page-only, sender/origin checked, and schema validated. Gmail, ClickUp, and Meet content scripts cannot enable, read, export, or clear the buffer.
- Diagnostics does not alter request retry policy. Safe reads may retain the existing single raw/Bearer compatibility fallback; writes are never replayed automatically.

Residual risk remains: timestamps and technical state transitions can reveal when an operator used the extension, and any exported JSON becomes an ordinary user-managed file. Review the export before sharing it and clear the session log when troubleshooting is complete.

---

## Google Meet Priority Boundary

Meet Priority is off by default and restricted to `https://meet.google.com/*`. It uses a minimal Leave Call DOM signal and sends only an allowlisted event plus `SHA-256("cgc-meet-v1:" + roomCode)` to the background worker.

- No raw room code, full URL, title, Calendar data, participant data, chat, captions, audio, video, camera, microphone, screenshots, or transcripts are persisted or sent through the Meet message channel.
- Meet cannot invoke ClickUp timer or mapping actions directly; those actions are extension-page-only and schema validated.
- Room mappings store only the room hash, task/workspace IDs, timestamps, and enabled state. The stable hash is pseudonymous and remains sensitive local metadata.
- Chrome restricts `chrome.storage.local` to `TRUSTED_CONTEXTS`. Firefox stores durable application state in extension-origin IndexedDB because Firefox does not implement `StorageArea.setAccessLevel`; the injected storage facade denies all host content-script access.
- Gmail, ClickUp, and Meet content scripts use narrow background messages instead of direct storage reads. Incognito is disabled.
- Timer writes are serialized. A destination task is validated before stopping, the same Meet tab/room is rechecked before starting, and a failed session-state write attempts to stop a newly started timer.

Residual risk remains: Google Meet DOM labels can change, a compromised browser profile can access extension state, and a stable room hash can correlate repeat sessions. Real Meet detection and logout/reconnection remain `No verificado` after an explicit owner waiver; a source push does not certify those flows, and Chrome Web Store distribution requires a separate reviewed gate.

---

## HTML Sanitization

Dynamic HTML content is sanitized to prevent XSS attacks.

### Files:
- `src/utils/sanitize.utils.ts` - Sanitization functions

### Usage:
```typescript
import { sanitizeHTML, escapeHTML, setTextContent } from './utils/sanitize.utils';

// For dynamic HTML that needs structure
element.innerHTML = sanitizeHTML(userProvidedHTML);

// For plain text (preferred)
setTextContent(element, userProvidedText);

// For HTML strings
const safe = escapeHTML(userInput);
```
