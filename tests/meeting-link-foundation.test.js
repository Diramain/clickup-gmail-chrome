const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { createHash } = require('crypto');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath, cache = new Map()) {
    const normalized = path.normalize(relativePath);
    if (cache.has(normalized)) return cache.get(normalized).exports;
    const filename = path.join(__dirname, '..', normalized);
    const compiled = ts.transpileModule(source(normalized), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
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

const UUID = '12345678-1234-4234-9234-123456789abc';
const HASH = 'b'.repeat(64);
const ROOM_KEY = 'a'.repeat(64);
const digest = { sha256Hex: async (input) => createHash('sha256').update(input).digest('hex') };

describe('CGC-C12 Fase A meeting link foundation', () => {
    const types = loadTsModule('src/meeting-link/meeting-link.types.ts');
    const ids = loadTsModule('src/calendar/calendar-event-id.ts');
    const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
    const migration = loadTsModule('src/meeting-link/meeting-link-migration.ts');
    const recurrence = loadTsModule('src/meeting-link/meeting-recurrence.ts');
    const recovery = loadTsModule('src/meeting-link/meeting-recovery.ts');
    const availability = loadTsModule('src/calendar/calendar-availability.ts');
    const ui = loadTsModule('src/meeting-link/meeting-ui-state.ts');
    const security = loadTsModule('src/message-security.ts');

    test('feature flags fail closed and journal serialization strips unknown sensitive fields', () => {
        expect(types.sanitizeMeetingFeatureFlags(undefined)).toEqual(types.DEFAULT_MEETING_FEATURE_FLAGS);
        expect(types.sanitizeMeetingFeatureFlags({ calendarIntegrationEnabled: true, calendarWriteEnabled: 'true' })).toEqual({
            schemaVersion: 1,
            calendarIntegrationEnabled: true,
            calendarWriteEnabled: false,
            meetAutoArtifactsEnabled: false,
            meetingRecurrenceEnabled: false,
        });
        const serialized = types.sanitizeMeetingOperationForJournal({
            schemaVersion: 1,
            cgcLinkId: UUID,
            clientRequestId: UUID,
            payloadHash: HASH,
            state: 'repair_required',
            disposition: { calendar: 'pending', conference: 'not_started', clickup: 'not_started', calendarPublish: 'not_started', meetSettings: 'not_started' },
            reason: 'input_required',
            warnings: ['meet_settings_warning', 'not-allowlisted'],
            title: 'Private title',
            attendees: ['person@example.test'],
            createdAt: 1,
            updatedAt: 2,
        });
        expect(JSON.stringify(serialized)).not.toMatch(/Private title|example\.test|attendees|not-allowlisted/);
        expect(serialized.warnings).toEqual(['meet_settings_warning']);
    });

    test('deterministic IDs validate UUID input and avoid sensitive payload material', async () => {
        expect(ids.createCalendarEventId(UUID)).toBe('cgc12345678123442349234123456789abc');
        await expect(ids.createConferenceRequestId(UUID, digest)).resolves.toMatch(/^[a-f0-9]{64}$/);
        await expect(ids.createOccurrenceLinkId({ cgcSeriesLinkId: UUID, recurringEventId: 'evt_1', originalStartTime: '2026-08-15T10:00:00Z' }, digest)).resolves.toMatch(/^occ_[a-f0-9]{48}$/);
        expect(() => ids.createCalendarEventId('not-a-uuid')).toThrow('INVALID_UUID_V4');
    });

    test('store is serialized, idempotent by clientRequestId+payloadHash, and blocks conflicts/limit', async () => {
        const adapter = new storeModule.InMemoryMeetingStoreAdapter();
        const store = new storeModule.MeetingLinkStore(adapter, () => 10);
        const first = await store.beginOperation({ clientRequestId: UUID, payloadHash: HASH, cgcLinkId: UUID });
        const second = await store.beginOperation({ clientRequestId: UUID, payloadHash: HASH, cgcLinkId: UUID });
        const conflict = await store.beginOperation({ clientRequestId: UUID, payloadHash: 'c'.repeat(64), cgcLinkId: '22345678-1234-4234-9234-123456789abc' });
        expect(first).toMatchObject({ ok: true, existing: false });
        expect(second).toMatchObject({ ok: true, existing: true });
        expect(conflict).toEqual({ ok: false, reason: 'conflict' });
        await expect(store.beginOperation({ clientRequestId: '22345678-1234-4234-9234-123456789abc', payloadHash: HASH, cgcLinkId: UUID })).resolves.toEqual({ ok: false, reason: 'conflict' });

        const fullOps = {};
        const requestIndex = {};
        for (let index = 0; index < 200; index += 1) {
            const id = `12345678-1234-4234-9234-${String(index).padStart(12, '0')}`;
            fullOps[id] = { ...first.operation, cgcLinkId: id, clientRequestId: id };
            requestIndex[id] = id;
        }
        const fullStore = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter({ operations: { schemaVersion: 1, revision: 1, operations: fullOps, requestIndex } }));
        await expect(fullStore.beginOperation({ clientRequestId: '32345678-1234-4234-9234-123456789abc', payloadHash: HASH, cgcLinkId: '42345678-1234-4234-9234-123456789abc' })).resolves.toEqual({ ok: false, reason: 'limit_reached' });
    });

    test('storage adapter survives new instances, sanitizes nested PII and rejects corrupt snapshots', async () => {
        const backing = {};
        const storage = {
            async get(keys) { return Object.fromEntries(keys.map((key) => [key, backing[key]])); },
            async set(items) { Object.assign(backing, items); },
        };
        const first = new storeModule.MeetingLinkStore(new storeModule.StorageAreaMeetingStoreAdapter(storage), () => 10);
        await first.beginOperation({ clientRequestId: UUID, payloadHash: HASH, cgcLinkId: UUID });
        const second = new storeModule.MeetingLinkStore(new storeModule.StorageAreaMeetingStoreAdapter(storage), () => 20);
        await expect(second.beginOperation({ clientRequestId: UUID, payloadHash: HASH, cgcLinkId: UUID })).resolves.toMatchObject({ ok: true, existing: true });
        backing.meetingOperationsV1.operations[UUID].calendar = { calendarId: 'cal_1', eventId: 'event_1', title: 'PII title', attendees: ['person@example.test'] };
        const read = await new storeModule.StorageAreaMeetingStoreAdapter(storage).read();
        expect(JSON.stringify(read)).not.toMatch(/PII title|example\.test|attendees/);
        backing.meetingOperationsV1.requestIndex[UUID] = 'bad-link';
        await expect(new storeModule.StorageAreaMeetingStoreAdapter(storage).read()).rejects.toThrow('MEETING_STORE_CORRUPT');
    });

    test('addLink blocks active alias collision and incompatible replacement', async () => {
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        const link = {
            schemaVersion: 2,
            cgcLinkId: UUID,
            source: 'created',
            health: 'healthy',
            googleAccountKey: 'acct_hash',
            calendar: { calendarId: 'cal_1', eventId: 'event_1' },
            meet: { roomKey: ROOM_KEY },
            clickup: { workspaceId: 'team-1', taskId: 'task-1', listId: 'list-1', customItemId: 19 },
            createdAt: 1,
            updatedAt: 2,
        };
        await store.addLink(link);
        await expect(store.addLink({ ...link, cgcLinkId: '22345678-1234-4234-9234-123456789abc' })).rejects.toThrow('MEETING_ROOM_ALIAS_CONFLICT');
        await expect(store.addLink({ ...link, clickup: { ...link.clickup, taskId: 'task-2' } })).rejects.toThrow('MEETING_LINK_REPLACEMENT_CONFLICT');
    });

    test('store sanitizers reject orphan indexes, >200 operations, and missing aliases', () => {
        const op = {
            schemaVersion: 1, cgcLinkId: UUID, clientRequestId: UUID, payloadHash: HASH, state: 'preflight_ok',
            disposition: { calendar: 'not_started', conference: 'not_started', clickup: 'not_started', calendarPublish: 'not_started', meetSettings: 'not_started' },
            warnings: [], createdAt: 1, updatedAt: 1,
        };
        expect(types.sanitizeMeetingOperationsStoreV1({ schemaVersion: 1, revision: 0, operations: { [UUID]: op }, requestIndex: {} }).ok).toBe(false);
        expect(types.sanitizeMeetingOperationsStoreV1({ schemaVersion: 1, revision: 0, operations: { [UUID]: op }, requestIndex: { [UUID]: UUID, ['22345678-1234-4234-9234-123456789abc']: UUID } }).ok).toBe(false);
        const many = Object.fromEntries(Array.from({ length: 201 }, (_, index) => {
            const id = `12345678-1234-4234-9234-${String(index).padStart(12, '0')}`;
            return [id, { ...op, cgcLinkId: id, clientRequestId: id }];
        }));
        expect(types.sanitizeMeetingOperationsStoreV1({ schemaVersion: 1, revision: 0, operations: many, requestIndex: Object.fromEntries(Object.keys(many).map((id) => [id, id])) }).ok).toBe(false);
        const link = { schemaVersion: 2, cgcLinkId: UUID, source: 'created', health: 'healthy', googleAccountKey: 'acct_hash', calendar: { calendarId: 'cal_1', eventId: 'event_1' }, meet: { roomKey: ROOM_KEY }, clickup: { workspaceId: 'team-1', taskId: 'task-1', listId: 'list-1', customItemId: 19 }, createdAt: 1, updatedAt: 2 };
        expect(types.sanitizeMeetingLinksStoreV2({ schemaVersion: 2, revision: 0, links: { [UUID]: link }, roomAliases: {} }).ok).toBe(false);
    });

    test('two storage adapters sharing a storage area do not lose updates silently', async () => {
        const backing = {};
        const storage = { async get(keys) { return Object.fromEntries(keys.map((key) => [key, backing[key]])); }, async set(items) { await Promise.resolve(); Object.assign(backing, items); } };
        const a = new storeModule.MeetingLinkStore(new storeModule.StorageAreaMeetingStoreAdapter(storage), () => 1);
        const b = new storeModule.MeetingLinkStore(new storeModule.StorageAreaMeetingStoreAdapter(storage), () => 2);
        const results = await Promise.all([
            a.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH }),
            b.beginOperation({ clientRequestId: '22345678-1234-4234-9234-123456789abc', cgcLinkId: '32345678-1234-4234-9234-123456789abc', payloadHash: 'c'.repeat(64) }),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'conflict' }]);
        const snapshot = await new storeModule.StorageAreaMeetingStoreAdapter(storage).read();
        expect(Object.keys(snapshot.operations.operations)).toHaveLength(1);
    });

    test('shadow migration is idempotent and resolver prefers V2 before V1 fallback', async () => {
        const v1 = { schemaVersion: 1, mappings: { [ROOM_KEY]: { roomKey: ROOM_KEY, taskId: 'legacy-task', teamId: 'team-1', createdAt: 1, lastUsedAt: 2, enabled: true }, ['c'.repeat(64)]: { roomKey: 'c'.repeat(64), taskId: 'disabled-task', teamId: 'team-1', createdAt: 1, lastUsedAt: 2, enabled: false }, bad: { roomKey: 'bad', taskId: 'x', teamId: 'x', createdAt: 1, lastUsedAt: 2, enabled: true } } };
        const before = JSON.stringify(v1);
        const shadow = migration.migrateLegacyMeetMappingsIdempotently(null, v1, 10);
        expect(migration.migrateLegacyMeetMappingsIdempotently(shadow, v1, 20)).toEqual(shadow);
        expect(JSON.stringify(v1)).toBe(before);
        expect(Object.keys(shadow.mappings)).toHaveLength(2);
        expect(shadow.mappings['c'.repeat(64)].state).toBe('shadowed');
        const newRoom = 'd'.repeat(64);
        const added = migration.migrateLegacyMeetMappingsIdempotently(shadow, { schemaVersion: 1, mappings: { ...v1.mappings, [newRoom]: { roomKey: newRoom, taskId: 'legacy-2', teamId: 'team-1', createdAt: 1, lastUsedAt: 2, enabled: true } } }, 30);
        expect(added.revision).toBe(shadow.revision + 1);
        const oversized = { schemaVersion: 1, mappings: Object.fromEntries(Array.from({ length: 501 }, (_, index) => {
            const roomKey = createHash('sha256').update(`room-${index}`).digest('hex');
            return [roomKey, { roomKey, taskId: `task-${index}`, teamId: 'team-1', createdAt: 1, lastUsedAt: 2, enabled: true }];
        })) };
        expect(Object.keys(migration.migrateLegacyMeetMappingsIdempotently(null, oversized, 10).mappings)).toHaveLength(500);
        const adapter = new storeModule.InMemoryMeetingStoreAdapter();
        const store = new storeModule.MeetingLinkStore(adapter, () => 10);
        await store.addLink({
            schemaVersion: 2,
            cgcLinkId: UUID,
            source: 'created',
            health: 'healthy',
            googleAccountKey: 'acct_hash',
            calendar: { calendarId: 'cal_1', eventId: 'event_1' },
            meet: { roomKey: ROOM_KEY },
            clickup: { workspaceId: 'team-2', taskId: 'v2-task', listId: 'list-1', customItemId: 19 },
            createdAt: 1,
            updatedAt: 2,
        });
        await expect(migration.resolveMeetRoomForTimer({ roomKey: ROOM_KEY, v2Store: store, v1Store: v1 })).resolves.toMatchObject({ source: 'v2', taskId: 'v2-task' });
        await expect(migration.resolveMeetRoomForTimer({ roomKey: 'c'.repeat(64), v2Store: store, v1Store: v1 })).resolves.toBeNull();
    });

    test('recurrence, availability, recovery and UI state are bounded/read-only', () => {
        const occurrences = Array.from({ length: 13 }, (_, index) => ({ startTime: `2026-08-${String(15 + index).padStart(2, '0')}T10:00:00Z` }));
        expect(recurrence.limitRecurrenceWindow(occurrences, '2026-08-15T10:00:00Z')).toMatchObject({ accepted: expect.any(Array), truncated: true, reason: 'max_occurrences' });
        expect(availability.createAvailabilityBatches(Array.from({ length: 51 }, (_, index) => `cal_${index}`))).toHaveLength(2);
        expect(availability.summarizeAvailabilityPartial({ requested: 3, answered: 2, errored: 1 })).toEqual({ partial: true, requested: 3, answered: 2, errored: 1 });
        expect(recovery.classifyRecoveryCandidate({ hasCalendar: true, hasClickUp: false })).toBe('calendar_only');
        expect(recovery.planReadOnlyRecovery([{ state: 'clickup_create_unknown' }])).toEqual({ state: 'repair_required', unresolved: 1, repairPerformed: false });
        expect(ui.deriveMeetingUiState({ flags: { calendarIntegrationEnabled: true, calendarWriteEnabled: false }, operationState: 'preflight_ok' })).toEqual({ status: 'disabled', canCreate: false, integrationBlocked: true });
    });

    test('new meeting actions are extension-only and schema-closed', () => {
        const runtimeId = 'ext-id';
        const popupSender = { id: runtimeId, url: 'chrome-extension://ext-id/popup/popup.html' };
        const gmailSender = { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' };
        const clickupSender = { id: runtimeId, url: 'https://app.clickup.com/t/1' };
        const meetSender = { id: runtimeId, url: 'https://meet.google.com/abc-defg-hij' };
        const valid = (message, sender = popupSender) => security.validateExtensionMessage(message, sender, runtimeId).ok;
        expect(valid({ action: 'beginMeetingLinkCreate', data: { clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH, calendarId: 'cal_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19 } })).toBe(true);
        expect(valid({ action: 'beginMeetingLinkCreate', data: { clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH, calendarId: 'cal_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19, title: 'Private' } })).toBe(false);
        expect(valid({ action: 'previewMeetingLink', data: { clientRequestId: UUID, payloadHash: HASH, nested: { title: 'Private' } } })).toBe(false);
        expect(valid({ action: 'beginMeetingLinkCreate', data: { clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH, calendarId: 'cal_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19 } }, gmailSender)).toBe(false);
        expect(valid({ action: 'beginMeetingLinkCreate', data: { clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH, calendarId: 'cal_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19 } }, clickupSender)).toBe(false);
        expect(valid({ action: 'beginMeetingLinkCreate', data: { clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH, calendarId: 'cal_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19 } }, meetSender)).toBe(false);
        const background = source('background.ts');
        expect(background).toMatch(/case 'getMeetingLinkUiState':[\s\S]{0,120}meetingLinkController\.getUiState\(\)/);
        expect(background).toMatch(/case 'beginMeetingLinkCreate':[\s\S]{0,180}meetingLinkController\.handleWriteAction\(action as MeetingLinkWriteAction\)/);
    });
});

describe('CGC-C12 ClickUp API contracts', () => {
    test('createTask does not auto-retry 429 while read endpoints still use typed custom item/field methods', async () => {
        const apiModule = loadTsModule('src/services/api.service.ts');
        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 429,
            headers: new Headers(),
            json: async () => ({ err: 'rate limited' }),
        });
        const wrapper = new apiModule.ClickUpAPIWrapper('token', new apiModule.ClickUpRateGovernor(async () => undefined));
        await expect(wrapper.createTask('list_1', { name: 'Synthetic', custom_item_id: 19 })).rejects.toThrow('rate limited');
        expect(global.fetch).toHaveBeenCalledTimes(1);
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ custom_items: [] }) });
        await wrapper.getCustomTaskTypes('team_1');
        expect(global.fetch.mock.calls[0][0]).toContain('/team/team_1/custom_item');
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ tasks: [] }) });
        await wrapper.findTasksByExactCustomField('team_1', 'field_1', UUID);
        expect(decodeURIComponent(global.fetch.mock.calls[0][0])).toContain('"operator":"=="');
        global.fetch = originalFetch;
    });
});

describe('CGC-C12 saga mock ports', () => {
    function payload(overrides = {}) {
        return { clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH, calendarId: 'cal_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1', dueDate: 1, estimateMs: 60_000, startTime: '2026-08-15T10:00:00Z', endTime: '2026-08-15T11:00:00Z', attendees: [{ email: 'person@example.test' }], meetSpaceName: 'spaces/synthetic', roomKey: ROOM_KEY, googleAccountKey: 'acct_hash', ...overrides };
    }

    function operationForState(state, overrides = {}) {
        const calendar = { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' };
        const clickup = { workspaceId: 'team_1', taskId: 'task_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' };
        const base = { schemaVersion: 1, cgcLinkId: UUID, clientRequestId: UUID, payloadHash: HASH, state, disposition: { calendar: 'not_started', conference: 'not_started', clickup: 'not_started', calendarPublish: 'not_started', meetSettings: 'not_started' }, warnings: [], createdAt: 1, updatedAt: 1 };
        const byState = {
            preflight_ok: base,
            calendar_create_pending: { ...base, state, disposition: { ...base.disposition, calendar: 'pending' }, calendar },
            calendar_private_created: { ...base, state, disposition: { ...base.disposition, calendar: 'succeeded' }, calendar },
            conference_pending: { ...base, state, disposition: { ...base.disposition, calendar: 'succeeded', conference: 'pending' }, calendar },
            conference_ready: { ...base, state, disposition: { ...base.disposition, calendar: 'succeeded', conference: 'succeeded' }, calendar },
            clickup_create_pending: { ...base, state, disposition: { ...base.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'pending' }, calendar, clickup: { workspaceId: 'team_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } },
            clickup_create_unknown: { ...base, state, disposition: { ...base.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'unknown' }, calendar, clickup: { workspaceId: 'team_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } },
            clickup_created: { ...base, state, disposition: { ...base.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded' }, calendar, clickup },
            calendar_publish_pending: { ...base, state, disposition: { ...base.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'not_started' }, calendar, clickup },
            linked: { ...base, state, disposition: { ...base.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'succeeded' }, calendar, clickup },
            linked_degraded: { ...base, state, disposition: { ...base.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'succeeded' }, calendar, clickup },
            repair_required: { ...base, state, reason: 'calendar_ambiguous', disposition: { ...base.disposition, calendar: 'pending' }, calendar: { calendarId: 'cal_1' } },
            abandoned: { ...base, state, disposition: { ...base.disposition, calendar: 'pending' }, calendar: { eventId: 'event_partial' } },
        };
        return { ...byState[state], ...overrides };
    }

    const flagsOn = { calendarIntegrationEnabled: true, calendarWriteEnabled: true, meetAutoArtifactsEnabled: true, meetingRecurrenceEnabled: false };
    const calendarEvent = { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc', etag: 'etag_1', conferenceStatus: 'success', cgcLinkId: UUID, payloadHash: HASH };
    const publishedEvent = { ...calendarEvent, clickupTaskId: 'task_1', attendeesPublished: true };

    test('A2 transition dispatcher is exhaustive for every durable state', () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const types = loadTsModule('src/meeting-link/meeting-link.types.ts');
        const states = ['preflight_ok', 'calendar_create_pending', 'calendar_private_created', 'conference_pending', 'conference_ready', 'clickup_create_pending', 'clickup_create_unknown', 'clickup_created', 'calendar_publish_pending', 'linked', 'linked_degraded', 'repair_required', 'abandoned'];
        expect(states.every(types.isOperationState)).toBe(true);
        expect(Object.keys(sagaModule.MEETING_OPERATION_TRANSITION_HANDLERS).sort()).toEqual(states.sort());
    });

    test('DBA semantic operation validator accepts every valid durable state and rejects impossible combinations', () => {
        const types = loadTsModule('src/meeting-link/meeting-link.types.ts');
        const states = ['preflight_ok', 'calendar_create_pending', 'calendar_private_created', 'conference_pending', 'conference_ready', 'clickup_create_pending', 'clickup_create_unknown', 'clickup_created', 'calendar_publish_pending', 'linked', 'linked_degraded', 'repair_required', 'abandoned'];
        for (const state of states) {
            const sanitized = types.sanitizeMeetingOperationV1(operationForState(state, { disposition: { ...operationForState(state).disposition, meetSettings: 'unknown' } }));
            expect(sanitized.ok).toBe(true);
            expect(types.validateMeetingOperationSemantics(sanitized.value)).toBe(true);
        }
        for (const impossible of [
            operationForState('clickup_created', { disposition: { calendar: 'not_started', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'not_started', meetSettings: 'not_started' } }),
            operationForState('calendar_publish_pending', { clickup: { workspaceId: 'team_1', listId: 'list_1', customItemId: 19 } }),
            operationForState('linked', { disposition: { calendar: 'not_started', conference: 'not_started', clickup: 'not_started', calendarPublish: 'not_started', meetSettings: 'not_started' } }),
            operationForState('conference_ready', { calendar: undefined }),
        ]) {
            expect(types.sanitizeMeetingOperationV1(impossible)).toEqual({ ok: false, reason: 'storage_conflict' });
        }
    });

    test('Calendar ambiguous create is reconciled by GET and Meet settings becomes warning, not rollback', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        const calendar = {
            insertPrivateEvent: jest.fn().mockRejectedValue({ code: 'TIMEOUT' }),
            getEvent: jest.fn().mockResolvedValue({ calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc', etag: 'etag_1', conferenceStatus: 'success', cgcLinkId: UUID, payloadHash: HASH }),
            patchTaskAndInvite: jest.fn().mockResolvedValue(publishedEvent),
        };
        const clickup = {
            findTasksByExactLink: jest.fn().mockResolvedValue({ count: 0 }),
            createMeetingTask: jest.fn().mockResolvedValue({ taskId: 'task_1' }),
            getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }),
        };
        const meet = { applyAutoArtifacts: jest.fn().mockResolvedValue({ ok: false, reason: 'license_denied' }) };
        const saga = new sagaModule.MeetingCreationSaga(store, calendar, clickup, meet, digest, () => flagsOn);
        await expect(saga.run(payload())).resolves.toEqual({ state: 'linked_degraded', warnings: ['meet_settings_warning'] });
        expect(calendar.patchTaskAndInvite.mock.calls[0][0]).toMatchObject({ sendUpdates: 'all', taskId: 'task_1' });
        await expect(store.resolveRoomAlias(ROOM_KEY)).resolves.toMatchObject({ cgcLinkId: UUID, clickup: { taskId: 'task_1' } });
    });

    test('flags OFF produce no port calls', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const calendar = { insertPrivateEvent: jest.fn(), getEvent: jest.fn(), patchTaskAndInvite: jest.fn() };
        const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn() };
        const meet = { applyAutoArtifacts: jest.fn() };
        const saga = new sagaModule.MeetingCreationSaga(new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter()), calendar, clickup, meet, digest);
        await expect(saga.run(payload())).resolves.toEqual({ state: 'repair_required', warnings: ['disabled_by_flag'] });
        expect(calendar.insertPrivateEvent).not.toHaveBeenCalled();
        expect(clickup.createMeetingTask).not.toHaveBeenCalled();
        expect(meet.applyAutoArtifacts).not.toHaveBeenCalled();
    });

    test('concurrent saga run creates only one task and existing linked replay has no side effects', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        const calendar = { insertPrivateEvent: jest.fn().mockResolvedValue(calendarEvent), getEvent: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn().mockResolvedValue(publishedEvent) };
        const clickup = { findTasksByExactLink: jest.fn().mockResolvedValue({ count: 0 }), createMeetingTask: jest.fn().mockResolvedValue({ taskId: 'task_1' }), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
        const saga = new sagaModule.MeetingCreationSaga(store, calendar, clickup, undefined, digest, () => flagsOn);
        const result = await Promise.all([saga.run(payload()), saga.run(payload())]);
        expect(result.some((item) => item.state === 'linked')).toBe(true);
        expect(clickup.createMeetingTask).toHaveBeenCalledTimes(1);
        await saga.run(payload());
        expect(clickup.createMeetingTask).toHaveBeenCalledTimes(1);
    });

    test('ClickUp ambiguous create and replay 0/1/>1 never perform a second create', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const makeSaga = (match) => {
            const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
            const calendar = { insertPrivateEvent: jest.fn().mockResolvedValue(calendarEvent), getEvent: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn().mockResolvedValue(publishedEvent) };
            const clickup = { findTasksByExactLink: jest.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValue(match), createMeetingTask: jest.fn().mockRejectedValue({ code: 'TIMEOUT' }), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
            return { saga: new sagaModule.MeetingCreationSaga(store, calendar, clickup, undefined, digest, () => flagsOn), clickup };
        };
        for (const match of [{ count: 0 }, { count: 1, taskId: 'task_1' }, { count: 2 }]) {
            const { saga, clickup } = makeSaga(match);
            await expect(saga.run(payload())).resolves.toMatchObject({ state: 'clickup_create_unknown' });
            await saga.run(payload());
            expect(clickup.createMeetingTask).toHaveBeenCalledTimes(1);
        }
    });

    test('conference pending/failure and ClickUp read-back mismatches never invite', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        for (const conferenceStatus of ['pending', 'failure']) {
            const calendar = { insertPrivateEvent: jest.fn().mockResolvedValue({ calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc', etag: 'etag_1', conferenceStatus, cgcLinkId: UUID, payloadHash: HASH }), getEvent: jest.fn().mockResolvedValue({ calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc', conferenceStatus, cgcLinkId: UUID, payloadHash: HASH }), patchTaskAndInvite: jest.fn() };
            const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn() };
            const saga = new sagaModule.MeetingCreationSaga(new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter()), calendar, clickup, undefined, digest, () => flagsOn, async (read) => read());
            await expect(saga.run(payload())).resolves.toMatchObject({ state: 'repair_required' });
            expect(clickup.createMeetingTask).not.toHaveBeenCalled();
            expect(calendar.patchTaskAndInvite).not.toHaveBeenCalled();
        }
        const calendar = { insertPrivateEvent: jest.fn().mockResolvedValue(calendarEvent), getEvent: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn() };
        for (const readBack of [
            { taskId: 'other', listId: 'list_1', customItemId: 19, linkValue: UUID },
            { taskId: 'task_1', listId: 'other', customItemId: 19, linkValue: UUID },
            { taskId: 'task_1', listId: 'list_1', customItemId: 99, linkValue: UUID },
            { taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: 'other' },
        ]) {
            const clickup = { findTasksByExactLink: jest.fn().mockResolvedValue({ count: 0 }), createMeetingTask: jest.fn().mockResolvedValue({ taskId: 'task_1' }), getTask: jest.fn().mockResolvedValue(readBack) };
            const saga = new sagaModule.MeetingCreationSaga(new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter()), calendar, clickup, undefined, digest, () => flagsOn);
            await expect(saga.run(payload())).resolves.toMatchObject({ state: 'repair_required' });
            expect(calendar.patchTaskAndInvite).not.toHaveBeenCalled();
        }
    });

    test('uppercase UUID/hash normalize and restart from durable states without repeated creates', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const make = async (operationState, opPatch = {}) => {
            const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
            await store.beginOperation({ clientRequestId: UUID.toUpperCase(), cgcLinkId: UUID.toUpperCase(), payloadHash: HASH.toUpperCase() });
            await store.updateOperation(UUID.toUpperCase(), (op) => ({ ...op, state: operationState, ...opPatch }));
            const calendar = { getEvent: jest.fn().mockResolvedValue(publishedEvent), insertPrivateEvent: jest.fn().mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn().mockResolvedValue(publishedEvent) };
            const clickup = { findTasksByExactLink: jest.fn().mockResolvedValue({ count: 1, taskId: 'task_1' }), createMeetingTask: jest.fn(), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
            return { saga: new sagaModule.MeetingCreationSaga(store, calendar, clickup, undefined, digest, () => flagsOn), calendar, clickup, store };
        };
        for (const [state, patch] of [
            ['calendar_create_pending', { disposition: { calendar: 'pending', conference: 'not_started', clickup: 'not_started', calendarPublish: 'not_started', meetSettings: 'not_started' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' } }],
            ['conference_pending', { disposition: { calendar: 'succeeded', conference: 'pending', clickup: 'not_started', calendarPublish: 'not_started', meetSettings: 'not_started' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' } }],
            ['clickup_created', { disposition: { calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'not_started', meetSettings: 'not_started' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, clickup: { taskId: 'task_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } }],
            ['calendar_publish_pending', { disposition: { calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'not_started', meetSettings: 'not_started' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, clickup: { taskId: 'task_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } }],
        ]) {
            const { saga, calendar, clickup } = await make(state, patch);
            await expect(saga.run(payload({ clientRequestId: UUID.toUpperCase(), cgcLinkId: UUID.toUpperCase(), payloadHash: HASH.toUpperCase() }))).resolves.toMatchObject({ state: 'linked' });
            expect(clickup.createMeetingTask).not.toHaveBeenCalled();
            if (state === 'calendar_publish_pending') expect(calendar.patchTaskAndInvite).toHaveBeenCalledTimes(1);
        }
    });

    test('post-create readback failure is terminal repair and patch pending/unknown never repatches', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        const calendar = { insertPrivateEvent: jest.fn().mockResolvedValue(calendarEvent), getEvent: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn().mockRejectedValue(new Error('ambiguous')) };
        const clickup = { findTasksByExactLink: jest.fn().mockResolvedValue({ count: 0 }), createMeetingTask: jest.fn().mockResolvedValue({ taskId: 'task_1' }), getTask: jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
        const saga = new sagaModule.MeetingCreationSaga(store, calendar, clickup, undefined, digest, () => flagsOn);
        await expect(saga.run(payload())).resolves.toMatchObject({ state: 'repair_required', warnings: ['provider_unavailable'] });
        await expect(saga.run(payload())).resolves.toMatchObject({ state: 'repair_required', warnings: ['provider_unavailable'] });
        expect(clickup.createMeetingTask).toHaveBeenCalledTimes(1);
        expect(calendar.patchTaskAndInvite).not.toHaveBeenCalled();

        for (const calendarPublish of ['pending', 'unknown']) {
            const resumeStore = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
            await resumeStore.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
            await resumeStore.updateOperation(UUID, (op) => ({ ...op, state: 'calendar_publish_pending', disposition: { ...op.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, clickup: { workspaceId: 'team_1', taskId: 'task_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } }));
            const resumeCalendar = { insertPrivateEvent: jest.fn(), getEvent: jest.fn().mockResolvedValue({ ...calendarEvent, clickupTaskId: 'task_1', attendeesPublished: true }), patchTaskAndInvite: jest.fn() };
            const resumeClickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
            await expect(new sagaModule.MeetingCreationSaga(resumeStore, resumeCalendar, resumeClickup, undefined, digest, () => flagsOn).run(payload())).resolves.toMatchObject({ state: 'linked' });
            expect(resumeCalendar.patchTaskAndInvite).not.toHaveBeenCalled();
        }
    });

    test('publish not_started closes only with applied Calendar evidence', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        for (const [patchResult, expected] of [
            [{}, 'repair_required'],
            [{ ...calendarEvent, clickupTaskId: 'other', attendeesPublished: true }, 'repair_required'],
            [publishedEvent, 'linked'],
        ]) {
            const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
            await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
            await store.updateOperation(UUID, (op) => ({ ...op, state: 'calendar_publish_pending', disposition: { ...op.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'not_started' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, clickup: { workspaceId: 'team_1', taskId: 'task_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } }));
            const calendar = { insertPrivateEvent: jest.fn(), getEvent: jest.fn().mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn().mockResolvedValue(patchResult) };
            const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
            await expect(new sagaModule.MeetingCreationSaga(store, calendar, clickup, undefined, digest, () => flagsOn).run(payload())).resolves.toMatchObject({ state: expected });
            const link = await store.getLink(UUID);
            if (expected === 'linked') expect(link).toBeTruthy();
            else expect(link).toBeNull();
        }
    });

    test('no link field with recurrence off degrades after one create and ambiguous replay never reposts', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const noFieldPayload = payload({ linkFieldId: undefined });
        const calendar = { insertPrivateEvent: jest.fn().mockResolvedValue(calendarEvent), getEvent: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn().mockResolvedValue(publishedEvent) };
        const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn().mockResolvedValue({ taskId: 'task_1' }), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19 }) };
        await expect(new sagaModule.MeetingCreationSaga(new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter()), calendar, clickup, undefined, digest, () => flagsOn).run(noFieldPayload)).resolves.toEqual({ state: 'linked_degraded', warnings: ['custom_field_ignored'] });
        expect(clickup.findTasksByExactLink).not.toHaveBeenCalled();
        expect(clickup.createMeetingTask).toHaveBeenCalledTimes(1);

        const replayStore = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        await replayStore.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
        await replayStore.updateOperation(UUID, (op) => ({ ...op, state: 'clickup_create_unknown', disposition: { ...op.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'unknown' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, clickup: { workspaceId: 'team_1', listId: 'list_1', customItemId: 19 } }));
        const replayClickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn() };
        await expect(new sagaModule.MeetingCreationSaga(replayStore, { insertPrivateEvent: jest.fn(), getEvent: jest.fn(), patchTaskAndInvite: jest.fn() }, replayClickup, undefined, digest, () => flagsOn).run(noFieldPayload)).resolves.toMatchObject({ state: 'repair_required', warnings: ['clickup_anchor_missing'] });
        expect(replayClickup.createMeetingTask).not.toHaveBeenCalled();
    });

    test('no link field with recurrence on blocks before POST', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
        await store.updateOperation(UUID, (op) => ({ ...op, state: 'conference_ready', disposition: { ...op.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'not_started' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' } }));
        const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn() };
        await expect(new sagaModule.MeetingCreationSaga(store, { insertPrivateEvent: jest.fn(), getEvent: jest.fn().mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn() }, clickup, undefined, digest, () => ({ ...flagsOn, meetingRecurrenceEnabled: true })).run(payload({ linkFieldId: undefined }))).resolves.toMatchObject({ state: 'repair_required', warnings: ['clickup_anchor_missing'] });
        expect(clickup.createMeetingTask).not.toHaveBeenCalled();
    });

    test('existing link closes unfinished operation and Meet settings throw only warns', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
        await store.addLink({ schemaVersion: 2, cgcLinkId: UUID, source: 'created', health: 'healthy', googleAccountKey: 'acct_hash', calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, meet: { roomKey: ROOM_KEY, spaceName: 'spaces/synthetic' }, clickup: { workspaceId: 'team_1', taskId: 'task_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' }, createdAt: 1, updatedAt: 1 });
        const ports = { insertPrivateEvent: jest.fn(), getEvent: jest.fn(), patchTaskAndInvite: jest.fn() };
        const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn() };
        const saga = new sagaModule.MeetingCreationSaga(store, ports, clickup, undefined, digest, () => flagsOn);
        await expect(saga.run(payload())).resolves.toMatchObject({ state: 'linked' });
        expect(ports.insertPrivateEvent).not.toHaveBeenCalled();
        await expect(store.getOperation(UUID)).resolves.toMatchObject({ disposition: { calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'succeeded', meetSettings: 'not_started' } });

        const store2 = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        const calendar = { insertPrivateEvent: jest.fn().mockResolvedValue(calendarEvent), getEvent: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn().mockResolvedValue(publishedEvent) };
        const clickup2 = { findTasksByExactLink: jest.fn().mockResolvedValue({ count: 0 }), createMeetingTask: jest.fn().mockResolvedValue({ taskId: 'task_1' }), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
        const meet = { applyAutoArtifacts: jest.fn().mockRejectedValue(new Error('settings')) };
        const saga2 = new sagaModule.MeetingCreationSaga(store2, calendar, clickup2, meet, digest, () => flagsOn);
        await expect(saga2.run(payload())).resolves.toEqual({ state: 'linked_degraded', warnings: ['meet_settings_warning'] });
        await expect(saga2.run(payload())).resolves.toMatchObject({ state: 'linked_degraded' });
        expect(meet.applyAutoArtifacts).toHaveBeenCalledTimes(1);
    });

    test('invalid attendees or times fail before any port call', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const calendar = { insertPrivateEvent: jest.fn(), getEvent: jest.fn(), patchTaskAndInvite: jest.fn() };
        const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn() };
        const saga = new sagaModule.MeetingCreationSaga(new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter()), calendar, clickup, undefined, digest, () => flagsOn);
        for (const bad of [payload({ attendees: [{ email: 'person@example.test', name: 'PII' }] }), payload({ attendees: 'not-array' }), payload({ startTime: '2026-08-15T11:00:00Z', endTime: '2026-08-15T10:00:00Z' }), payload({ estimateMs: 366 * 24 * 60 * 60 * 1000 })]) {
            await expect(saga.run(bad)).resolves.toMatchObject({ state: 'repair_required', warnings: ['payload_mismatch'] });
        }
        expect(calendar.insertPrivateEvent).not.toHaveBeenCalled();
        expect(clickup.createMeetingTask).not.toHaveBeenCalled();
    });

    test('restart conference_pending with ClickUp not_started creates once after exact search 0', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
        await store.updateOperation(UUID, (op) => ({ ...op, state: 'conference_pending', calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, disposition: { ...op.disposition, calendar: 'succeeded', conference: 'pending', clickup: 'not_started' } }));
        const calendar = { insertPrivateEvent: jest.fn(), getEvent: jest.fn().mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn().mockResolvedValue(publishedEvent) };
        const clickup = { findTasksByExactLink: jest.fn().mockResolvedValue({ count: 0 }), createMeetingTask: jest.fn().mockResolvedValue({ taskId: 'task_1' }), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
        const saga = new sagaModule.MeetingCreationSaga(store, calendar, clickup, undefined, digest, () => flagsOn);
        await expect(saga.run(payload())).resolves.toMatchObject({ state: 'linked' });
        expect(clickup.findTasksByExactLink).toHaveBeenCalledTimes(1);
        expect(clickup.createMeetingTask).toHaveBeenCalledTimes(1);
    });

    test('A2 blocker calendar_create_pending with valid Calendar and exact match 0 links with exactly one create', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
        await store.updateOperation(UUID, (op) => ({ ...op, state: 'calendar_create_pending', calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, disposition: { ...op.disposition, calendar: 'pending', clickup: 'not_started' } }));
        const calendar = { insertPrivateEvent: jest.fn(), getEvent: jest.fn().mockResolvedValue(calendarEvent), patchTaskAndInvite: jest.fn().mockResolvedValue(publishedEvent) };
        const clickup = { findTasksByExactLink: jest.fn().mockResolvedValue({ count: 0 }), createMeetingTask: jest.fn().mockResolvedValue({ taskId: 'task_1' }), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
        const saga = new sagaModule.MeetingCreationSaga(store, calendar, clickup, undefined, digest, () => flagsOn);
        await expect(saga.run(payload())).resolves.toMatchObject({ state: 'linked' });
        expect(calendar.insertPrivateEvent).not.toHaveBeenCalled();
        expect(clickup.findTasksByExactLink).toHaveBeenCalledTimes(1);
        expect(clickup.createMeetingTask).toHaveBeenCalledTimes(1);
    });

    test('no-progress transition fails closed at loop guard without side effects', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
        await store.updateOperation(UUID, (op) => ({ ...op, state: 'conference_pending', calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, disposition: { ...op.disposition, calendar: 'succeeded', conference: 'pending', clickup: 'not_started' } }));
        const calendar = { insertPrivateEvent: jest.fn(), getEvent: jest.fn().mockResolvedValue({ ...calendarEvent, conferenceStatus: 'pending' }), patchTaskAndInvite: jest.fn() };
        const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn() };
        const saga = new sagaModule.MeetingCreationSaga(store, calendar, clickup, undefined, digest, () => flagsOn, async (read) => read());
        await expect(saga.run(payload())).resolves.toEqual({ state: 'repair_required', warnings: ['limit_reached'], requiresReentry: undefined });
        expect(clickup.createMeetingTask).not.toHaveBeenCalled();
        expect(calendar.patchTaskAndInvite).not.toHaveBeenCalled();
    });

    test('restart clickup pending with search 0 never creates', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
        await store.updateOperation(UUID, (op) => ({ ...op, state: 'clickup_create_pending', disposition: { ...op.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'pending' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, clickup: { workspaceId: 'team_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } }));
        const clickup = { findTasksByExactLink: jest.fn().mockResolvedValue({ count: 0 }), createMeetingTask: jest.fn(), getTask: jest.fn() };
        const saga = new sagaModule.MeetingCreationSaga(store, { insertPrivateEvent: jest.fn(), getEvent: jest.fn(), patchTaskAndInvite: jest.fn() }, clickup, undefined, digest, () => flagsOn);
        await expect(saga.run(payload())).resolves.toMatchObject({ state: 'repair_required', warnings: ['clickup_ambiguous'] });
        expect(clickup.createMeetingTask).not.toHaveBeenCalled();
    });

    test('terminal linked without compatible link repairs and impossible operations cannot persist', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const linkedStore = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        await linkedStore.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
        await linkedStore.updateOperation(UUID, (op) => ({ ...op, ...operationForState('linked') }));
        const calendar = { insertPrivateEvent: jest.fn(), getEvent: jest.fn(), patchTaskAndInvite: jest.fn() };
        const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn() };
        await expect(new sagaModule.MeetingCreationSaga(linkedStore, calendar, clickup, undefined, digest, () => flagsOn).run(payload())).resolves.toMatchObject({ state: 'repair_required', warnings: ['storage_conflict'] });
        expect(calendar.getEvent).not.toHaveBeenCalled();
        expect(clickup.createMeetingTask).not.toHaveBeenCalled();

        for (const opPatch of [
            { state: 'clickup_created', disposition: { calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'not_started', meetSettings: 'not_started' }, clickup: { workspaceId: 'team_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } },
            { state: 'calendar_publish_pending', disposition: { calendar: 'not_started', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'not_started', meetSettings: 'not_started' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, clickup: { taskId: 'task_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } },
            { state: 'conference_ready', disposition: { calendar: 'succeeded', conference: 'pending', clickup: 'not_started', calendarPublish: 'not_started', meetSettings: 'not_started' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' } },
        ]) {
            const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
            await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
            await expect(store.updateOperation(UUID, (op) => ({ ...op, ...opPatch }))).rejects.toThrow('INVALID_MEETING_OPERATION_JOURNAL');
        }
    });

    test('publish pending requires Calendar applied and valid ClickUp read-back, without repatch', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        for (const badTask of [null, { taskId: 'task_1', listId: 'wrong', customItemId: 19, linkValue: UUID }]) {
            const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
            await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
            await store.updateOperation(UUID, (op) => ({ ...op, state: 'calendar_publish_pending', disposition: { ...op.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'not_started' }, calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, clickup: { taskId: 'task_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 19, linkFieldId: 'field_1' } }));
            const calendar = { insertPrivateEvent: jest.fn(), getEvent: jest.fn().mockResolvedValue({ calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc', cgcLinkId: UUID, payloadHash: HASH, clickupTaskId: 'task_1', attendeesPublished: true }), patchTaskAndInvite: jest.fn() };
            const clickup = { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn().mockResolvedValue(badTask) };
            const saga = new sagaModule.MeetingCreationSaga(store, calendar, clickup, undefined, digest, () => flagsOn);
            await expect(saga.run(payload())).resolves.toMatchObject({ state: 'repair_required' });
            expect(calendar.patchTaskAndInvite).not.toHaveBeenCalled();
            expect(clickup.createMeetingTask).not.toHaveBeenCalled();
        }
    });

    test('existing incompatible link and cross-account replacement are blocked', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        const store = new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter(), () => 10);
        const link = { schemaVersion: 2, cgcLinkId: UUID, source: 'created', health: 'healthy', googleAccountKey: 'other_acct', calendar: { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc' }, meet: { roomKey: ROOM_KEY }, clickup: { workspaceId: 'team_1', taskId: 'task_1', listId: 'list_1', customItemId: 19, parentTaskId: 'parent_1', linkFieldId: 'field_1' }, createdAt: 1, updatedAt: 1 };
        await store.beginOperation({ clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH });
        await store.addLink(link);
        const saga = new sagaModule.MeetingCreationSaga(store, { insertPrivateEvent: jest.fn(), getEvent: jest.fn(), patchTaskAndInvite: jest.fn() }, { findTasksByExactLink: jest.fn(), createMeetingTask: jest.fn(), getTask: jest.fn() }, undefined, digest, () => flagsOn);
        await expect(saga.run(payload({ parentTaskId: 'parent_1' }))).resolves.toMatchObject({ state: 'repair_required', warnings: ['storage_conflict'] });
        await expect(store.addLink({ ...link, googleAccountKey: 'acct_hash' })).rejects.toThrow('MEETING_LINK_REPLACEMENT_CONFLICT');
    });

    test('insert 5xx always reconciles by deterministic GET', async () => {
        const sagaModule = loadTsModule('src/meeting-link/meeting-create.saga.ts');
        const storeModule = loadTsModule('src/meeting-link/meeting-link.store.ts');
        for (const found of [null, { calendarId: 'cal_1', eventId: 'cgc12345678123442349234123456789abc', etag: 'etag_1', conferenceStatus: 'success', cgcLinkId: UUID, payloadHash: HASH }]) {
            const calendar = { insertPrivateEvent: jest.fn().mockRejectedValue({ status: 500 }), getEvent: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(found), patchTaskAndInvite: jest.fn().mockResolvedValue(publishedEvent) };
            const clickup = { findTasksByExactLink: jest.fn().mockResolvedValue({ count: 0 }), createMeetingTask: jest.fn().mockResolvedValue({ taskId: 'task_1' }), getTask: jest.fn().mockResolvedValue({ taskId: 'task_1', listId: 'list_1', customItemId: 19, linkValue: UUID }) };
            const saga = new sagaModule.MeetingCreationSaga(new storeModule.MeetingLinkStore(new storeModule.InMemoryMeetingStoreAdapter()), calendar, clickup, undefined, digest, () => flagsOn);
            await expect(saga.run(payload())).resolves.toMatchObject(found ? { state: 'linked' } : { state: 'repair_required', warnings: ['calendar_ambiguous'] });
            expect(calendar.getEvent).toHaveBeenCalledTimes(found ? 5 : 2);
        }
    });
});
