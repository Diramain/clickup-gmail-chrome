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
        if (!request.startsWith('.')) return require(request);
        const resolved = path.normalize(path.join(path.dirname(relativePath), request)) + '.ts';
        return loadTsModule(resolved);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

describe('Recent time entries for the authenticated user', () => {
    const history = loadTsModule('src/time-entry-history.ts');

    test('extracts a valid current-user ID and fails closed for invalid shapes', () => {
        expect(history.extractCurrentUserId({ user: { id: 42 } })).toBe(42);
        expect(history.extractCurrentUserId({ id: 84 })).toBe(84);
        expect(history.extractCurrentUserId({ user: { id: 'not-a-user' } })).toBeNull();
        expect(history.extractCurrentUserId(null)).toBeNull();
    });

    test('places the running timer first, deduplicates it and sorts completed entries newest first', () => {
        const current = { id: 'running', task: { id: 't3', name: 'En curso' }, start: 3000, duration: -1 };
        const older = { id: 'old', task: { id: 't1', name: 'Anterior' }, start: 1000, duration: 60_000 };
        const newer = { id: 'new', task: { id: 't2', name: 'Reciente' }, start: 2000, duration: 120_000 };

        const duplicateCurrent = { ...current, id: 'running-copy' };
        expect(history.prepareRecentTimeEntries([older, duplicateCurrent, current, newer], current, 10).map(entry => entry.id)).toEqual([
            'running',
            'new',
            'old',
        ]);
    });

    test('computes live duration from start and clamps invalid completed durations', () => {
        const current = { id: 'running', task: { id: 't1', name: 'En curso' }, start: 1_700_000_000_000, duration: -1 };
        expect(history.getTimeEntryDurationMs(current, current, 1_700_000_120_000)).toBe(120_000);
        expect(history.getTimeEntryDurationMs({ ...current, id: 'done', start: 1_699_999_000_000, duration: -10 }, current)).toBe(0);
    });

    test('normalizes second and millisecond timestamps', () => {
        expect(history.toTimeEntryTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
        expect(history.toTimeEntryTimestamp('1700000000000')).toBe(1_700_000_000_000);
    });

    test('builds a ClickUp task URL only from a safe task ID', () => {
        expect(history.getTimeEntryTaskUrl({ task: { id: '86bbah5g7', name: 'Tarea' } })).toBe('https://app.clickup.com/t/86bbah5g7');
        expect(history.getTimeEntryTaskUrl({ task: { id: 'bad/id?token=x', name: 'Tarea' } })).toBeNull();
        expect(history.getTimeEntryTaskUrl({ task: null })).toBeNull();
    });

    test('API includes the explicit assignee filter and background resolves it internally', async () => {
        const { ClickUpAPIWrapper } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper('fixture-token');
        api.request = jest.fn().mockResolvedValue({ data: [] });

        await api.getTimeEntries('team-1', 1000, 2000, 42);

        expect(api.request).toHaveBeenCalledWith('/team/team-1/time_entries?start_date=1000&end_date=2000&assignee=42');
        const background = source('background.ts');
        expect(background).toContain("if (!currentUserId) throw new Error('CURRENT_USER_UNAVAILABLE')");
        expect(background).toContain('getValidatedCurrentUserId()');
        expect(background).toContain('recentEndDate - RECENT_TIME_WINDOW_MS');
        expect(background).not.toContain('data.start_date ?? data.startDate');
    });

    test('popup uses a seven-day window, one refresh flight and visible-only polling', () => {
        const popup = source('popup/popup.ts');
        expect(popup).toContain('timeTrackingRefreshInFlight');
        expect(popup).toContain("document.visibilityState === 'visible'");
        expect(popup).toContain('prepareRecentTimeEntries(result || [], runningTimer, 10)');
        expect(popup).toContain('recentRunningDuration');
        expect(popup).toContain('class=\"entry-task-link\"');
        expect(popup).toContain("window.open(safeClickUpUrl(link.href), '_blank', 'noopener,noreferrer')");
        expect(popup).toContain('const normalizedTimer = { ...timer, start: startTime } as TimeEntry');
        expect(source('background.ts')).toContain('const RECENT_TIME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000');
    });

    test('reauth clears cached identity and ClickUp page origins cannot request time history', () => {
        const background = source('background.ts');
        const security = loadTsModule('src/message-security.ts');
        expect(background).toContain('STORAGE_KEYS.CACHED_USER,');
        expect(background).toContain('currentUserValidatedAt = 0');
        expect(security.isAllowedOriginForAction('getTimeEntries', 'chrome-extension://runtime/popup/popup.html')).toBe(true);
        expect(security.isAllowedOriginForAction('getTimeEntries', 'https://app.clickup.com/t/abc')).toBe(false);
    });
});
