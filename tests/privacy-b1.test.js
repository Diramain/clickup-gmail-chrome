const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { webcrypto } = require('crypto');
const { TextEncoder, TextDecoder } = require('util');
const { mockStorage } = require('./setup');

Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
});
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(source(relativePath), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;

    const module = { exports: {} };
    new Function('require', 'module', 'exports', `const crypto = globalThis.crypto;\n${compiled}`)(require, module, module.exports);
    return module.exports;
}

describe('B1 privacy hardening', () => {
    test('Logger is release-safe by default and sanitizes sensitive errors', () => {
        const { Logger } = loadTsModule('src/logger.ts');

        expect(Logger.PRODUCTION).toBe(true);
        expect(Logger.DEBUG).toBe(false);
        expect(Logger.sanitizeError(new Error('token exchange failed 401 with secret'))).toBe('auth_error');
        expect(Logger.sanitizeError(new Error('network fetch failed'))).toBe('network_error');
    });

    test('popup has no full-storage debug route and does not persist draft client secret', () => {
        const popup = source('popup/popup.ts');

        expect(popup).not.toMatch(/chrome\.storage\.local\.get\(null\)/);
        expect(popup).not.toMatch(/FULL STORAGE|Full storage|storageStr/);
        expect(popup).not.toMatch(/set\(\{\s*draftClientSecret/);
        expect(popup).toMatch(/remove\('draftClientSecret'\)/);
    });

    test('background uses secure token helpers and does not write OAuth tokens as plain storage values', () => {
        const background = source('background.ts');

        expect(background).toMatch(/saveSecureToken\(STORAGE_KEYS\.AUTH_TOKEN/);
        expect(background).toMatch(/removeSecureToken\(STORAGE_KEYS\.REFRESH_TOKEN/);
        expect(background).not.toMatch(/saveSecureToken\(STORAGE_KEYS\.REFRESH_TOKEN/);
        expect(background).toMatch(/getSecureToken\(STORAGE_KEYS\.AUTH_TOKEN/);
        expect(background).not.toMatch(/chrome\.storage\.local\.set\(\{\s*\[STORAGE_KEYS\.AUTH_TOKEN\]/);
        expect(background).not.toMatch(/response\.text\(\)/);
        expect(background).not.toMatch(/message\.data\s*\|\|/);
        expect(background).not.toMatch(/Sending response/);
    });

    test('secure token helper migrates plain legacy token to encrypted storage using chrome mock', async () => {
        const cryptoService = loadTsModule('src/services/crypto.service.ts');
        await chrome.storage.local.set({ clickupToken: 'legacy-token' });

        const token = await cryptoService.getSecureToken('clickupToken');
        const stored = await chrome.storage.local.get('clickupToken');

        expect(token).toBe('legacy-token');
        expect(typeof stored.clickupToken).toBe('object');
        expect(stored.clickupToken).toHaveProperty('iv');
        expect(stored.clickupToken).toHaveProperty('data');
        expect(JSON.stringify(stored.clickupToken)).not.toContain('legacy-token');
    });

    test('draft OAuth secret cleanup removes draft keys without reading values', async () => {
        await chrome.storage.local.set({ draftClientId: 'id', draftClientSecret: 'secret' });
        await chrome.storage.local.remove(['draftClientId', 'draftClientSecret']);
        const result = await chrome.storage.local.get(['draftClientId', 'draftClientSecret']);

        expect(result.draftClientId).toBeUndefined();
        expect(result.draftClientSecret).toBeUndefined();
    });

    test('privacy policy matches v1.2.3 local data, work-session tracking, Meet minimization, export, and retention claims', () => {
        const policy = source('PRIVACY_POLICY.md');

        expect(policy).toContain('**Last Updated:** 2026-08-22');
        expect(policy).toMatch(/reads Gmail data only when you initiate a create or attach action/i);
        expect(policy).toMatch(/subject[\s\S]*sender[\s\S]*Gmail thread ID[\s\S]*Gmail URL/i);
        expect(policy).toMatch(/sanitized HTML representation of the email as a ClickUp task attachment/i);
        expect(policy).toMatch(/checkbox is enabled by default/i);
        expect(policy).toMatch(/explicitly select image attachments/i);
        expect(policy).toMatch(/PNG, JPEG, GIF, and WebP[\s\S]*SVG is excluded/i);
        expect(policy).toMatch(/10 MiB per file and 20 MiB per action/i);
        expect(policy).toMatch(/background service worker does not fetch Gmail attachments/i);
        expect(policy).toMatch(/Attachment URLs and bytes are not persisted or logged/i);
        expect(policy).toMatch(/Gmail, Chatwoot, Inbox, or another non-task page does not by itself stop that timer/i);
        expect(policy).toMatch(/closing the last direct or task-specific ClickUp Inbox tab for the running task stops that timer/i);
        expect(policy).toMatch(/bounded in-memory browser-session index stores only `tabId → taskId` pairs/i);
        expect(policy).toMatch(/index is cleared when Auto-Stop is disabled/i);
        expect(policy).toMatch(/does not store full ClickUp URLs, external browsing URLs, query strings, fragments, or encoded notification payloads/i);
        expect(policy).toMatch(/manual stop suppression/i);
        expect(policy).toMatch(/does not operate its own servers or analytics service/i);
        expect(policy).toMatch(/email body is not retained as a local mapping/i);
        expect(policy).toMatch(/Mappings persist until you delete them, clear local data, or uninstall the extension/i);
        expect(policy).toMatch(/safe export[\s\S]*does not include OAuth tokens, OAuth client configuration, or email HTML/i);
        expect(policy).toMatch(/does not rely on an undocumented refresh-token grant/i);
        expect(policy).toMatch(/off by default[\s\S]*SHA-256\(\"cgc-meet-v1:/i);
        expect(policy).toMatch(/does not access or capture audio, microphone, video, camera, chat, captions/i);
        expect(policy).toMatch(/stable room hash is pseudonymous metadata, not anonymous data/i);
        expect(policy).toMatch(/excludes Meet room keys and Meet task mappings/i);
        expect(policy).toMatch(/Gmail content script reads only the versioned Gmail-controls preference directly/i);
        expect(policy).toMatch(/not allowed to run in incognito mode/i);
        expect(policy).toMatch(/clear local data[\s\S]*does not delete or modify data already sent to ClickUp/i);
        expect(policy).toMatch(/Safe Diagnostics is off by default/i);
        expect(policy).toMatch(/up to 200 allowlisted technical events/i);
        expect(policy).toMatch(/`chrome\.storage\.session` with access restricted to trusted extension contexts/i);
        expect(policy).toMatch(/do not include tokens, authorization headers, URLs, workspace or task IDs, names, email addresses, API payloads, or Gmail\/Meet content/i);
        expect(policy).toMatch(/separate export control/i);
        expect(policy).toContain('https://leandroiramain.com.ar');
        expect(policy).not.toMatch(/automatic 90[- ]day purge|purged? automatically after 90 days/i);
    });

    test('security docs describe client secret best-effort local encryption without unsafe obsolete claim', () => {
        const security = source('SECURITY.md');

        expect(security).toMatch(/encrypted locally with \*\*AES-256-GCM\*\* through `saveSecureOAuthConfig`/);
        expect(security).toMatch(/best-effort at-rest protection/i);
        expect(security).toMatch(/key is stored in the same browser profile/i);
        expect(security).toMatch(/does not protect against a compromised host or compromised browser profile/i);
        expect(security).toMatch(/decrypted only when needed for OAuth or token exchange with ClickUp/i);
        expect(security).toMatch(/backend OAuth proxy remains recommended/i);
        expect(security).toMatch(/Google Meet Priority Boundary/);
        expect(security).toMatch(/Safe Diagnostics Boundary/);
        expect(security).toMatch(/at most 200 events in `chrome\.storage\.session`/i);
        expect(security).toMatch(/Diagnostic runtime actions are extension-page-only/i);
        expect(security).toMatch(/writes are never replayed automatically/i);
        expect(security).toMatch(/`TRUSTED_CONTEXTS`/);
        expect(security).not.toMatch(/client secret is NOT encrypted/i);
    });

    test('storage service does not define automatic 90-day mapping retention or destructive cleanup', () => {
        const storage = source('src/services/storage.service.ts');

        expect(storage).not.toMatch(/EMAIL_TASKS_MAX_AGE_DAYS|90\s*days|auto(?:matic)?\s+.*90/i);
        expect(storage).toMatch(/Link cleanup is report-only for schema v2/);
        expect(storage).toMatch(/no automatic purge performed/);
        expect(storage).not.toMatch(/Date\.now\(\) - .*EMAIL_TASKS_MAX_AGE_DAYS|filter\([^)]*updatedAt/);
    });
});
