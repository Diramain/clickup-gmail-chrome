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

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', `const crypto = globalThis.crypto;\n${compiled}`)(require, module, module.exports);
    return module.exports;
}

const { evaluateOAuthConfigState, resolveInitialOAuthDraft, shouldApplyInitialOAuthDraft } = loadTsModule('src/oauth-config-state.ts');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function sectionBetween(text, start, end) {
    const startIndex = text.indexOf(start);
    const endIndex = text.indexOf(end, startIndex + start.length);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    return text.slice(startIndex, endIndex);
}

function hasSecureOAuthConfigShape(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        typeof value.clientId === 'string' &&
        value.clientId.trim().length > 0 &&
        value.version === 1 &&
        value.encryptedSecret &&
        typeof value.encryptedSecret === 'object' &&
        typeof value.encryptedSecret.iv === 'string' &&
        value.encryptedSecret.iv.trim().length > 0 &&
        typeof value.encryptedSecret.data === 'string' &&
        value.encryptedSecret.data.trim().length > 0 &&
        value.encryptedSecret.version === 1
    );
}

describe('OAuth encrypted config shape', () => {
    test('accepts supported encrypted config without decrypting', () => {
        expect(hasSecureOAuthConfigShape({
            clientId: 'fake-client-id',
            encryptedSecret: { iv: 'fake-iv', data: 'fake-ciphertext', version: 1 },
            version: 1,
        })).toBe(true);
    });

    test.each([
        ['legacy plaintext', { clientId: 'fake-client-id', clientSecret: 'fake-secret' }],
        ['missing client id', { encryptedSecret: { iv: 'fake-iv', data: 'fake-ciphertext', version: 1 }, version: 1 }],
        ['empty encrypted data', { clientId: 'fake-client-id', encryptedSecret: { iv: 'fake-iv', data: '', version: 1 }, version: 1 }],
        ['unsupported config version', { clientId: 'fake-client-id', encryptedSecret: { iv: 'fake-iv', data: 'fake-ciphertext', version: 1 }, version: 2 }],
        ['unsupported secret version', { clientId: 'fake-client-id', encryptedSecret: { iv: 'fake-iv', data: 'fake-ciphertext', version: 2 }, version: 1 }],
        ['corrupt primitive', 'fake-plaintext'],
    ])('rejects %s', (_name, value) => {
        expect(hasSecureOAuthConfigShape(value)).toBe(false);
    });

    test('hasSecureOAuthConfig does not decrypt or migrate', () => {
        const cryptoSource = source('src/services/crypto.service.ts');
        const body = sectionBetween(cryptoSource, 'export async function hasSecureOAuthConfig', '/**\n * Retrieves OAuth config'.replace('\\n', '\n'));

        expect(body).not.toContain('decryptToken');
        expect(body).not.toContain('saveSecureOAuthConfig');
        expect(body).toContain('encryptedSecret.version === 1');
        expect(body).toContain("version === 1");
    });

    test('saveSecureOAuthConfig fails on incomplete config instead of returning silently', () => {
        const cryptoSource = source('src/services/crypto.service.ts');
        const body = sectionBetween(cryptoSource, 'export async function saveSecureOAuthConfig', '/**\n * Checks whether OAuth config'.replace('\\n', '\n'));

        expect(body).toContain("throw new Error('Missing OAuth configuration fields')");
        expect(body).not.toContain('if (!config || !config.clientSecret) return;');
    });

    test('real hasSecureOAuthConfig checks fake encrypted shape without decrypting', async () => {
        const cryptoService = loadTsModule('src/services/crypto.service.ts');

        await chrome.storage.local.set({
            oauthConfig: {
                clientId: 'fake-client-id',
                encryptedSecret: { iv: 'not-real-iv', data: 'not-real-ciphertext', version: 1 },
                version: 1,
            }
        });

        await expect(cryptoService.hasSecureOAuthConfig('oauthConfig')).resolves.toBe(true);
    });

    test.each([
        ['legacy plaintext', { clientId: 'fake-client-id', clientSecret: 'fake-secret' }],
        ['corrupt primitive', 'fake-plaintext'],
        ['empty encrypted secret', { clientId: 'fake-client-id', encryptedSecret: { iv: 'fake-iv', data: '', version: 1 }, version: 1 }],
    ])('real hasSecureOAuthConfig rejects %s', async (_name, value) => {
        const cryptoService = loadTsModule('src/services/crypto.service.ts');

        await chrome.storage.local.set({ oauthConfig: value });

        await expect(cryptoService.hasSecureOAuthConfig('oauthConfig')).resolves.toBe(false);
    });

    test('real hasSecureOAuthConfig does not call WebCrypto decrypt for fake ciphertext', async () => {
        const cryptoService = loadTsModule('src/services/crypto.service.ts');
        const decryptSpy = jest.spyOn(globalThis.crypto.subtle, 'decrypt');

        await chrome.storage.local.set({
            oauthConfig: {
                clientId: 'fake-client-id',
                encryptedSecret: { iv: 'fake-iv', data: 'fake-ciphertext', version: 1 },
                version: 1,
            }
        });

        await expect(cryptoService.hasSecureOAuthConfig('oauthConfig')).resolves.toBe(true);
        expect(decryptSpy).not.toHaveBeenCalled();
        decryptSpy.mockRestore();
    });

    test('real saveSecureOAuthConfig rejects incomplete config', async () => {
        const cryptoService = loadTsModule('src/services/crypto.service.ts');

        await expect(cryptoService.saveSecureOAuthConfig('oauthConfig', {
            clientId: 'fake-client-id',
            clientSecret: '',
        })).rejects.toThrow('Missing OAuth configuration fields');

        const stored = await chrome.storage.local.get('oauthConfig');
        expect(stored.oauthConfig).toBeUndefined();
    });
});

