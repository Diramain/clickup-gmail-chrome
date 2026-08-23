const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { webcrypto } = require('crypto');
const { TextEncoder } = require('util');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath, overrides = {}, cache = new Map()) {
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
        if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request];
        if (!request.startsWith('.')) return require(request);
        const base = path.join(path.dirname(normalized), request);
        return loadTsModule(base.endsWith('.ts') ? base : `${base}.ts`, overrides, cache);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

describe('CGC-CALENDAR-014 background OAuth runtime', () => {
    const runtimeModule = loadTsModule('src/calendar/calendar-runtime.ts');
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const originalTextEncoder = globalThis.TextEncoder;

    beforeEach(() => {
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
        globalThis.TextEncoder = TextEncoder;
    });

    afterAll(() => {
        globalThis.TextEncoder = originalTextEncoder;
        if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
    });

    test('requires explicit interactive connect and never exposes the token in the view', async () => {
        const calls = [];
        const port = {
            requestToken: jest.fn(async (interactive) => {
                calls.push(['token', interactive]);
                return interactive
                    ? { ok: true, token: 'synthetic-secret-token', grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned.readonly'] }
                    : { ok: false, code: 'INTERACTION_REQUIRED' };
            }),
            invalidateToken: jest.fn(async () => ({ ok: true })),
            readAgenda: jest.fn(async () => ({ ok: true, events: [{
                eventId: 'event_1', title: 'Plan', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed',
            }] })),
        };
        const runtime = new runtimeModule.GoogleCalendarAgendaRuntime(port);

        await expect(runtime.getAgenda()).resolves.toMatchObject({ state: 'disconnected', items: [] });
        const connected = await runtime.connect();
        expect(connected).toMatchObject({ state: 'ready', capabilityEnabled: true });
        expect(JSON.stringify(connected)).not.toContain('synthetic-secret-token');
        expect(calls).toEqual([['token', false], ['token', true]]);
        expect(port.readAgenda).toHaveBeenCalledTimes(1);
    });

    test('disconnect invalidates the known token and clears the in-memory agenda', async () => {
        const port = {
            requestToken: jest.fn(async () => ({ ok: true, token: 'synthetic-token', grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned.readonly'] })),
            invalidateToken: jest.fn(async () => ({ ok: true })),
            readAgenda: jest.fn(async () => ({ ok: true, events: [{
                eventId: 'event_2', title: 'Plan', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed',
            }] })),
        };
        const runtime = new runtimeModule.GoogleCalendarAgendaRuntime(port);
        await runtime.connect();

        await expect(runtime.disconnect()).resolves.toEqual({ state: 'disconnected', capabilityEnabled: true, items: [] });
        expect(port.invalidateToken).toHaveBeenCalledWith('synthetic-token');
    });

    test('confirmed 401 invalidates the rejected token and requires explicit reconnection', async () => {
        const port = {
            requestToken: jest.fn(async () => ({ ok: true, token: 'rejected-token', grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned.readonly'] })),
            invalidateToken: jest.fn(async () => ({ ok: true })),
            readAgenda: jest.fn(async () => ({ ok: false, code: 'AUTH_REQUIRED' })),
        };
        const runtime = new runtimeModule.GoogleCalendarAgendaRuntime(port);

        await expect(runtime.refresh()).resolves.toMatchObject({ state: 'reconnect-required', errorCode: 'AUTH_REQUIRED', items: [] });
        expect(port.invalidateToken).toHaveBeenCalledWith('rejected-token');
    });

    test('permission denial also clears the cached token and offers explicit reconnection', async () => {
        const port = {
            requestToken: jest.fn(async () => ({ ok: true, token: 'scope-token', grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned.readonly'] })),
            invalidateToken: jest.fn(async () => ({ ok: true })),
            readAgenda: jest.fn(async () => ({ ok: false, code: 'PERMISSION_DENIED' })),
        };
        const runtime = new runtimeModule.GoogleCalendarAgendaRuntime(port);

        await expect(runtime.getAgenda()).resolves.toMatchObject({ state: 'reconnect-required', errorCode: 'PERMISSION_DENIED', items: [] });
        expect(port.invalidateToken).toHaveBeenCalledWith('scope-token');
    });

    test('disconnect invalidates an in-flight refresh before it can repopulate the agenda', async () => {
        let resolveAgenda;
        const pendingAgenda = new Promise((resolve) => { resolveAgenda = resolve; });
        const port = {
            requestToken: jest.fn(async () => ({ ok: true, token: 'race-token', grantedScopes: [] })),
            invalidateToken: jest.fn(async () => ({ ok: true })),
            readAgenda: jest.fn(() => pendingAgenda),
        };
        const runtime = new runtimeModule.GoogleCalendarAgendaRuntime(port);
        const refresh = runtime.refresh();
        await Promise.resolve();
        const disconnect = runtime.disconnect();
        resolveAgenda({ ok: true, events: [{
            eventId: 'late_event', title: 'Stale', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed',
        }] });

        await refresh;
        await disconnect;
        expect(runtime.currentView()).toEqual({ state: 'disconnected', capabilityEnabled: true, items: [] });
    });

    test('an older refresh cannot overwrite a newer completed refresh', async () => {
        let resolveFirst;
        const firstAgenda = new Promise((resolve) => { resolveFirst = resolve; });
        const port = {
            requestToken: jest.fn(async () => ({ ok: true, token: 'refresh-token', grantedScopes: [] })),
            invalidateToken: jest.fn(async () => ({ ok: true })),
            readAgenda: jest.fn()
                .mockImplementationOnce(() => firstAgenda)
                .mockResolvedValueOnce({ ok: true, events: [{
                    eventId: 'new_event', title: 'Nueva', start: '2026-08-22T12:00:00Z', end: '2026-08-22T13:00:00Z', allDay: false, status: 'confirmed',
                }] }),
        };
        const runtime = new runtimeModule.GoogleCalendarAgendaRuntime(port);
        const first = runtime.refresh();
        await Promise.resolve();
        const second = runtime.refresh();
        await second;
        resolveFirst({ ok: true, events: [{
            eventId: 'old_event', title: 'Vieja', start: '2026-08-22T09:00:00Z', end: '2026-08-22T10:00:00Z', allDay: false, status: 'confirmed',
        }] });
        await first;

        expect(runtime.currentView().items.map((item) => item.title)).toEqual(['Nueva']);
    });

    test('an obsolete generation cannot commit after entering asynchronous cache replacement', async () => {
        let releaseFirstReplace;
        const firstReplace = new Promise((resolve) => { releaseFirstReplace = resolve; });
        let replaceCalls = 0;
        let items = [];
        const cache = {
            clear: jest.fn(() => { items = []; }),
            list: jest.fn(() => items),
            replace: jest.fn(async (events, _now, canCommit) => {
                replaceCalls += 1;
                if (replaceCalls === 1) await firstReplace;
                const next = events.map((event) => ({
                    key: event.eventId.padEnd(64, '0').slice(0, 64), title: event.title, start: event.start, end: event.end,
                    allDay: event.allDay, status: event.status, hasMeet: false,
                }));
                if (!canCommit()) return [];
                items = next;
                return next;
            }),
        };
        const port = {
            requestToken: jest.fn(async () => ({ ok: true, token: 'commit-token', grantedScopes: [] })),
            invalidateToken: jest.fn(async () => ({ ok: true })),
            readAgenda: jest.fn()
                .mockResolvedValueOnce({ ok: true, events: [{ eventId: 'old', title: 'Vieja', start: '2026-08-22T09:00:00Z', end: '2026-08-22T10:00:00Z', allDay: false, status: 'confirmed' }] })
                .mockResolvedValueOnce({ ok: true, events: [{ eventId: 'new', title: 'Nueva', start: '2026-08-22T12:00:00Z', end: '2026-08-22T13:00:00Z', allDay: false, status: 'confirmed' }] }),
        };
        const runtime = new runtimeModule.GoogleCalendarAgendaRuntime(port, cache);
        const oldRefresh = runtime.refresh();
        await Promise.resolve();
        await Promise.resolve();
        await runtime.refresh();
        releaseFirstReplace();
        await oldRefresh;

        expect(runtime.currentView().items.map((item) => item.title)).toEqual(['Nueva']);
    });
});
