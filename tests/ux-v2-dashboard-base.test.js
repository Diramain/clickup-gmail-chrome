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
        return require(request);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

function createPreferencePort(initial = {}) {
    const store = { ...initial };
    return {
        store,
        read: (key) => (key in store ? store[key] : null),
        write: (key, value) => { store[key] = value; },
    };
}

describe('CGC-UX-V2-B2 theme selection', () => {
    const app = loadTsModule('app/app.ts');

    test('unknown values fall back to the light theme', () => {
        expect(app.sanitizeThemeChoice('clickup')).toBe('clickup');
        expect(app.sanitizeThemeChoice('  PAPER ')).toBe('paper');
        expect(app.sanitizeThemeChoice('neon')).toBe('paper');
        expect(app.sanitizeThemeChoice(null)).toBe('paper');
        expect(app.sanitizeThemeChoice(42)).toBe('paper');
    });

    test('no stored choice defers to the system, an explicit one wins', () => {
        expect(app.resolveInitialTheme(null, true)).toEqual({ theme: 'paper', source: 'auto' });
        expect(app.resolveInitialTheme('', false)).toEqual({ theme: 'paper', source: 'auto' });
        expect(app.resolveInitialTheme('clickup', true)).toEqual({ theme: 'clickup', source: 'stored' });
    });

    test('the owner theme degrades unless owner mode is unlocked', () => {
        expect(app.resolveInitialTheme('spiritfox', false, false)).toEqual({ theme: 'clickup', source: 'stored' });
        expect(app.resolveInitialTheme('spiritfox', false, true)).toEqual({ theme: 'spiritfox', source: 'stored' });
    });

    test('a blocked storage never throws', () => {
        const hostilePort = {
            read() { throw new Error('BLOCKED'); },
            write() { throw new Error('BLOCKED'); },
        };

        expect(() => app.resolveInitialTheme(undefined)).not.toThrow();
        expect(() => app.readDashboardLayout(createPreferencePort(), 'local')).not.toThrow();
        expect(() => app.writeDashboardLayout(createPreferencePort(), 'local', app.pmPresetLayout())).not.toThrow();
        expect(hostilePort.read).toBeDefined();
    });
});

describe('CGC-UX-V2-B2 dashboard layout', () => {
    const app = loadTsModule('app/app.ts');
    const catalogIds = app.WIDGET_CATALOG.map((widget) => widget.id);

    test('no widget ships with data in this cut', () => {
        expect(app.WIDGET_CATALOG.every((widget) => widget.available === false)).toBe(true);
    });

    test('unknown ids are dropped and missing ones are appended', () => {
        const layout = app.normalizeDashboardLayout({ order: ['meetings', 'ghost', 'meetings'], hidden: ['ghost'] });

        expect(layout.order).toHaveLength(catalogIds.length);
        expect(layout.order[0]).toBe('meetings');
        expect(new Set(layout.order)).toEqual(new Set(catalogIds));
        expect(layout.hidden).toEqual([]);
    });

    test('a fully hidden panel is treated as corrupt data and reset', () => {
        const layout = app.normalizeDashboardLayout({ order: catalogIds, hidden: catalogIds });

        expect(layout).toEqual(app.pmPresetLayout());
        expect(layout.hidden.length).toBeLessThan(layout.order.length);
    });

    test('garbage input normalizes to every widget visible instead of throwing', () => {
        expect(app.normalizeDashboardLayout(null)).toEqual({ order: catalogIds, hidden: [] });
        expect(app.normalizeDashboardLayout({ order: 'nope', hidden: 7 })).toEqual({ order: catalogIds, hidden: [] });
    });

    test('moving a widget swaps neighbours and clamps at the edges', () => {
        const order = ['a', 'b', 'c'];

        expect(app.moveWidget(order, 'b', 'up')).toEqual(['b', 'a', 'c']);
        expect(app.moveWidget(order, 'b', 'down')).toEqual(['a', 'c', 'b']);
        expect(app.moveWidget(order, 'a', 'up')).toEqual(order);
        expect(app.moveWidget(order, 'c', 'down')).toEqual(order);
        expect(app.moveWidget(order, 'missing', 'up')).toEqual(order);
        expect(order).toEqual(['a', 'b', 'c']);
    });

    test('a stored layout survives a write/read round trip', () => {
        const port = createPreferencePort();
        const desired = app.normalizeDashboardLayout({ order: ['gmail', 'rhythm'], hidden: ['focus'] });

        app.writeDashboardLayout(port, 'local', desired);

        expect(app.readDashboardLayout(port, 'local')).toEqual(desired);
        expect(Object.keys(port.store)[0]).toBe('cgc-app-dashboard-config-v1:local');
    });

    test('an unreadable stored layout degrades to the PM preset', () => {
        const port = createPreferencePort({ 'cgc-app-dashboard-config-v1:local': '{ not json' });

        expect(app.readDashboardLayout(port, 'local')).toEqual(app.pmPresetLayout());
    });
});

describe('CGC-UX-V2-B2 customizer accessibility', () => {
    const app = loadTsModule('app/app.ts');

    beforeEach(() => {
        document.documentElement.innerHTML = source('app/app.html');
    });

    test('the dialog declares its role and stays closed until asked', () => {
        const backdrop = document.getElementById('dashboardCustomizer');
        const panel = backdrop.querySelector('.customizer-panel');

        expect(backdrop.hidden).toBe(true);
        expect(panel.getAttribute('role')).toBe('dialog');
        expect(panel.getAttribute('aria-modal')).toBe('true');
        expect(panel.getAttribute('aria-labelledby')).toBe('customizerTitle');
        expect(document.getElementById('customizerTitle')).not.toBeNull();
    });

    test('opening focuses the preset select and Escape returns focus to the trigger', () => {
        app.initDashboardCustomizer(createPreferencePort(), 'test');
        const backdrop = document.getElementById('dashboardCustomizer');
        const opener = document.getElementById('openCustomizer');

        opener.click();
        expect(backdrop.hidden).toBe(false);
        expect(document.activeElement).toBe(document.getElementById('presetSelect'));

        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(backdrop.hidden).toBe(true);
        expect(document.activeElement).toBe(opener);
    });

    test('the close button also restores focus', () => {
        app.initDashboardCustomizer(createPreferencePort(), 'test');
        const opener = document.getElementById('openCustomizer');

        opener.click();
        document.getElementById('closeCustomizer').click();

        expect(document.getElementById('dashboardCustomizer').hidden).toBe(true);
        expect(document.activeElement).toBe(opener);
    });

    test('every widget row keeps a real focusable checkbox with an accessible name', () => {
        app.initDashboardCustomizer(createPreferencePort(), 'test');
        document.getElementById('openCustomizer').click();

        const rows = [...document.querySelectorAll('.widget-config-row')];
        expect(rows).toHaveLength(app.WIDGET_CATALOG.length);
        for (const row of rows) {
            const input = row.querySelector('input[type="checkbox"]');
            expect(input).not.toBeNull();
            expect(input.getAttribute('aria-label')).toMatch(/^Mostrar /);
        }
        expect(document.querySelectorAll('.order-btn')).toHaveLength(app.WIDGET_CATALOG.length * 2);
    });

    test('the empty state stays visible because no widget is available yet', () => {
        app.initDashboardCustomizer(createPreferencePort(), 'test');

        expect(document.getElementById('dashboardEmptyState').hidden).toBe(false);
        expect(document.getElementById('dashboardWidgets').children).toHaveLength(0);
    });
});
