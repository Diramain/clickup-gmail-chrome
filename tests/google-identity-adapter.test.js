const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadGoogleIdentityModule() {
    const filename = path.join(__dirname, '..', 'src/google/google-identity.service.ts');
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

function createIdentityPort({ token = 'synthetic-access-value', grantedScopes, error = null } = {}) {
    const calls = { get: [], remove: [] };
    return {
        calls,
        getAuthToken(details, callback) {
            calls.get.push(details);
            callback(token, grantedScopes);
        },
        removeCachedAuthToken(details, callback) {
            calls.remove.push(details);
            callback();
        },
        getLastErrorMessage() {
            return error;
        },
    };
}

describe('CGC-C12-OAUTH-B1 local Google Identity adapter', () => {
    const identity = loadGoogleIdentityModule();
    const coreScopes = [...identity.GOOGLE_CALENDAR_CORE_SCOPES];

    test('requests only core scopes and returns an in-memory token when all are granted', async () => {
        const port = createIdentityPort({ grantedScopes: [...coreScopes, 'not-allowlisted'] });

        const result = await identity.requestGoogleCalendarToken(false, port);

        expect(result).toEqual({ ok: true, token: 'synthetic-access-value', grantedScopes: coreScopes });
        expect(port.calls.get).toEqual([{ interactive: false, scopes: coreScopes }]);
    });

    test('fails closed without returning the token when a core scope is missing', async () => {
        const port = createIdentityPort({ grantedScopes: [] });

        const result = await identity.requestGoogleCalendarToken(true, port);

        expect(result).toEqual({
            ok: false,
            code: 'SCOPES_NOT_GRANTED',
            missingScopes: [coreScopes[0]],
        });
        expect(result).not.toHaveProperty('token');
    });

    test('reduces browser errors to allowlisted cancellation and interaction codes', async () => {
        const cancelled = createIdentityPort({ grantedScopes: coreScopes, error: 'The user cancelled the flow' });
        const needsInteraction = createIdentityPort({ grantedScopes: coreScopes, error: 'OAuth prompt required' });

        await expect(identity.requestGoogleCalendarToken(true, cancelled)).resolves.toEqual({ ok: false, code: 'USER_CANCELLED' });
        await expect(identity.requestGoogleCalendarToken(false, needsInteraction)).resolves.toEqual({ ok: false, code: 'INTERACTION_REQUIRED' });
    });

    test('rejects an empty token without exposing browser details', async () => {
        const port = createIdentityPort({ token: '', grantedScopes: coreScopes });

        await expect(identity.requestGoogleCalendarToken(false, port)).resolves.toEqual({ ok: false, code: 'TOKEN_UNAVAILABLE' });
    });

    test('invalidates only the supplied cached token and rejects empty input', async () => {
        const port = createIdentityPort();

        await expect(identity.invalidateGoogleCalendarToken('synthetic-access-value', port)).resolves.toEqual({ ok: true });
        await expect(identity.invalidateGoogleCalendarToken('  ', port)).resolves.toEqual({ ok: false, code: 'TOKEN_UNAVAILABLE' });
        expect(port.calls.remove).toEqual([{ token: 'synthetic-access-value' }]);
    });
});
