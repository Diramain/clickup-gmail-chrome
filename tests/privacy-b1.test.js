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
        expect(background).toMatch(/saveSecureToken\(STORAGE_KEYS\.REFRESH_TOKEN/);
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

    test('privacy policy matches v1.2.0 local data, transfer, export, and retention claims', () => {
        const policy = source('PRIVACY_POLICY.md');

        expect(policy).toContain('**Last Updated:** 2026-08-11');
        expect(policy).toMatch(/reads Gmail data only when you initiate a create or attach action/i);
        expect(policy).toMatch(/subject[\s\S]*sender[\s\S]*Gmail thread ID[\s\S]*Gmail URL/i);
        expect(policy).toMatch(/sanitized HTML representation of the email as a ClickUp task attachment/i);
        expect(policy).toMatch(/checkbox is enabled by default/i);
        expect(policy).toMatch(/Original Gmail file attachments are disabled/i);
        expect(policy).toMatch(/does not operate its own servers or analytics service/i);
        expect(policy).toMatch(/email body is not retained as a local mapping/i);
        expect(policy).toMatch(/Mappings persist until you clear local data or uninstall the extension/i);
        expect(policy).toMatch(/safe export[\s\S]*does not include OAuth tokens, OAuth client configuration, or email HTML/i);
        expect(policy).toMatch(/clear local data[\s\S]*does not delete or modify data already sent to ClickUp/i);
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
