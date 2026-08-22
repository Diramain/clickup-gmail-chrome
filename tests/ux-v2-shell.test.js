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
        if (request === '../src/destination-config') return loadTsModule('src/destination-config.ts');
        if (request === '../popup/popup') return {};
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

    test('full-tab page exposes seven routes and keeps Google OAuth disabled', () => {
        document.documentElement.innerHTML = source('app/app.html');
        const routes = [...document.querySelectorAll('[data-route]')].map((node) => node.getAttribute('data-route'));

        expect(routes).toEqual(['inicio', 'gmail', 'tiempo', 'meet', 'sync', 'conexion', 'datos']);
        expect(document.querySelectorAll('[data-page]')).toHaveLength(7);
        expect(document.querySelector('.nav-index')).toBeNull();
        for (const id of ['dashboardNowTitle', 'dashboardTimerValue', 'dashboardMeetingTitle', 'executionBoardTitle', 'toggleExecutionSelection', 'refreshExecutionBoard', 'executionOverdueTasks', 'executionTodayTasks', 'executionNextTasks', 'executionUndatedTasks', 'dashboardKpiTitle', 'kpiTasksToday', 'kpiTasksOverdue', 'kpiCompletedWeek', 'kpiTrackedToday', 'kpiGmailTasks', 'taskTimeSort', 'bulkActionRailButton', 'bulkEditDrawer', 'bulkStatus', 'bulkAssignee', 'applyBulkChanges']) {
            expect(document.getElementById(id)).not.toBeNull();
        }
        const googleButton = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Conectar Google Calendar'));
        expect(googleButton).toBeDefined();
        expect(googleButton.disabled).toBe(true);
        expect(googleButton.getAttribute('aria-disabled')).toBe('true');
        expect(source('app/app.ts')).not.toMatch(/getAuthToken|fetch\(/);
        expect(source('app/app.ts')).not.toContain('chrome.storage.sync');
        expect(source('app/app.ts')).toContain("action: 'getLocalConnectionStatus'");
    });

    test('native task controls live inside the Gmail section without an iframe', () => {
        document.documentElement.innerHTML = source('app/app.html');
        const search = document.getElementById('taskSearch');

        expect(search).not.toBeNull();
        expect(search.closest('[data-page]').getAttribute('data-page')).toBe('gmail');
        expect(document.querySelector('[data-page="tareas"]')).toBeNull();
        expect(document.querySelector('iframe')).toBeNull();
        for (const id of ['taskSearch', 'searchResults', 'quickCreateTask', 'openTaskModal', 'quickCreateForm']) {
            expect(document.getElementById(id)).not.toBeNull();
        }
    });

    test('navigation sanitizer fails closed to Inicio', () => {
        const app = loadTsModule('app/app.ts');

        expect(app.sanitizeAppRoute('#conexion')).toBe('conexion');
        expect(app.sanitizeAppRoute('#unknown')).toBe('inicio');
    });

    test('stylesheet carries the prototype identity without remote assets', () => {
        const css = source('app/app.css');

        expect(css).toContain('#6647f0');
        expect(css).toContain('#0091ff');
        expect(css).toContain('#17151f');
        expect(css).toContain('.owner-theme-option[hidden]');
        expect(css).toContain('.destination-actions');
        expect(css).not.toContain('#f1eee6');
        expect(css).not.toContain('#fffdf8');
        expect(css).not.toContain('#3979c6');
        expect(css).not.toMatch(/@import|url\(\s*["']?https?:/);
        for (const primitive of ['.chart', '.stat', '.progress', '.switch', '.chip', '.agenda-item', '.list-row']) {
            expect(css).toContain(`${primitive} {`);
        }
    });

    test('full tab owns the complete controls while the configured popup stays minimal', () => {
        const appHtml = source('app/app.html');
        const fullControls = source('popup/popup.html');
        const minimal = source('popup/minimal.html');
        const manifest = JSON.parse(source('manifest.json'));

        for (const id of ['taskSearch', 'runningTimer', 'meetPriorityCard', 'syncLists', 'clickUpConnectionState', 'safeDiagnostics']) {
            expect(appHtml).toContain(`id="${id}"`);
        }
        expect(appHtml).not.toContain('<iframe');
        expect(appHtml).toContain('id="startRecorder"');
        expect(appHtml).toContain('id="stopRecorder"');
        expect(appHtml).not.toContain('id="openCausalRecorder"');
        expect(source('app/app.ts')).toContain('initCausalRecorder(document)');
        expect(appHtml).toContain('src="assets/clickup-logomark.svg"');
        expect(appHtml).toContain('src="assets/clickup-logo-on-light.svg"');
        expect(appHtml).toContain('src="assets/clickup-logo-on-dark.svg"');
        expect(appHtml).toContain('src="assets/google-calendar.svg"');
        expect(appHtml).not.toMatch(/<img[^>]+src=["']https?:/);
        expect(manifest.action.default_popup).toBe('popup/minimal.html');
        expect(minimal).toContain('id="miniConnection"');
        expect(minimal).toContain('id="miniTimerDisplay"');
        expect(minimal).toContain('00:00:00:00');
        expect(minimal).toContain('id="miniOpenApp"');
        expect(minimal).toContain('id="miniAutoStart"');
        expect(minimal).toContain('id="miniAutoStop"');
        expect(minimal).toContain('id="miniPlayTimer"');
        expect(minimal).toContain('id="miniStopTimer"');
        expect(minimal).toContain('id="miniMeetPriority"');
        expect(minimal).toContain('id="miniMeetTaskSearch"');
        expect(minimal).toContain('id="miniMeetAssign"');
        expect(minimal).not.toContain('id="taskSearch"');
        expect(minimal).not.toContain('id="syncLists"');
        expect(source('popup/minimal.css')).toContain('html[data-theme="clickup"]');
        expect(source('popup/minimal.css')).toContain('html[data-theme="spiritfox"]');
        expect(source('src/gmail-native.ts')).toContain('class="cu-attach-btn"');
        expect(source('src/gmail-native.ts')).toContain('Tareas vinculadas');
    });

    test('build compiles the app, full controller and minimal popup', () => {
        expect(source('build.js')).toContain("{ in: 'app/app.ts', out: 'app/app' }");
        expect(source('build.js')).toContain("{ in: 'popup/minimal.ts', out: 'popup/minimal' }");
        expect(source('popup/minimal.ts')).toContain('await openOrFocusAppTab();');
        expect(source('popup/popup.ts')).toContain('IS_FULL_APP_SURFACE');
        expect(source('.gitignore')).toContain('app/app.js');
        expect(source('app/app.css')).toContain('@media (max-width: 760px)');
        expect(source('app/app.html')).toContain('class="skip-link"');
    });
});
