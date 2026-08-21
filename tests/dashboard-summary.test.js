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
        return loadTsModule(path.normalize(path.join(path.dirname(relativePath), request)) + '.ts');
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

function task(id, due, closed = null, assigneeId = 42) {
    return {
        id,
        name: `Task ${id}`,
        due_date: due === null ? null : String(due),
        date_closed: closed === null ? null : String(closed),
        assignees: [{ id: assigneeId }],
    };
}

describe('read-only dashboard summary', () => {
    const { buildDashboardSummary } = loadTsModule('src/dashboard-summary.ts');
    const now = new Date(2026, 7, 19, 12, 0, 0, 0).getTime();
    const today = new Date(2026, 7, 19, 9, 0, 0, 0).getTime();
    const yesterday = new Date(2026, 7, 18, 9, 0, 0, 0).getTime();
    const monday = new Date(2026, 7, 17, 9, 0, 0, 0).getTime();
    const previousSunday = new Date(2026, 7, 16, 23, 59, 59, 0).getTime();

    test('derives personal task KPI and ignores tasks assigned to someone else', () => {
        const summary = buildDashboardSummary({
            openTasks: [task('today', today), task('late', yesterday), task('other', today, null, 99)],
            recentlyUpdatedTasks: [task('done', null, monday), task('old', null, previousSunday)],
            timeEntries: [],
            runningTimer: null,
            gmailLinksWeek: 2,
            currentUserId: 42,
            now,
        });

        expect(summary.tasksToday).toBe(1);
        expect(summary.tasksOverdue).toBe(1);
        expect(summary.completedWeek).toBe(1);
        expect(summary.gmailLinksWeek).toBe(2);
    });

    test('deduplicates entries, includes the running timer and groups duration by task id', () => {
        const running = { id: 'run', task: { id: 'B', name: 'Beta' }, start: now - 20 * 60_000, duration: -1, running: true };
        const summary = buildDashboardSummary({
            openTasks: [],
            recentlyUpdatedTasks: [],
            timeEntries: [
                { id: 'a1', task: { id: 'A', name: 'Alpha' }, start: now - 3 * 60 * 60_000, duration: 60 * 60_000 },
                { id: 'a2', task: { id: 'A', name: 'Alpha' }, start: now - 90 * 60_000, duration: 30 * 60_000 },
                { id: 'a2', task: { id: 'A', name: 'Duplicada' }, start: now - 90 * 60_000, duration: 30 * 60_000 },
                { ...running, id: 'running-copy' },
            ],
            runningTimer: running,
            gmailLinksWeek: 0,
            currentUserId: 42,
            now,
        });

        expect(summary.trackedTodayMs).toBe(110 * 60_000);
        expect(summary.taskTimeTotals).toEqual([
            { taskId: 'A', taskName: 'Alpha', durationMs: 90 * 60_000, lastTrackedAt: now - 60 * 60_000 },
            { taskId: 'B', taskName: 'Beta', durationMs: 20 * 60_000, lastTrackedAt: now },
        ]);
    });

    test('groups the personal execution horizon, hides later work and inventories real statuses', () => {
        const tomorrow = new Date(2026, 7, 20, 9, 0, 0, 0).getTime();
        const inThreeDays = new Date(2026, 7, 22, 9, 0, 0, 0).getTime();
        const future = new Date(2026, 7, 23, 9, 0, 0, 0).getTime();
        const make = (id, due, status, color) => ({
            ...task(id, due),
            status: { status, color },
            list: { name: 'PM' },
            priority: { priority: id === 'late' ? 'urgent' : 'normal' },
        });
        const summary = buildDashboardSummary({
            openTasks: [
                make('late', yesterday, 'Responder', '#ff0000'),
                make('today', today, 'Pulir', '#ff0000'),
                make('tomorrow', tomorrow, 'En progreso', '#00aa88'),
                make('three', inThreeDays, 'Pulir', '#ff0000'),
                make('future', future, 'Backlog', '#999999'),
                make('undated', null, 'Responder', 'not-a-color'),
            ],
            recentlyUpdatedTasks: [],
            timeEntries: [{ id: 'tracked', task: { id: 'today', name: 'Task today' }, start: now - 60_000, duration: 60_000 }],
            runningTimer: null,
            gmailLinksWeek: 0,
            currentUserId: 42,
            now,
        });

        expect(summary.executionBoard.overdue.map((item) => item.taskId)).toEqual(['late']);
        expect(summary.executionBoard.today.map((item) => item.taskId)).toEqual(['today']);
        expect(summary.executionBoard.nextThreeDays.map((item) => item.taskId)).toEqual(['tomorrow', 'three']);
        expect(summary.executionBoard.noDueDate.map((item) => item.taskId)).toEqual(['undated']);
        expect(summary.executionBoard.hiddenFutureCount).toBe(1);
        expect(summary.executionBoard.today[0].trackedWeekMs).toBe(60_000);
        expect(summary.executionBoard.today[0].listId).toBeNull();
        expect(summary.executionBoard.today[0].assignees).toEqual([{ id: '42', name: '42' }]);
        expect(JSON.stringify(summary.executionBoard.today[0])).not.toContain('email');
        expect(summary.executionBoard.statuses).toEqual(expect.arrayContaining([
            { label: 'Pulir', color: '#ff0000', count: 2 },
            { label: 'Responder', color: '#ff0000', count: 1 },
            { label: 'Responder', color: '#667085', count: 1 },
        ]));
    });

    test('dashboard task queries are bounded and filtered by current assignee', async () => {
        const { ClickUpAPIWrapper } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper('fixture-token');
        api.request = jest.fn().mockResolvedValue({ tasks: [] });

        await api.getDashboardOpenTasks('team-1', 42);
        await api.getDashboardRecentlyUpdatedTasks('team-1', 42, monday);

        expect(api.request.mock.calls[0][0]).toContain('/team/team-1/task?');
        expect(api.request.mock.calls[0][0]).toContain('include_closed=false');
        expect(api.request.mock.calls[0][0]).toContain('assignees%5B%5D=42');
        expect(api.request.mock.calls[1][0]).toContain('include_closed=true');
        expect(api.request.mock.calls[1][0]).toContain('date_updated_gt=');
    });

    test('message action is extension-only and accepts no caller-controlled filters', () => {
        const security = source('src/message-security.ts');
        expect(security).toContain("'getDashboardSummary'");
        expect(security).toContain("case 'getDashboardSummary':");
        expect(security).toContain("'refreshDashboardSummary'");
        expect(security).toContain("case 'refreshDashboardSummary':");
        expect(source('background.ts')).toContain('const DASHBOARD_SNAPSHOT_TTL_MS = 60 * 1000');
        expect(source('background.ts')).toContain('dashboardSnapshotInFlight');
    });
});