describe('OAuth popup state matrix', () => {
    test.each([
        ['stored clean empty fields can sign in', { hasStoredConfig: true, isDirty: false, clientId: '', clientSecret: '' }, { canSignIn: true, canSave: false, shouldSaveBeforeSignIn: false, isBlockedByIncompleteChanges: false }],
        ['stored dirty incomplete blocks sign in', { hasStoredConfig: true, isDirty: true, clientId: 'fake-client-id', clientSecret: '' }, { canSignIn: false, canSave: false, shouldSaveBeforeSignIn: false, isBlockedByIncompleteChanges: true }],
        ['not stored clean empty cannot sign in', { hasStoredConfig: false, isDirty: false, clientId: '', clientSecret: '' }, { canSignIn: false, canSave: false, shouldSaveBeforeSignIn: false, isBlockedByIncompleteChanges: false }],
        ['not stored clean complete saves before sign in', { hasStoredConfig: false, isDirty: false, clientId: 'fake-client-id', clientSecret: 'fake-secret' }, { canSignIn: true, canSave: true, shouldSaveBeforeSignIn: true, isBlockedByIncompleteChanges: false }],
        ['complete visible fields can save and sign in', { hasStoredConfig: false, isDirty: true, clientId: 'fake-client-id', clientSecret: 'fake-secret' }, { canSignIn: true, canSave: true, shouldSaveBeforeSignIn: true, isBlockedByIncompleteChanges: false }],
        ['stored dirty complete saves before sign in', { hasStoredConfig: true, isDirty: true, clientId: 'new-fake-client-id', clientSecret: 'new-fake-secret' }, { canSignIn: true, canSave: true, shouldSaveBeforeSignIn: true, isBlockedByIncompleteChanges: false }],
    ])('%s', (_name, input, expected) => {
        expect(evaluateOAuthConfigState(input)).toMatchObject(expected);
    });

    test('stored config ignores stale draft Client ID and preserves sign-in eligibility', () => {
        const draftResolution = resolveInitialOAuthDraft({
            hasStoredConfig: true,
            draftClientId: 'stale-fake-client-id',
        });

        const state = evaluateOAuthConfigState({
            hasStoredConfig: true,
            isDirty: draftResolution.isDirty,
            clientId: draftResolution.clientId,
            clientSecret: '',
        });

        expect(draftResolution).toEqual({
            clientId: '',
            isDirty: false,
            shouldClearDraftClientId: true,
        });
        expect(state.canSignIn).toBe(true);
        expect(state.isBlockedByIncompleteChanges).toBe(false);
    });

    test('missing stored config restores draft Client ID and requires secret', () => {
        const draftResolution = resolveInitialOAuthDraft({
            hasStoredConfig: false,
            draftClientId: 'draft-fake-client-id',
        });

        const state = evaluateOAuthConfigState({
            hasStoredConfig: false,
            isDirty: draftResolution.isDirty,
            clientId: draftResolution.clientId,
            clientSecret: '',
        });

        expect(draftResolution).toEqual({
            clientId: 'draft-fake-client-id',
            isDirty: true,
            shouldClearDraftClientId: false,
        });
        expect(state.canSignIn).toBe(false);
        expect(state.isBlockedByIncompleteChanges).toBe(true);
    });

    test('late callback after complete visible input does not apply draft and saves before sign-in', () => {
        const applyDraft = shouldApplyInitialOAuthDraft({
            isDirty: true,
            clientId: 'visible-fake-client-id',
            clientSecret: 'visible-fake-secret',
        });

        const state = evaluateOAuthConfigState({
            hasStoredConfig: true,
            isDirty: true,
            clientId: 'visible-fake-client-id',
            clientSecret: 'visible-fake-secret',
        });

        expect(applyDraft).toBe(false);
        expect(state.canSignIn).toBe(true);
        expect(state.shouldSaveBeforeSignIn).toBe(true);
    });

    test('late callback after partial visible autofill blocks sign-in', () => {
        const applyDraft = shouldApplyInitialOAuthDraft({
            isDirty: false,
            clientId: 'visible-fake-client-id',
            clientSecret: '',
        });

        const state = evaluateOAuthConfigState({
            hasStoredConfig: true,
            isDirty: true,
            clientId: 'visible-fake-client-id',
            clientSecret: '',
        });

        expect(applyDraft).toBe(false);
        expect(state.canSignIn).toBe(false);
        expect(state.isBlockedByIncompleteChanges).toBe(true);
    });

    test('normal callback with stored config and empty fields keeps stale-draft fix', () => {
        const applyDraft = shouldApplyInitialOAuthDraft({
            isDirty: false,
            clientId: '',
            clientSecret: '',
        });
        const draftResolution = resolveInitialOAuthDraft({
            hasStoredConfig: true,
            draftClientId: 'stale-fake-client-id',
        });
        const state = evaluateOAuthConfigState({
            hasStoredConfig: true,
            isDirty: draftResolution.isDirty,
            clientId: draftResolution.clientId,
            clientSecret: '',
        });

        expect(applyDraft).toBe(true);
        expect(draftResolution.shouldClearDraftClientId).toBe(true);
        expect(state.canSignIn).toBe(true);
    });
});

