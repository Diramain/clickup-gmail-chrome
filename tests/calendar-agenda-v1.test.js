const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { createHash, webcrypto } = require('crypto');
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
        const target = base.endsWith('.ts') ? base : `${base}.ts`;
        return loadTsModule(target, overrides, cache);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

describe('CGC-CALENDAR-014 read-only agenda local canary', () => {
    const agenda = loadTsModule('src/calendar/calendar-agenda.ts');
    const service = loadTsModule('src/calendar/google-calendar.service.ts');
    const agendaCache = loadTsModule('src/calendar/calendar-agenda-cache.ts');
    const linking = loadTsModule('src/calendar/calendar-linking.ts');

    test('reduces Google authorization to one owned-events read-only scope and the exact API origin', () => {
        const manifest = JSON.parse(source('manifest.json'));
        const identity = loadTsModule('src/google/google-identity.service.ts');
        const expected = ['https://www.googleapis.com/auth/calendar.events.owned.readonly'];

        expect(manifest.oauth2.scopes).toEqual(expected);
        expect(identity.GOOGLE_CALENDAR_CORE_SCOPES).toEqual(expected);
        expect(manifest.host_permissions).toContain('https://www.googleapis.com/*');
        expect(source('src/calendar/calendar-capability.ts')).toContain('GOOGLE_CALENDAR_RUNTIME_ENABLED = true');
    });

    test('sanitizes and bounds Google events while reducing Meet links to canonical room codes', () => {
        const items = Array.from({ length: 24 }, (_, index) => ({
            id: `event_${index}`,
            summary: index === 0 ? '  Reunión\u0000 privada   semanal  ' : `Evento ${index}`,
            status: index === 1 ? 'tentative' : 'confirmed',
            start: { dateTime: `2026-08-${String(22 + Math.floor(index / 10)).padStart(2, '0')}T10:00:00-03:00` },
            end: { dateTime: `2026-08-${String(22 + Math.floor(index / 10)).padStart(2, '0')}T11:00:00-03:00` },
            hangoutLink: index === 0 ? 'https://meet.google.com/abc-defg-hij?authuser=private' : 'https://evil.example/abc-defg-hij',
            attendees: [{ email: 'must-not-pass@example.test' }],
            description: 'must not pass',
        }));
        const result = agenda.sanitizeGoogleCalendarEvents({ items });

        expect(result).toHaveLength(20);
        expect(result[0]).toEqual({
            eventId: 'event_0',
            title: 'Reunión privada semanal',
            start: '2026-08-22T10:00:00-03:00',
            end: '2026-08-22T11:00:00-03:00',
            allDay: false,
            status: 'confirmed',
            meetRoomCode: 'abc-defg-hij',
        });
        expect(JSON.stringify(result)).not.toMatch(/attendees|must-not-pass|example\.test|description|authuser/);
        expect(result[1]).not.toHaveProperty('meetRoomCode');
    });

    test('keeps only the signed-in attendee response and discards attendee identity fields', () => {
        const [event] = agenda.sanitizeGoogleCalendarEvents({ items: [{
            id: 'event_attendance',
            summary: 'Reunión opcional',
            status: 'confirmed',
            start: { dateTime: '2026-08-22T10:00:00-03:00' },
            end: { dateTime: '2026-08-22T11:00:00-03:00' },
            attendees: [
                { self: false, responseStatus: 'accepted', email: 'other@example.invalid', displayName: 'Other' },
                { self: true, responseStatus: 'declined', email: 'self@example.invalid', displayName: 'Self', arbitrary: 'discarded' },
            ],
        }] });

        expect(event.attendanceStatus).toBe('declined');
        expect(JSON.stringify(event)).not.toContain('example.invalid');
        expect(JSON.stringify(event)).not.toContain('displayName');
        expect(JSON.stringify(event)).not.toContain('arbitrary');
    });

    test('rejects cancelled, malformed, reversed, and overexposed event records', () => {
        const valid = { id: 'safe_event', summary: 'Safe', status: 'confirmed', start: { date: '2026-08-22' }, end: { date: '2026-08-23' } };
        const result = agenda.sanitizeGoogleCalendarEvents({ items: [
            { ...valid, status: 'cancelled' },
            { ...valid, id: 'bad/id' },
            { ...valid, end: { date: '2026-08-21' } },
            valid,
        ] });
        expect(result).toEqual([{ eventId: 'safe_event', title: 'Safe', start: '2026-08-22', end: '2026-08-23', allDay: true, status: 'confirmed' }]);
    });

    test('creates a private deterministic event key without persisting Calendar identity in the view', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
        const previousTextEncoder = globalThis.TextEncoder;
        globalThis.TextEncoder = TextEncoder;
        try {
            const key = await agenda.createCalendarEventKey('event_123');
            expect(key).toBe(createHash('sha256').update('cgc-calendar-v1:primary:event_123').digest('hex'));
            expect(agenda.normalizeCalendarAgendaView({
                state: 'ready',
                capabilityEnabled: true,
                items: [{ key, title: 'Evento', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed', hasMeet: true, eventId: 'must-not-pass' }],
            })).toEqual({
                state: 'ready', capabilityEnabled: true,
                items: [{ key, title: 'Evento', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed', hasMeet: true }],
            });
        } finally {
            globalThis.TextEncoder = previousTextEncoder;
            if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
        }
    });

    test('keeps Calendar details only in expiring memory and derives the existing Meet mapping shape', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        const previousTextEncoder = globalThis.TextEncoder;
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
        globalThis.TextEncoder = TextEncoder;
        try {
            const cache = new agendaCache.CalendarAgendaMemoryCache();
            const [item] = await cache.replace([{
                eventId: 'event_456', title: 'Plan', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed', meetRoomCode: 'abc-defg-hij',
            }], 1_000);
            expect(item).not.toHaveProperty('eventId');
            expect(item).not.toHaveProperty('meetRoomCode');
            expect(agendaCache.canonicalMeetUrlFromCalendarAgenda(cache, item.key, 1_001)).toBe('https://meet.google.com/abc-defg-hij');

            const mapping = await agendaCache.createMeetMappingFromCalendarAgenda(cache, {
                eventKey: item.key, taskId: 'task_123', teamId: 'team_9', now: 1_001,
            });
            expect(mapping).toEqual({
                roomKey: createHash('sha256').update('cgc-meet-v1:abc-defg-hij').digest('hex'),
                taskId: 'task_123', teamId: 'team_9', createdAt: 1_001, lastUsedAt: 1_001, enabled: true,
            });
            expect(cache.get(item.key, 61_000)).toBeNull();
            expect(agendaCache.canonicalMeetUrlFromCalendarAgenda(cache, item.key, 61_000)).toBeNull();
        } finally {
            globalThis.TextEncoder = previousTextEncoder;
            if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
        }
    });

    test('refreshes an expired Calendar event before create, link, or Meet actions', () => {
        const background = source('background.ts');
        expect(background).toContain('async function ensureCalendarAgendaEvent(eventKey: string)');
        expect(background).toMatch(/case 'linkGoogleCalendarEventTask':[\s\S]{0,240}ensureCalendarAgendaEvent\(data\.eventKey\)/);
        expect(background).toMatch(/case 'openGoogleCalendarMeet':[\s\S]{0,240}ensureCalendarAgendaEvent\(data\.eventKey\)/);
        expect(background).toMatch(/async function createAndMapCalendarTask[\s\S]{0,500}ensureCalendarAgendaEvent\(eventKey\)/);
    });

    test('reduces recurringEventId to a stable series key and resolves future synthetic instances by series', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        const previousTextEncoder = globalThis.TextEncoder;
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
        globalThis.TextEncoder = TextEncoder;
        try {
            const cache = new agendaCache.CalendarAgendaMemoryCache();
            const [first] = await cache.replace([{
                eventId: 'instance_a', recurringEventId: 'series_1', title: 'Daily', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed',
            }], 1_000);
            expect(first.seriesKey).toBe(createHash('sha256').update('cgc-calendar-series-v1:primary:series_1').digest('hex'));
            expect(JSON.stringify(first)).not.toContain('series_1');

            const store = { schemaVersion: 1, mappings: {} };
            store.mappings[`series:${first.seriesKey}`] = { key: first.seriesKey, scope: 'series', task: { id: 'task_1', name: 'Seguimiento' }, createdAt: 1_000, updatedAt: 1_000 };
            const [future] = await cache.replace([{
                eventId: 'instance_b', recurringEventId: 'series_1', title: 'Daily', start: '2026-08-23T10:00:00Z', end: '2026-08-23T11:00:00Z', allDay: false, status: 'confirmed',
            }], 2_000);
            expect(linking.selectCalendarLinkedTask(store, future.key, future.seriesKey)).toEqual({ id: 'task_1', name: 'Seguimiento' });
        } finally {
            globalThis.TextEncoder = previousTextEncoder;
            if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
        }
    });

    test('normalizes custom task types and rejects arbitrary task type selections', () => {
        const types = linking.sanitizeCustomTaskTypesResponse({ custom_items: [
            { id: 1001, name: 'Meeting' },
            { id: 1001, name: 'Duplicate' },
            { id: 'raw', name: 'Bad' },
            { id: 1002, name: '' },
        ] });
        expect(types).toEqual([{ id: 1001, name: 'Meeting' }]);
        expect(linking.findCustomTaskType(types, 1001)).toEqual({ id: 1001, name: 'Meeting' });
        expect(linking.findCustomTaskType(types, 9999)).toBeNull();
    });

    test('builds one bounded primary-calendar request and never retries failures', async () => {
        const now = new Date('2026-08-21T12:00:00.000Z');
        const calls = [];
        const port = {
            async fetch(url, init) {
                calls.push({ url, init });
                return {
                    status: 200,
                    ok: true,
                    headers: { get: (name) => name === 'content-type' ? 'application/json; charset=utf-8' : null },
                    text: async () => JSON.stringify({ items: [] }),
                };
            },
        };
        await expect(service.readPrimaryCalendarAgenda('synthetic-token', now, port)).resolves.toEqual({ ok: true, events: [] });
        expect(calls).toHaveLength(1);
        const url = new URL(calls[0].url);
        expect(`${url.origin}${url.pathname}`).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false',
            timeMin: '2026-08-21T12:00:00.000Z', timeMax: '2026-08-28T12:00:00.000Z', maxResults: '20',
            fields: 'items(id,summary,status,start(date,dateTime),end(date,dateTime),recurringEventId,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),attendees(self,responseStatus))',
        });
        expect(calls[0].init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error' });
        expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer synthetic-token' });

        const failing = { fetch: jest.fn().mockResolvedValue({ status: 429, ok: false, headers: { get: () => null } }) };
        await expect(service.readPrimaryCalendarAgenda('synthetic-token', now, failing)).resolves.toEqual({ ok: false, code: 'RATE_LIMITED' });
        expect(failing.fetch).toHaveBeenCalledTimes(1);
    });

    test('keeps all Calendar messages extension-only, schema-closed, and background-owned', () => {
        const security = loadTsModule('src/message-security.ts');
        const key = 'a'.repeat(64);
        for (const action of ['getGoogleCalendarAgenda', 'connectGoogleCalendar', 'refreshGoogleCalendarAgenda', 'disconnectGoogleCalendar']) {
            expect(security.isAllowedOriginForAction(action, 'chrome-extension://test/app/app.html')).toBe(true);
            expect(security.isAllowedOriginForAction(action, 'https://meet.google.com/abc-defg-hij')).toBe(false);
            expect(security.hasValidSchema({ action })).toBe(true);
            expect(security.hasValidSchema({ action, extra: true })).toBe(false);
        }
        expect(security.hasValidSchema({ action: 'linkGoogleCalendarEventTask', data: { eventKey: key, taskId: 'task_1', scope: 'occurrence' } })).toBe(true);
        expect(security.hasValidSchema({ action: 'linkGoogleCalendarEventTask', data: { eventKey: key, taskId: 'task_1', scope: 'series', title: 'leak' } })).toBe(false);
        expect(security.hasValidSchema({ action: 'createGoogleCalendarEventTask', data: { eventKey: key, scope: 'series', customItemId: 1001, listId: 'list_1', parentTaskId: 'task_1' } })).toBe(true);
        expect(security.hasValidSchema({ action: 'createGoogleCalendarEventTask', data: { eventKey: key, scope: 'series', customItemId: 1001 } })).toBe(false);
        expect(security.hasValidSchema({ action: 'createGoogleCalendarEventTask', data: { eventKey: key, scope: 'series', customItemId: 1001, listId: 'list_1', calendarId: 'raw' } })).toBe(false);
        expect(security.hasValidSchema({ action: 'openGoogleCalendarMeet', data: { eventKey: key } })).toBe(true);
        expect(security.hasValidSchema({ action: 'openGoogleCalendarMeet', data: { eventKey: key, url: 'https://meet.google.com/abc-defg-hij' } })).toBe(false);

        const background = source('background.ts');
        const block = background.slice(background.indexOf("case 'getGoogleCalendarAgenda':"), background.indexOf("case 'focusedClickUpNavigation':"));
        expect(block).toContain('if (!GOOGLE_CALENDAR_RUNTIME_ENABLED) return disabledCalendarAgendaView()');
        expect(block).toContain('googleCalendarRuntime.connect()');
        expect(block).toContain('googleCalendarRuntime.disconnect()');
        expect(block).not.toMatch(/saveSecureToken|chrome\.storage\.local\.set\([^)]*token/i);
    });

    test('renders a bounded agenda with human-only Meet and task actions while disabled stays closed', () => {
        document.documentElement.innerHTML = source('app/app.html');
        const app = loadTsModule('app/app.ts', {
            '../popup/popup': {},
            '../diagnostics/recorder': { initCausalRecorder: () => undefined },
        });
        const key = 'b'.repeat(64);
        const calls = [];
        const view = app.renderCalendarAgenda({
            state: 'ready', capabilityEnabled: true,
            items: [{ key, title: 'Plan semanal', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed', hasMeet: true }],
        }, { open: (value) => calls.push(['open', value]), link: (value) => calls.push(['link', value]) });
        expect(view.items).toHaveLength(1);
        expect(document.getElementById('calendarAgendaList').textContent).toContain('Plan semanal');
        const buttons = [...document.querySelectorAll('#calendarAgendaList button')];
        buttons.find((button) => button.textContent === 'Abrir Meet').click();
        buttons.find((button) => button.textContent === 'Vincular tarea').click();
        expect(calls).toEqual([['open', key], ['link', key]]);

        app.renderCalendarAgenda({ state: 'ready', capabilityEnabled: false, items: view.items });
        expect(document.getElementById('calendarAgendaList').children).toHaveLength(0);
        expect(document.getElementById('connectGoogleCalendarConnectionPreview').disabled).toBe(true);
        expect(document.getElementById('calendarAgendaState').dataset.state).toBe('disabled');
        expect(source('app/app.ts')).not.toMatch(/getAuthToken|fetch\(/);
        expect(source('app/app.ts')).toContain("WORK_SCHEDULE_STORAGE_KEY = 'cgc-work-schedule-v1'");
    });

    test('hides all-day events by default and renders the linker inline under the selected event only', () => {
        document.documentElement.innerHTML = source('app/app.html');
        const app = loadTsModule('app/app.ts', {
            '../popup/popup': {},
            '../diagnostics/recorder': { initCausalRecorder: () => undefined },
        });
        const key = 'c'.repeat(64);
        const allDayKey = 'd'.repeat(64);
        app.renderCalendarAgenda({
            state: 'ready', capabilityEnabled: true,
            items: [
                { key, title: 'Reunión', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed', hasMeet: true },
                { key: allDayKey, title: 'Bloque', start: '2026-08-22', end: '2026-08-23', allDay: true, status: 'confirmed', hasMeet: false },
            ],
        }, { open: jest.fn(), link: jest.fn() }, { activeEventKey: key, taskTypeName: 'Meeting' });
        expect(document.getElementById('calendarAgendaList').textContent).toContain('1 evento de todo el día oculto');
        expect(document.getElementById('calendarAgendaList').textContent).not.toContain('Bloque');
        const rows = [...document.querySelectorAll('#calendarAgendaList .calendar-agenda-item')];
        expect(rows).toHaveLength(1);
        expect(rows[0].querySelector('.calendar-task-linker-inline')).not.toBeNull();

        app.renderCalendarAgenda({ state: 'ready', capabilityEnabled: true, items: [
            { key, title: 'Reunión', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed', hasMeet: true },
            { key: allDayKey, title: 'Bloque', start: '2026-08-22', end: '2026-08-23', allDay: true, status: 'confirmed', hasMeet: false },
        ] }, { open: jest.fn(), link: jest.fn() }, { showAllDay: true });
        expect(document.getElementById('calendarAgendaList').textContent).toContain('Bloque');
    });

    test('renders persistent agenda/week controls and requires explicit list before Calendar create', () => {
        document.documentElement.innerHTML = source('app/app.html');
        const app = loadTsModule('app/app.ts', {
            '../popup/popup': {},
            '../diagnostics/recorder': { initCausalRecorder: () => undefined },
        });
        const key = 'e'.repeat(64);
        const calls = [];
        app.renderCalendarAgenda({
            state: 'ready', capabilityEnabled: true,
            items: [{ key, title: 'Plan', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed', hasMeet: true }],
        }, { open: jest.fn(), link: jest.fn(), create: (eventKey) => calls.push(eventKey), setView: jest.fn() }, {
            activeEventKey: key,
            activeTab: 'create',
            taskTypeName: 'Meet',
            viewMode: 'week',
            createLists: [{ id: 'list_1', name: 'Reuniones', path: 'Space / Reuniones' }],
        });
        expect(document.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Semana');
        expect(document.querySelectorAll('.calendar-week-day-track')).toHaveLength(7);
        expect(document.querySelectorAll('.calendar-week-time-axis span')).toHaveLength(15);
        const create = [...document.querySelectorAll('#calendarAgendaList button')].find((button) => button.textContent === 'Confirmar creación de tarea');
        expect(create.disabled).toBe(true);

        app.renderCalendarAgenda({
            state: 'ready', capabilityEnabled: true,
            items: [{ key, title: 'Plan', start: '2026-08-22T10:00:00Z', end: '2026-08-22T11:00:00Z', allDay: false, status: 'confirmed', hasMeet: true }],
        }, { open: jest.fn(), link: jest.fn(), create: (eventKey) => calls.push(eventKey), setView: jest.fn() }, {
            activeEventKey: key,
            activeTab: 'create',
            taskTypeName: 'Meet',
            createLists: [{ id: 'list_1', name: 'Reuniones', path: 'Space / Reuniones' }],
            selectedCreateListId: 'list_1',
        });
        const enabledCreate = [...document.querySelectorAll('#calendarAgendaList button')].find((button) => button.textContent === 'Confirmar creación de tarea');
        expect(enabledCreate.disabled).toBe(false);
        enabledCreate.click();
        expect(calls).toEqual([key]);
    });

    test('preserves a safe permission code and enables an explicit reconnect action', () => {
        document.documentElement.innerHTML = source('app/app.html');
        const app = loadTsModule('app/app.ts', {
            '../popup/popup': {},
            '../diagnostics/recorder': { initCausalRecorder: () => undefined },
        });
        const view = app.renderCalendarAgenda({
            state: 'reconnect-required', capabilityEnabled: true, items: [], errorCode: 'PERMISSION_DENIED',
        });

        expect(view.errorCode).toBe('PERMISSION_DENIED');
        expect(document.getElementById('calendarAgendaStateTitle').textContent).toBe('Calendar rechazó la autorización');
        expect(document.getElementById('connectGoogleCalendarConnectionPreview').disabled).toBe(false);
        expect(document.getElementById('connectGoogleCalendarConnectionPreview').textContent).toBe('Reconectar Google Calendar');
    });

    test('the enabled reconnect button invokes the injected OAuth authority exactly once', async () => {
        document.documentElement.innerHTML = source('app/app.html');
        const app = loadTsModule('app/app.ts', {
            '../popup/popup': {},
            '../diagnostics/recorder': { initCausalRecorder: () => undefined },
        });
        const port = {
            getAgenda: jest.fn(async () => ({ state: 'error', capabilityEnabled: true, items: [], errorCode: 'INVALID_RESPONSE' })),
            connect: jest.fn(async () => ({ state: 'disconnected', capabilityEnabled: true, items: [] })),
            refresh: jest.fn(),
            disconnect: jest.fn(),
            searchTasks: jest.fn(),
            linkTask: jest.fn(),
            openMeet: jest.fn(),
        };

        await app.initCalendarAgenda(port);
        const button = document.getElementById('connectGoogleCalendarConnectionPreview');
        expect(button.disabled).toBe(false);
        button.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(port.connect).toHaveBeenCalledTimes(1);
    });

    test('Calendar task creation is background-idempotent and revalidates the destination live', () => {
        const background = source('background.ts');
        expect(background).toContain('calendarTaskCreateInFlight.has(storageKey)');
        expect(background).toContain("throw new Error('CALENDAR_TASK_ALREADY_LINKED')");
        expect(background).toContain('resolveAuthorizedDestination({ listId }');
        expect(background).toContain('await clickupAPI!.getList(destination.listId)');
        expect(background).toContain('liveList.archived === true');
        expect(background).toContain('parentTaskId && (!teamId || !await validateFocusedTask(parentTaskId, teamId))');
        expect(background).toContain('start_date_time: false, due_date: dueDate, due_date_time: false');
        expect(background).toContain('await clickupAPI!.addComment(task.id, meetUrl)');
        expect(background.indexOf('await clickupAPI!.getList(destination.listId)'))
            .toBeLessThan(background.indexOf('await clickupAPI!.createTask(destination.listId'));
    });

    test('both Calendar views keep seven visible day divisions, including empty days', () => {
        const app = source('app/app.ts');
        expect(app).toContain('for (const dayKey of agendaWeekDays())');
        expect(app).toContain("empty.className = 'calendar-day-empty'");
        expect(app).toContain('const days = agendaWeekDays();');
        expect(app).not.toContain('agendaWeekDays(base)');
    });

    test('weekly events use time-positioned title cards and split overlaps into columns', () => {
        const app = source('app/app.ts');
        const styles = source('app/app.css');
        expect(app).toContain('calendarWeekEventPosition(item)');
        expect(app).toContain("event.style.top = `${position.top}px`");
        expect(app).toContain('layoutCalendarWeekEvents');
        expect(app).toContain("event.style.setProperty('--calendar-event-columns', String(columns))");
        expect(styles).toContain('var(--calendar-event-column)');
        expect(styles).toContain('.calendar-event-detail-backdrop');
    });

    test('only exposes the signed-in attendee response needed to dim declined meetings', () => {
        const service = source('src/calendar/google-calendar.service.ts');
        const agenda = source('src/calendar/calendar-agenda.ts');
        const app = source('app/app.ts');
        expect(service).toContain('attendees(self,responseStatus)');
        expect(agenda).toContain('attendee.self !== true');
        expect(agenda).not.toContain('attendee.email');
        expect(app).toContain("item.attendanceStatus === 'declined'");
    });

    test('Calendar and Meet can use the full desktop content width', () => {
        const styles = source('app/app.css');
        expect(styles).toContain('.page-section[data-page="meet"] { max-width: none; }');
    });

    test('distinguishes saved Meet mappings from active or scheduled meetings', () => {
        const html = source('app/app.html');
        const popup = source('popup/popup.ts');
        expect(html).toContain('Vinculaciones guardadas');
        expect(html).toContain('No indican que haya una reunión activa o programada');
        expect(popup).toContain("['Tarea', 'ID', 'Estado', 'Acciones']");
        expect(popup).toContain("action: 'getTaskById'");
        expect(popup).not.toContain('Reunión vinculada ${index + 1}');
    });

    test('the Connection page reflects an already connected read-only Calendar session', () => {
        document.documentElement.innerHTML = source('app/app.html');
        const app = loadTsModule('app/app.ts', {
            '../popup/popup': {},
            '../diagnostics/recorder': { initCausalRecorder: () => undefined },
        });
        app.renderCalendarAgenda({ state: 'ready', capabilityEnabled: true, items: [] });

        const button = document.getElementById('connectGoogleCalendarConnectionPreview');
        expect(button.disabled).toBe(true);
        expect(button.textContent).toBe('Google Calendar conectado');
        expect(document.getElementById('googleDisabledStatus').textContent).toContain('Sincronizado');
        expect(document.getElementById('calendarAgendaStateDetail').textContent).toBe(document.getElementById('googleDisabledStatus').textContent);
        expect(document.getElementById('calendarConnectionLink').hidden).toBe(true);
        expect(document.getElementById('refreshGoogleCalendarAgenda').hidden).toBe(false);
        expect(document.getElementById('refreshGoogleCalendarAgenda').textContent).toBe('Resincronizar calendario');
    });
});
