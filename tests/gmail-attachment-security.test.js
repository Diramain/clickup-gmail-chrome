const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

describe('Gmail image attachment security boundary', () => {
    const security = loadModule('src/gmail-attachment-security.ts');

    test('accepts only exact HTTPS mail.google.com attachment URLs', () => {
        expect(security.isAllowedGmailAttachmentUrl('https://mail.google.com/mail/u/0/?att=1')).toBe(true);
        expect(security.isAllowedGmailAttachmentUrl('http://mail.google.com/mail/u/0/?att=1')).toBe(false);
        expect(security.isAllowedGmailAttachmentUrl('https://mail.google.com.evil.test/file')).toBe(false);
        expect(security.isAllowedGmailAttachmentUrl('https://evil.test/?next=https://mail.google.com/')).toBe(false);
    });

    test('allows PNG/JPEG/GIF/WebP, excludes SVG, and rejects SVG filenames', () => {
        ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].forEach(type => expect(security.isAllowedGmailImageMimeType(type)).toBe(true));
        expect(security.isAllowedGmailImageMimeType('image/svg+xml')).toBe(false);
        expect(security.sanitizeGmailAttachmentFilename('diagram.svg')).toBeNull();
        expect(security.sanitizeGmailAttachmentFilename('photo.png')).toBe('photo.png');
    });

    test('validates declared size, base64 length, and image magic bytes', () => {
        const valid = { taskId: 'task-1', filename: 'image.png', mimeType: 'image/png', byteLength: 8, base64: 'iVBORw0KGgo=' };
        expect(security.isValidGmailImageUploadPayload(valid)).toBe(true);
        expect(Array.from(security.decodeAndValidateGmailImage(valid))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(security.decodeAndValidateGmailImage({ ...valid, mimeType: 'image/jpeg' })).toBeNull();
        expect(security.isValidGmailImageUploadPayload({ ...valid, byteLength: security.GMAIL_ATTACHMENT_MAX_FILE_BYTES + 1 })).toBe(false);
    });

    test('keeps the conservative aggregate limit at 20 MiB', () => {
        expect(security.GMAIL_ATTACHMENT_MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
        expect(security.GMAIL_ATTACHMENT_MAX_TOTAL_BYTES).toBe(20 * 1024 * 1024);
    });
});

describe('versioned Gmail integration preference', () => {
    const preferences = loadModule('src/gmail-preferences.ts');

    test('defaults safely to enabled and accepts only the current boolean schema', () => {
        expect(preferences.GMAIL_INTEGRATION_PREFERENCE_KEY).toBe('cgcGmailIntegrationV1');
        expect(preferences.normalizeGmailIntegrationPreference(undefined)).toEqual({ version: 1, enabled: true });
        expect(preferences.normalizeGmailIntegrationPreference({ version: 1, enabled: false })).toEqual({ version: 1, enabled: false });
        expect(preferences.normalizeGmailIntegrationPreference({ version: 2, enabled: false })).toEqual({ version: 1, enabled: true });
        expect(preferences.normalizeGmailIntegrationPreference({ version: 1, enabled: 'false' })).toEqual({ version: 1, enabled: true });
    });
});