describe('OAuth popup/background integration safeguards', () => {
    test('getStatus uses secure OAuth shape instead of preferredTeamId for configured', () => {
        const background = source('background.ts');
        const getStatusCase = background.match(/case 'getStatus':[\s\S]*?case 'getTeams':/)[0];
        const getStatusHelper = background.match(/async function getAuthenticationStatus[\s\S]*?function runTimerWrite/)[0];

        expect(getStatusCase).toContain('getAuthenticationStatus()');
        expect(getStatusHelper).toContain('hasSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG)');
        expect(getStatusHelper).toContain('getFreshAuthenticatedUser()');
        expect(getStatusHelper).not.toContain('getCachedUser()');
        expect(getStatusCase).not.toContain('STORAGE_KEYS.PREFERRED_TEAM');
        expect(getStatusHelper).not.toContain('getSecureOAuthConfig');
    });

    test('saveOAuthConfig verifies secure presence before success', () => {
        const background = source('background.ts');
        const saveCase = background.match(/case 'saveOAuthConfig':[\s\S]*?case 'logout':/)[0];

        expect(saveCase).toContain('saveSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG, data)');
        expect(saveCase).toContain('hasSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG)');
        expect(saveCase).toContain("throw new Error('OAuth configuration was not stored securely')");
    });

    test('popup saves pending complete fields before authenticate and treats success false as failure', () => {
        const popup = source('popup/popup.ts');
        const signInHandler = popup.match(/signInBtn\.addEventListener\('click'[\s\S]*?\n    }\);\n}/)[0];

        expect(signInHandler.indexOf('await saveCurrentOAuthConfig()')).toBeGreaterThan(-1);
        expect(signInHandler.indexOf("{ action: 'authenticate' }")).toBeGreaterThan(signInHandler.indexOf('await saveCurrentOAuthConfig()'));
        expect(signInHandler).toContain("throw new Error('AUTHENTICATION_FAILED')");
    });

    test('secret is never restored to draft or left in DOM after save', () => {
        const popup = source('popup/popup.ts');
        const saveHelper = popup.match(/const saveCurrentOAuthConfig = async \(\): Promise<void> => \{[\s\S]*?\n    };\n/)[0];

        expect(saveHelper).toContain('result?.success !== true');
        expect(popup).not.toContain("chrome.storage.local.set({ draftClientSecret");
        expect(popup).not.toContain("chrome.storage.local.get(['draftClientId', 'draftClientSecret']");
        expect(saveHelper).toContain("clientSecretInput.value = ''");
        expect(saveHelper).toContain("chrome.storage.local.remove(['draftClientId', 'draftClientSecret'])");
        expect(source('popup/popup.html')).toContain('Configuración guardada de forma segura. El secreto se borró del campo intencionalmente.');
    });

    test('popup shows stored and pending-safe messages without values', () => {
        const popup = source('popup/popup.ts');

        expect(popup).toContain("if (configured) {");
        expect(popup).toContain('Configuración guardada de forma segura. El secreto se borró del campo intencionalmente.');
        expect(popup).toContain('Hay cambios OAuth pendientes. Completá ambos campos para guardarlos de forma segura.');
        expect(popup).not.toContain('${clientId');
        expect(popup).not.toContain('${clientSecret');
    });

    test('popup draft callback uses helper resolution and only clears stale draftClientId', () => {
        const popup = source('popup/popup.ts');
        const callback = popup.match(/chrome\.storage\.local\.get\(\['draftClientId'\][\s\S]*?\n    }\);/)[0];

        expect(popup).toContain('resolveInitialOAuthDraft');
        expect(popup).toContain('shouldApplyInitialOAuthDraft');
        expect(callback).toContain('shouldApplyInitialOAuthDraft');
        expect(callback).toContain('resolveInitialOAuthDraft');
        expect(callback).toContain('hasStoredConfig');
        expect(callback.indexOf('shouldApplyInitialOAuthDraft')).toBeLessThan(callback.indexOf('resolveInitialOAuthDraft'));
        expect(callback).toContain("chrome.storage.local.remove('draftClientId')");
        expect(callback).not.toContain('draftClientSecret');
        expect(callback).not.toContain('clientSecretInput.value =');
    });
});
