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
        if (request === '../diagnostics/recorder') return { initCausalRecorder: () => undefined };
        if (request === '../popup/popup') return {};
        if (request === '../src/i18n') return { t: (key) => key, getActiveLanguage: () => 'es' };
        return require(request);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

describe('CGC-UX-V2-D1 task search and results', () => {
    const taskView = loadTsModule('src/task-search-view.ts');

    test('normalizes and bounds task results without retaining extra fields', () => {
        const tasks = Array.from({ length: 12 }, (_, index) => ({
            id: `task-${index}`,
            name: `Tarea ${index}`,
            status: { status: index === 0 ? 'abierta' : '' },
            token: 'must-not-survive',
        }));
        tasks.push({ id: '', name: 'invalid' });

        const result = taskView.normalizeTaskSearchResponse({ tasks });

        expect(result).toHaveLength(10);
        expect(result[0]).toEqual({ id: 'task-0', name: 'Tarea 0', status: 'abierta' });
        expect(result[1].status).toBe('Sin estado');
        expect(JSON.stringify(result)).not.toContain('must-not-survive');
    });

    test('fails closed for malformed responses and bounds the query', () => {
        expect(taskView.normalizeTaskSearchResponse(null)).toEqual([]);
        expect(taskView.normalizeTaskSearchResponse({ tasks: 'invalid' })).toEqual([]);
        expect(taskView.normalizeTaskSearchQuery(`  ${'x'.repeat(120)}  `)).toHaveLength(100);
    });

    test('distinguishes background failures from an empty task result', () => {
        expect(taskView.isTaskSearchFailure({ success: false, error: 'AUTH_REQUIRED' })).toBe(true);
        expect(taskView.isTaskSearchFailure({ requiresReauth: true })).toBe(true);
        expect(taskView.isTaskSearchFailure({ tasks: [] })).toBe(false);
    });

    test('renders untrusted task values as text nodes, never HTML', () => {
        document.body.innerHTML = '<ol id="taskSearchResults"></ol>';
        const app = loadTsModule('app/app.ts');

        app.renderTaskSearchResults([{ id: 'A-1', name: '<img src=x onerror=alert(1)>', status: '<b>open</b>' }]);

        const results = document.getElementById('taskSearchResults');
        expect(results.querySelector('img')).toBeNull();
        expect(results.querySelector('b')).toBeNull();
        expect(results.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(source('app/app.ts')).not.toContain('innerHTML');
    });

    test('renders a background error as recoverable error, never as no results', async () => {
        document.body.innerHTML = '<form id="taskSearchForm"><input id="appTaskSearch"><button id="appTaskSearchButton"></button></form><div id="taskSearchState"><strong id="taskSearchStateTitle"></strong><span id="taskSearchStateDetail"></span></div><ol id="taskSearchResults"></ol>';
        const app = loadTsModule('app/app.ts');
        app.initTaskSearch({
            async searchTasks() { return { success: false, error: 'AUTH_REQUIRED', requiresReauth: true }; },
        }, true);
        const input = document.getElementById('appTaskSearch');
        input.value = 'tarea';
        document.getElementById('taskSearchForm')
            .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(document.getElementById('taskSearchState').dataset.state).toBe('error');
        expect(document.getElementById('taskSearchStateTitle').textContent).toBe('No se pudo buscar');
    });

    test('uses the existing background action and does not add direct API access', () => {
        const app = source('app/app.ts');
        expect(app).toContain("action: 'searchTasks'");
        expect(app).not.toMatch(/fetch\(|getAuthToken/);
        expect(app).not.toContain('chrome.storage.sync');
        expect(source('src/message-security.ts')).toContain("case 'searchTasks':");
    });
});
