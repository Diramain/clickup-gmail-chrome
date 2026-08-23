const fs = require('fs');
const path = require('path');
const ts = require('typescript');

global.TextDecoder ??= require('util').TextDecoder;

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

describe('Gmail attachment security boundary', () => {
    const security = loadModule('src/gmail-attachment-security.ts');

    test('accepts only exact HTTPS mail.google.com attachment URLs', () => {
        expect(security.isAllowedGmailAttachmentUrl('https://mail.google.com/mail/u/0/?att=1')).toBe(true);
        expect(security.isAllowedGmailAttachmentUrl('http://mail.google.com/mail/u/0/?att=1')).toBe(false);
        expect(security.isAllowedGmailAttachmentUrl('https://mail.google.com.evil.test/file')).toBe(false);
        expect(security.isAllowedGmailAttachmentUrl('https://evil.test/?next=https://mail.google.com/')).toBe(false);
    });

    test('allows only the exact Gmail attachment delivery host after redirects', () => {
        expect(security.isAllowedGmailAttachmentResponseUrl('https://mail.google.com/mail/u/0/?att=1')).toBe(true);
        expect(security.isAllowedGmailAttachmentResponseUrl('https://mail-attachment.googleusercontent.com/attachment/u/0/?att=1')).toBe(true);
        expect(security.isAllowedGmailAttachmentResponseUrl('https://ci3.googleusercontent.com/proxy/image')).toBe(true);
        expect(security.isAllowedGmailAttachmentResponseUrl('https://lh3.googleusercontent.com/image')).toBe(false);
        expect(security.isAllowedGmailAttachmentResponseUrl('https://mail-attachment.googleusercontent.com.evil.test/file')).toBe(false);
        expect(security.isAllowedGmailAttachmentUrl('https://mail-attachment.googleusercontent.com/attachment/u/0/?att=1')).toBe(false);
        expect(security.isAllowedGmailAttachmentResponseSource('', 'basic')).toBe(true);
        expect(security.isAllowedGmailAttachmentResponseSource('', 'default')).toBe(true);
        expect(security.isAllowedGmailAttachmentResponseSource('', 'opaque')).toBe(false);
    });

    test('allows bounded document and archive types while excluding active formats', () => {
        expect(security.isAllowedGmailAttachmentType('photo.png', 'image/png')).toBe(true);
        expect(security.isAllowedGmailAttachmentType('report.pdf', 'application/pdf')).toBe(true);
        expect(security.isAllowedGmailAttachmentType('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
        expect(security.isAllowedGmailAttachmentType('files.zip', 'application/x-zip-compressed')).toBe(true);
        expect(security.isAllowedGmailAttachmentType('files.rar', 'application/vnd.rar')).toBe(true);
        expect(security.isAllowedGmailAttachmentType('payload.exe', 'application/octet-stream')).toBe(false);
        expect(security.isAllowedGmailAttachmentType('macro.docm', 'application/vnd.ms-word.document.macroEnabled.12')).toBe(false);
        expect(security.isAllowedGmailAttachmentType('image.svg', 'image/svg+xml')).toBe(false);
        expect(security.sanitizeGmailAttachmentFilename('diagram.svg')).toBeNull();
        expect(security.sanitizeGmailAttachmentFilename('photo.png')).toBe('photo.png');
    });

    test('validates declared size, base64 length, and file signatures', () => {
        const valid = { taskId: 'task-1', filename: 'image.png', mimeType: 'image/png', byteLength: 8, base64: 'iVBORw0KGgo=' };
        expect(security.isValidGmailAttachmentUploadPayload(valid)).toBe(true);
        expect(Array.from(security.decodeAndValidateGmailAttachment(valid))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(security.decodeAndValidateGmailAttachment({ ...valid, filename: 'image.jpg', mimeType: 'image/jpeg' })).toBeNull();
        expect(security.isValidGmailAttachmentUploadPayload({ ...valid, byteLength: security.GMAIL_ATTACHMENT_MAX_FILE_BYTES + 1 })).toBe(false);
    });

    test('accepts real PDF, ZIP, RAR, and UTF-8 text signatures', () => {
        const fixtures = [
            { taskId: 'task-1', filename: 'report.pdf', mimeType: 'application/pdf', byteLength: 5, base64: 'JVBERi0=' },
            { taskId: 'task-1', filename: 'archive.zip', mimeType: 'application/zip', byteLength: 4, base64: 'UEsDBA==' },
            { taskId: 'task-1', filename: 'archive.rar', mimeType: 'application/vnd.rar', byteLength: 7, base64: 'UmFyIRoHAA==' },
            { taskId: 'task-1', filename: 'notes.txt', mimeType: 'text/plain', byteLength: 5, base64: 'aGVsbG8=' },
        ];
        fixtures.forEach(fixture => expect(security.decodeAndValidateGmailAttachment(fixture)).not.toBeNull());
        expect(security.decodeAndValidateGmailAttachment({ ...fixtures[0], base64: 'aGVsbG8=' })).toBeNull();
    });

    test('keeps the conservative aggregate limit at 20 MiB', () => {
        expect(security.GMAIL_ATTACHMENT_MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
        expect(security.GMAIL_ATTACHMENT_MAX_TOTAL_BYTES).toBe(20 * 1024 * 1024);
    });

    test('accepts only constrained Gmail-hosted inline image candidates', () => {
        const inline = {
            url: 'https://mail.google.com/mail/u/0/?view=fimg&attid=1',
            filename: 'imagen-en-el-cuerpo-1',
            mimeType: security.GMAIL_INLINE_IMAGE_MIME_TYPE,
            inline: true,
        };
        expect(security.isAllowedGmailInlineImageCandidate(inline)).toBe(true);
        expect(security.isAllowedGmailInlineImageCandidate({ ...inline, url: 'https://example.test/image.jpg' })).toBe(false);
        expect(security.isAllowedGmailInlineImageCandidate({ ...inline, filename: 'invoice.pdf' })).toBe(false);
        expect(security.getGmailImageExtension('image/jpeg')).toBe('jpg');
        expect(security.getGmailImageExtension('image/svg+xml')).toBeNull();
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
