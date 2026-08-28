const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(source(relativePath), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    const localRequire = (request) => {
        if (request.startsWith('.')) {
            const resolved = path.normalize(path.join(path.dirname(relativePath), request)) + '.ts';
            return loadTsModule(resolved);
        }
        return require(request);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

function sectionBetween(text, start, end) {
    const startIndex = text.indexOf(start);
    const endIndex = text.indexOf(end, startIndex + start.length);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    return text.slice(startIndex, endIndex);
}

describe('personal token authentication', () => {
    const validToken = `pk_${'A1_-'.repeat(8)}`;

    test('normalizes only bounded ClickUp personal tokens', () => {
        const { normalizePersonalToken, resolveClickUpAuthMethod } = loadTsModule('src/clickup-auth.ts');

        expect(normalizePersonalToken(validToken)).toBe(validToken);
        expect(normalizePersonalToken(`  Bearer ${validToken}  `)).toBe(validToken);
        expect(normalizePersonalToken('pk_short')).toBeNull();
        expect(normalizePersonalToken(`pk_${'a'.repeat(20)} secret`)).toBeNull();
        expect(normalizePersonalToken(`oauth_${'a'.repeat(30)}`)).toBeNull();
        expect(resolveClickUpAuthMethod('personal-token', true)).toBe('personal-token');
        expect(resolveClickUpAuthMethod(undefined, true)).toBe('personal-token');
        expect(resolveClickUpAuthMethod(undefined, false)).toBeUndefined();
    });

    test('accepts token mutations only from trusted setup pages with an exact schema', () => {
        const { validateExtensionMessage } = loadTsModule('src/message-security.ts');
        const runtimeId = 'ext-id';
        const message = { action: 'authenticatePersonalToken', data: { token: validToken } };

        expect(validateExtensionMessage(message, { id: runtimeId, url: 'chrome-extension://ext-id/popup/popup.html?mode=setup' }, runtimeId).ok).toBe(true);
        expect(validateExtensionMessage(message, { id: runtimeId, url: 'chrome-extension://ext-id/app/app.html' }, runtimeId).ok).toBe(true);
        expect(validateExtensionMessage(message, { id: runtimeId, url: 'chrome-extension://ext-id/task-modal.html' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_ORIGIN' });
        expect(validateExtensionMessage(message, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_ORIGIN' });
        expect(validateExtensionMessage({ ...message, data: { token: validToken, persist: true } }, { id: runtimeId, url: 'chrome-extension://ext-id/app/app.html' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
    });

    test('validates before encrypted persistence and clears the previous account boundary', () => {
        const background = source('background.ts');
        const handler = sectionBetween(background, "case 'authenticatePersonalToken':", "case 'logout':");

        expect(handler.indexOf('candidateApi.getUser()')).toBeLessThan(handler.indexOf('runAuthenticationStateMutation'));
        expect(handler.indexOf('candidateApi.getUser()')).toBeLessThan(handler.indexOf('saveSecureToken(STORAGE_KEYS.AUTH_TOKEN, token)'));
        expect(handler).not.toMatch(/chrome\.storage\.local\.set\(\{\s*\[STORAGE_KEYS\.AUTH_TOKEN\]/);
        expect(handler).toContain("[STORAGE_KEYS.AUTH_METHOD]: 'personal-token'");
        expect(handler).toContain("[STORAGE_KEYS.AUTHORIZATION_MODE]: 'raw'");
        expect(handler).toContain('STORAGE_KEYS.OAUTH_CONFIG');
        expect(handler).toContain('STORAGE_KEYS.CACHED_HIERARCHY');
        expect(handler).toContain('STORAGE_KEYS.RATE_GOVERNOR_STATE');
    });

    test('setup UI exposes only a non-drafted personal token', () => {
        for (const relativePath of ['popup/popup.html', 'app/app.html']) {
            const html = source(relativePath);
            expect(html).toMatch(/<input(?=[^>]*id="personalToken")(?=[^>]*type="password")[^>]*>/);
            expect(html).toMatch(/<input(?=[^>]*id="personalToken")(?=[^>]*autocomplete="new-password")[^>]*>/);
            expect(html).toContain('id="connectPersonalToken"');
            expect(html).not.toMatch(/clientSecret|clientId|auth-advanced-card/);
        }

        const popup = source('popup/popup.ts');
        expect(popup).not.toMatch(/storage\.local\.set\([^)]*personalToken/s);
        expect(popup).toContain("action: 'authenticatePersonalToken'");
        expect(popup).toContain("personalTokenInput.value = ''");
        expect(popup).not.toMatch(/saveOAuthConfig|action:\s*['"]authenticate['"]/);
    });
});
