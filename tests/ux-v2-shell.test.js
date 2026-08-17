const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(source(relativePath), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    const localRequire = (request) => {
        if (request === '../src/connections-state') return loadTsModule('src/connections-state.ts');
        if (request === '../src/task-search-view') return loadTsModule('src/task-search-view.ts');
        return require(request);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

function createAppTabPort({ storedTabId = null, activateFails = false } = {}) {
    const calls = { clear: 0, store: [], activate: [], focus: [], create: [] };
    return {
        calls,
        async getStoredTabId() { return storedTabId; },
        async clearStoredTabId() { calls.clear += 1; },
        async storeTabId(tabId) { calls.store.push(tabId); },
        async activateTab(tabId) {
            calls.activate.push(tabId);
            if (activateFails) throw new Error('STALE_TAB');
            return { windowId: 9 };
        },
        async focusWindow(windowId) { calls.focus.push(windowId); },
        async createTab(url) { calls.create.push(url); return { id: 21 }; },
        getExtensionUrl(relativePath) { return `chrome-extension://test/${relativePath}`; },
    };
}

describe('CGC-UX-V2-A full-tab shell', () => {
    const appTab = loadTsModule('src/app-tab.ts');

    test('launcher focuses the stored app tab instead of creating a duplicate', async () => {
        const port = createAppTabPort({ storedTabId: 12 });

        await expect(appTab.openOrFocusAppTab(port)).resolves.toBe('focused');
        expect(port.calls).toEqual({ clear: 0, store: [], activate: [12], focus: [9], create: [] });
    });

    test('launcher replaces a stale tab id with one new extension tab', async () => {
        const port = createAppTabPort({ storedTabId: 12, activateFails: true });

        await expect(appTab.openOrFocusAppTab(port)).resolves.toBe('created');
        expect(port.calls.clear).toBe(1);
        expect(port.calls.create).toEqual(['chrome-extension://test/app/app.html']);
        expect(port.calls.store).toEqual([21]);
    });

    test('full-tab page exposes six routes and keeps Google OAuth disabled', () => {
        document.documentElement.innerHTML = source('app/app.html');
        const routes = [...document.querySelectorAll('[data-route]')].map((node) => node.getAttribute('data-route'));

        expect(routes).toEqual(['inicio', 'tareas', 'seguimiento', 'reuniones', 'conexiones', 'configuracion']);
        expect(document.querySelectorAll('[data-page]')).toHaveLength(6);
        const googleButton = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Conectar Google Calendar'));
        expect(googleButton).toBeDefined();
        expect(googleButton.disabled).toBe(true);
        expect(googleButton.getAttribute('aria-disabled')).toBe('true');
        expect(source('app/app.ts')).not.toMatch(/getAuthToken|fetch\(|chrome\.storage/);
        expect(source('app/app.ts')).toContain("action: 'getLocalConnectionStatus'");
    });

    test('navigation sanitizer fails closed to Inicio', () => {
        const app = loadTsModule('app/app.ts');

        expect(app.sanitizeAppRoute('#conexiones')).toBe('conexiones');
        expect(app.sanitizeAppRoute('#unknown')).toBe('inicio');
    });

    test('popup exposes the launcher and build compiles the new app entry', () => {
        expect(source('popup/popup.html')).toContain('id="openAppTab"');
        expect(source('popup/popup.ts')).toContain('await openOrFocusAppTab();');
        expect(source('build.js')).toContain("{ in: 'app/app.ts', out: 'app/app' }");
        expect(source('.gitignore')).toContain('app/app.js');
        expect(source('app/app.css')).toContain('@media (max-width: 760px)');
        expect(source('app/app.html')).toContain('class="skip-link"');
    });
});
