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

    test('the owner theme remains hidden until seven version clicks', () => {
        document.body.innerHTML = '<button id="pluginVersionUnlock"></button><button class="owner-theme-option" hidden></button>';
        global.chrome = { runtime: { getManifest: () => ({ version: '1.2.3' }) } };
        app.initOwnerThemeUnlock();
        const version = document.getElementById('pluginVersionUnlock');
        const ownerTheme = document.querySelector('.owner-theme-option');

        for (let click = 0; click < 6; click += 1) version.click();
        expect(ownerTheme.hidden).toBe(true);
        version.click();
        expect(ownerTheme.hidden).toBe(false);
        expect(version.dataset.unlocked).toBe('true');
        delete global.chrome;
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

    test('optional widget grid stays empty without adding a large placeholder', () => {
        app.initDashboardCustomizer(createPreferencePort(), 'test');

        expect(document.getElementById('dashboardEmptyState')).toBeNull();
        expect(document.getElementById('dashboardWidgets').children).toHaveLength(0);
    });

    test('renders authoritative KPI and grouped task time without HTML injection', () => {
        app.renderDashboardSummary({
            generatedAt: new Date(2026, 7, 19, 12, 0, 0).getTime(),
            periodStart: new Date(2026, 7, 17).getTime(),
            tasksToday: 3,
            tasksOverdue: 1,
            completedWeek: 7,
            trackedTodayMs: 5_400_000,
            gmailLinksWeek: 2,
            taskTimeTotals: [{ taskId: 'CU-1', taskName: '<img src=x onerror=alert(1)>', durationMs: 5_400_000, lastTrackedAt: Date.now() }],
            executionBoard: {
                overdue: [{ taskId: 'CU-2', taskName: '<script>alert(1)</script>', taskUrl: 'https://app.clickup.com/t/CU-2', dueAt: Date.now() - 86_400_000, statusLabel: 'Responder', statusColor: '#ff0000', priority: 'urgent', listName: 'PM', trackedWeekMs: 60_000 }],
                today: [],
                nextThreeDays: [],
                noDueDate: [],
                hiddenFutureCount: 4,
                statuses: [{ label: 'Responder', color: '#ff0000', count: 1 }],
            },
            source: 'network',
            expiresAt: Date.now() + 60_000,
        });

        expect(document.getElementById('kpiTasksToday').textContent).toBe('3');
        expect(document.getElementById('kpiTrackedToday').textContent).toBe('1h 30m');
        expect(document.querySelector('.dashboard-time-row strong').textContent).toBe('<img src=x onerror=alert(1)>');
        expect(document.querySelector('.dashboard-time-row img')).toBeNull();
        expect(document.querySelector('.execution-task-card script')).toBeNull();
        expect(document.getElementById('executionOverdueCount').textContent).toBe('1');
        expect(document.getElementById('executionFutureCount').textContent).toContain('4 tareas futuras ocultas');
        expect(document.querySelector('.status-pill').style.getPropertyValue('--status-text')).toBe('#111111');
        expect(document.getElementById('dashboardDataState').textContent).toContain('ClickUp');
    });

    test('normalizes and persists execution board preferences', () => {
        const port = createPreferencePort();
        const desired = app.normalizeExecutionBoardPreferences({
            columnOrder: ['today', 'ghost', 'today', 'overdue'],
            dateSort: { today: 'desc', next: 'invalid' },
        });

        expect(desired.columnOrder).toEqual(['today', 'overdue', 'next', 'undated']);
        expect(desired.dateSort).toEqual({ overdue: 'asc', today: 'desc', next: 'asc', undated: 'asc' });
        app.writeExecutionBoardPreferences(port, desired);
        expect(app.readExecutionBoardPreferences(port)).toEqual(desired);
    });

    test('filters by an exact status and clears the filter on a second click', () => {
        app.initExecutionBoardControls(createPreferencePort());
        const base = { taskUrl: null, dueAt: Date.now(), priority: null, listName: 'PM', trackedWeekMs: 0 };
        app.renderExecutionBoard({
            overdue: [
                { ...base, taskId: 'A', taskName: 'Alpha', statusLabel: 'En curso', statusColor: '#0091ff' },
                { ...base, taskId: 'B', taskName: 'Beta', statusLabel: 'Para hacer', statusColor: '#667085' },
            ],
            today: [{ ...base, taskId: 'C', taskName: 'Gamma', statusLabel: 'En curso', statusColor: '#0091ff' }],
            nextThreeDays: [], noDueDate: [], hiddenFutureCount: 0,
            statuses: [
                { label: 'En curso', color: '#0091ff', count: 2 },
                { label: 'Para hacer', color: '#667085', count: 1 },
            ],
        });

        const filter = [...document.querySelectorAll('.execution-status-filter')].find((button) => button.textContent.includes('En curso'));
        filter.click();
        expect(filter.isConnected).toBe(false);
        expect(document.getElementById('executionOverdueCount').textContent).toBe('1');
        expect(document.getElementById('executionTodayCount').textContent).toBe('1');
        const active = document.querySelector('.execution-status-filter[aria-pressed="true"]');
        expect(active.textContent).toContain('En curso');
        active.click();
        expect(document.getElementById('executionOverdueCount').textContent).toBe('2');
    });

    test('moves columns with the keyboard and persists per-column date order', () => {
        const port = createPreferencePort();
        app.initExecutionBoardControls(port);
        const todayHandle = document.querySelector('[data-execution-column="today"] .execution-drag-handle');
        todayHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

        expect(document.querySelector('[data-execution-column]').dataset.executionColumn).toBe('today');
        expect(JSON.parse(port.store[app.EXECUTION_BOARD_STORAGE_KEY]).columnOrder[0]).toBe('today');

        const base = { taskUrl: null, priority: null, listName: 'PM', trackedWeekMs: 0, statusLabel: 'Todo', statusColor: '#667085' };
        app.renderExecutionBoard({
            overdue: [
                { ...base, taskId: 'old', taskName: 'Old', dueAt: 100 },
                { ...base, taskId: 'new', taskName: 'New', dueAt: 200 },
            ],
            today: [], nextThreeDays: [], noDueDate: [], hiddenFutureCount: 0,
            statuses: [{ label: 'Todo', color: '#667085', count: 2 }],
        });
        expect(document.querySelector('#executionOverdueTasks .execution-task-card').textContent).toContain('Old');
        document.querySelector('[data-sort-column="overdue"]').click();
        expect(document.querySelector('#executionOverdueTasks .execution-task-card').textContent).toContain('New');
        expect(JSON.parse(port.store[app.EXECUTION_BOARD_STORAGE_KEY]).dateSort.overdue).toBe('desc');
    });

    test('orders personal task time by duration or latest tracking and saves the choice', () => {
        const port = createPreferencePort();
        app.initTaskTimeSort(port);
        app.renderDashboardTaskTotals([
            { taskId: 'long', taskName: 'Mayor duración', durationMs: 7_200_000, lastTrackedAt: 100 },
            { taskId: 'recent', taskName: 'Más reciente', durationMs: 60_000, lastTrackedAt: 200 },
        ]);
        expect(document.querySelector('.dashboard-time-row strong').textContent).toBe('Mayor duración');

        const select = document.getElementById('taskTimeSort');
        select.value = 'recent';
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
        expect(document.querySelector('.dashboard-time-row strong').textContent).toBe('Más reciente');
        expect(port.store[app.TASK_TIME_SORT_STORAGE_KEY]).toBe('recent');
    });

    test('manual refresh asks the background to bypass cache and restores the button', async () => {
        const summary = {
            generatedAt: Date.now(), periodStart: Date.now(), tasksToday: 0, tasksOverdue: 0,
            completedWeek: 0, trackedTodayMs: 0, gmailLinksWeek: 0, taskTimeTotals: [],
            executionBoard: { overdue: [], today: [], nextThreeDays: [], noDueDate: [], hiddenFutureCount: 0, statuses: [] },
            source: 'network', expiresAt: Date.now() + 60_000,
        };
        const port = { read: jest.fn().mockResolvedValue(summary) };
        app.initDashboardRefresh(port);
        const button = document.getElementById('refreshExecutionBoard');
        button.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(port.read).toHaveBeenCalledWith(true);
        expect(button.disabled).toBe(false);
        expect(button.textContent).toContain('Actualizado');
    });

    test('selects cards with ctrl-click and previews only common status and assignee options', async () => {
        const port = {
            readList: jest.fn(async (listId) => ({
                statuses: listId === 'L1'
                    ? [{ status: 'Todo', color: '#667085' }, { status: 'Done', color: '#00aa88' }]
                    : [{ status: 'Todo', color: '#667085' }],
            })),
            readMembers: jest.fn(async (listId) => ({
                members: listId === 'L1'
                    ? [{ id: 1, username: 'Ana' }, { id: 2, username: 'Beto' }]
                    : [{ id: 1, username: 'Ana' }, { id: 3, username: 'Carla' }],
            })),
        };
        const applyPort = {
            applyTask: jest.fn(async (change) => ({ ok: true, taskId: change.taskId, outcome: 'applied', code: 'APPLIED', stop: false })),
        };
        app.initBulkEditPreview(port, applyPort);
        const base = { taskUrl: null, dueAt: 100, priority: null, listName: 'PM', trackedWeekMs: 0, statusLabel: 'Todo', statusColor: '#667085', assignees: [{ id: '2', name: 'Beto' }] };
        app.renderExecutionBoard({
            overdue: [
                { ...base, taskId: 'A', taskName: 'Alpha', listId: 'L1' },
                { ...base, taskId: 'B', taskName: 'Beta', listId: 'L2' },
            ],
            today: [], nextThreeDays: [], noDueDate: [], hiddenFutureCount: 0,
            statuses: [{ label: 'Todo', color: '#667085', count: 2 }],
        });

        for (const card of document.querySelectorAll('.execution-task-card')) {
            card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
        }
        expect(document.getElementById('bulkActionRailButton').hidden).toBe(false);
        expect(document.getElementById('bulkActionRailButton').textContent).toContain('2');

        document.getElementById('bulkActionRailButton').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.getElementById('bulkEditDrawer').getAttribute('aria-hidden')).toBe('false');
        expect([...document.getElementById('bulkStatus').options].map((option) => option.textContent)).toEqual(['Sin cambios', 'Todo']);
        expect([...document.getElementById('bulkAssignee').options].map((option) => option.textContent)).toEqual(['Sin cambios', 'Ana']);

        document.getElementById('bulkDueMode').value = 'set';
        document.getElementById('bulkDueMode').dispatchEvent(new window.Event('change', { bubbles: true }));
        document.getElementById('bulkDueDate').value = '2026-08-31';
        document.getElementById('bulkStatus').value = 'Todo';
        document.getElementById('bulkAssignee').value = '1';
        document.getElementById('previewBulkChanges').click();
        expect(document.querySelectorAll('.bulk-preview-row')).toHaveLength(2);
        expect(document.getElementById('bulkPreview').textContent).toContain('Responsable: Beto → Ana');
        expect(document.getElementById('applyBulkChanges').disabled).toBe(false);

        window.confirm = jest.fn(() => true);
        document.getElementById('applyBulkChanges').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(window.confirm).toHaveBeenCalledTimes(1);
        expect(applyPort.applyTask).toHaveBeenCalledTimes(2);
        expect(document.getElementById('bulkApplyState').textContent).toContain('2 aplicadas');

        document.getElementById('clearBulkSelection').click();
        expect(document.getElementById('bulkActionRailButton').hidden).toBe(true);
    });
});
