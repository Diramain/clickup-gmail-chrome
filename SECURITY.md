# Security Documentation

## Token Encryption

All OAuth tokens are encrypted at rest using **AES-256-GCM** via the Web Crypto API.

### How it works:
1. On first auth, a unique AES-256 encryption key is generated
2. The key is stored in `chrome.storage.local`
3. Access tokens and refresh tokens are encrypted before storage
4. Legacy plain-text tokens are automatically migrated to encrypted format

### Files:
- `src/services/crypto.service.ts` - Encryption/decryption functions

---

## Client Secret Handling

> ⚠️ **Important**: ClickUp's OAuth API requires a `client_secret` for token exchange.

Since browser extensions cannot truly hide secrets in client-side code, we recommend:

1. **Keep your OAuth app private** - Don't share the client ID/secret
2. **Create a new OAuth app** if you suspect compromise
3. **Consider a backend proxy** for production apps with many users

The client secret is stored in `chrome.storage.local` after the user enters it during setup. It is NOT encrypted because it must be sent to ClickUp's API.

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
