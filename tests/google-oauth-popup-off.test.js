const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath, cache = new Map()) {
    const normalized = path.normalize(relativePath);
    if (cache.has(normalized)) return cache.get(normalized).exports;
    const filename = path.join(__dirname, '..', normalized);
    const compiled = ts.transpileModule(source(normalized), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    cache.set(normalized, module);
    const localRequire = (request) => {
        if (!request.startsWith('.')) return require(request);
        const withoutExtension = request.endsWith('.ts') ? request.slice(0, -3) : request;
        return loadTsModule(`${path.join(path.dirname(normalized), withoutExtension)}.ts`, cache);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

function createIdentitySpy() {
    const calls = { get: 0, remove: 0 };
    return {
        calls,
        getAuthToken(_details, _callback) { calls.get += 1; },
        removeCachedAuthToken(_details, _callback) { calls.remove += 1; },
        getLastErrorMessage() { return null; },
    };
}

describe('CGC-C12-OAUTH-B2 visible connections with OAuth off', () => {
    const ui = loadTsModule('src/google/google-oauth-popup-ui.ts');

    test('runtime capability is hard off and direct connection cannot call identity', async () => {
        const identity = createIdentitySpy();

        expect(ui.GOOGLE_OAUTH_RUNTIME_CAPABILITY_ENABLED).toBe(false);
        await expect(ui.beginGoogleCalendarConnection(identity)).resolves.toEqual({
            ok: false,
            code: 'FEATURE_DISABLED',
            runtimeCapabilityEnabled: false,
        });
        expect(identity.calls).toEqual({ get: 0, remove: 0 });
    });

    test('both visible surfaces stay disabled and synthetic click remains fail-closed', async () => {
        document.body.innerHTML = source('popup/popup.html');
        const identity = createIdentitySpy();
        const surfaces = [
            {
                button: document.getElementById('connectGoogleCalendarSetup'),
                status: document.getElementById('googleOAuthSetupStatus'),
            },
            {
                button: document.getElementById('connectGoogleCalendarConfig'),
                status: document.getElementById('googleOAuthConfigStatus'),
            },
        ];

        ui.initGoogleOAuthConnectionPreview(surfaces, identity);
        for (const surface of surfaces) {
            expect(surface.button.hidden).toBe(false);
            expect(surface.button.disabled).toBe(true);
            expect(surface.button.getAttribute('aria-disabled')).toBe('true');
            expect(surface.button.getAttribute('data-oauth-state')).toBe('disabled-preview');
            surface.button.dispatchEvent(new Event('click'));
        }
        await Promise.resolve();
        expect(identity.calls).toEqual({ get: 0, remove: 0 });
    });

    test('copy explains minimum capabilities without requesting extra Google data', () => {
        const html = source('popup/popup.html');

        for (const label of ['Eventos del calendario principal en modo lectura', 'Próximos siete días', 'Sin invitados, descripciones ni ubicaciones']) {
            expect(html).toContain(label);
        }
        expect(html).toContain('No lee Gmail, Drive, audio, video, chat ni participantes de Meet.');
        expect(html).not.toContain('identity.email');
        expect(html).not.toContain('meetings.space.settings');
    });

    test('popup initializes the local preview without background messages or storage', () => {
        const popup = source('popup/popup.ts');
        const uiSource = source('src/google/google-oauth-popup-ui.ts');

        expect(popup).toContain('initGoogleOAuthConnectionPreview([');
        expect(uiSource).not.toMatch(/chrome\.storage|runtime\.sendMessage|fetch\(|console\./);
        expect(uiSource).not.toContain('clearAllCachedAuthTokens');
    });
});
