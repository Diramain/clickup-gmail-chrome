# Security Documentation

## Token Encryption

The OAuth access token and OAuth client secret are encrypted at rest using **AES-256-GCM** via the Web Crypto API.

### How it works:
1. On first auth, a unique AES-256 encryption key is generated
2. The key is stored in `chrome.storage.local`
3. The OAuth access token is encrypted before storage
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

The OAuth client secret is stored locally after the user enters it during setup. In v2.0.0 it is encrypted locally with **AES-256-GCM** through `saveSecureOAuthConfig` before storage in `chrome.storage.local`.

This is best-effort at-rest protection: the encryption key is stored in the same browser profile, so it does not protect against a compromised host or compromised browser profile. The client secret is decrypted only when needed for OAuth or token exchange with ClickUp.

For broad distribution or higher-risk deployments, a backend OAuth proxy remains recommended so the client secret does not need to live in the browser extension profile.

## Reauthentication on `401`

ClickUp's documented OAuth token endpoint exchanges `client_id`, `client_secret`, and an authorization `code` for an access token; it does not document a refresh-token grant. Runtime requests therefore do not attempt synthetic refresh requests. Because previous extension versions successfully used the raw access token while current ClickUp documentation specifies `Bearer`, safe GET requests can try the alternate header once. Non-idempotent writes are never replayed automatically. When a request returns `401`, the extension:

1. confirms the current token against `/user` before treating endpoint-specific denial as a lost session;
2. removes the rejected token and caches only when `/user` rejects both supported header shapes and that exact token is still current;
3. ignores late failures from replaced tokens/wrappers and serializes auth-state changes;
4. preserves the encrypted OAuth app configuration, pauses automatic tracking authority, and shows an explicit reconnection path.

Transient network/upstream errors and endpoint-specific `401` responses with a valid `/user` probe do not clear the session or ask the user to replace OAuth configuration. A user validated during the last five minutes may be reused locally when opening the popup.

## Safe Diagnostics Boundary

Safe Diagnostics is off by default and intended for operator-led troubleshooting. It keeps at most 200 events in `chrome.storage.session`, explicitly restricted to `TRUSTED_CONTEXTS`. The state is in memory for the current browser/extension session and can be disabled, exported, or cleared from the popup.

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
- `chrome.storage.local` is restricted to `TRUSTED_CONTEXTS`; Gmail, ClickUp, and Meet content scripts use narrow background messages instead of direct reads.
- Incognito is disabled. Chrome 102 or newer is required for the local-storage access boundary.
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
