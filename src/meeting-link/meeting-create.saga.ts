import { CalendarEventRecord, CalendarPort, ClickUpMeetingPort, MeetSettingsPort } from '../calendar/calendar-ports';
import { createCalendarEventId, createConferenceRequestId, DigestProvider } from '../calendar/calendar-event-id';
import { MeetingLinkStore } from './meeting-link.store';
import { MeetingFeatureFlagsV1, MeetingLinkV2, MeetingOperationState, MeetingOperationV1, MeetingReasonCode, StepDisposition, isBoundedOpaqueId, isCgcUuid, isMeetSpaceName, isPayloadHash, isRoomKey, sanitizeMeetingFeatureFlags, validateMeetingOperationSemantics } from './meeting-link.types';

export interface MeetingCreationPayload {
    clientRequestId: string;
    cgcLinkId: string;
    payloadHash: string;
    calendarId: string;
    workspaceId: string;
    listId: string;
    customItemId: number;
    linkFieldId?: string;
    dueDate: number;
    estimateMs: number;
    startTime: string;
    endTime: string;
    attendees?: readonly unknown[];
    meetSpaceName?: string;
    roomKey?: string;
    googleAccountKey: string;
    parentTaskId?: string;
}

export type SagaResult = { state: MeetingOperationState; warnings: string[]; requiresReentry?: boolean };
export type SagaPoller = (read: () => Promise<CalendarEventRecord | null>) => Promise<CalendarEventRecord | null>;

type TransitionOutcome = { kind: 'continue' } | { kind: 'terminal'; result: SagaResult } | { kind: 'blocked'; reason: MeetingReasonCode; disposition?: Partial<Record<keyof MeetingOperationV1['disposition'], StepDisposition>>; clickup?: { taskId?: string; exactMatches?: number; existing?: MeetingOperationV1['clickup'] }; requiresReentry?: boolean };
type HandlerName = MeetingOperationState;
type Handler = (operation: MeetingOperationV1, payload: MeetingCreationPayload) => Promise<TransitionOutcome>;

const MAX_TRANSITIONS = 16;

export const MEETING_OPERATION_TRANSITION_HANDLERS: Record<HandlerName, true> = {
    preflight_ok: true,
    calendar_create_pending: true,
    calendar_private_created: true,
    conference_pending: true,
    conference_ready: true,
    clickup_create_pending: true,
    clickup_create_unknown: true,
    clickup_created: true,
    calendar_publish_pending: true,
    linked: true,
    linked_degraded: true,
    repair_required: true,
    abandoned: true,
};

export class MeetingCreationSaga {
    private flags: MeetingFeatureFlagsV1 = sanitizeMeetingFeatureFlags(undefined);
    private runQueue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly store: MeetingLinkStore,
        private readonly calendar: CalendarPort,
        private readonly clickup: ClickUpMeetingPort,
        private readonly meetSettings?: MeetSettingsPort,
        private readonly digest?: DigestProvider,
        private readonly flagsProvider: (() => unknown) = () => undefined,
        private readonly pollConference: SagaPoller = async (read) => read(),
    ) {}

    async run(input: MeetingCreationPayload | null): Promise<SagaResult> {
        return this.serializedRun(() => this.runInternal(input));
    }

    private async runInternal(input: MeetingCreationPayload | null): Promise<SagaResult> {
        this.flags = sanitizeMeetingFeatureFlags(this.flagsProvider());
        if (!this.flags.calendarIntegrationEnabled || !this.flags.calendarWriteEnabled) return { state: 'repair_required', warnings: ['disabled_by_flag'] };
        const payloadValidation = validatePayload(input);
        if (!payloadValidation.ok) return { state: 'repair_required', warnings: [payloadValidation.reason], requiresReentry: payloadValidation.reason === 'input_required' || payloadValidation.reason === 'payload_mismatch' };
        const payload = payloadValidation.payload;
        const begin = await this.store.beginOperation({ clientRequestId: payload.clientRequestId, payloadHash: payload.payloadHash, cgcLinkId: payload.cgcLinkId });
        if (!begin.ok) return { state: 'repair_required', warnings: [begin.reason] };
        return this.runTransitionLoop(payload);
    }

    private serializedRun<T>(work: () => Promise<T>): Promise<T> {
        const next = this.runQueue.then(work, work);
        this.runQueue = next.catch(() => undefined);
        return next;
    }

    private async runTransitionLoop(payload: MeetingCreationPayload): Promise<SagaResult> {
        const handlers = this.handlers();
        for (let index = 0; index < MAX_TRANSITIONS; index += 1) {
            const operation = await this.store.getOperation(payload.cgcLinkId);
            const link = await this.store.getLink(payload.cgcLinkId);
            if (!operation) return { state: 'repair_required', warnings: ['storage_conflict'] };
            if (operation.payloadHash !== payload.payloadHash) return { state: 'repair_required', warnings: ['payload_mismatch'], requiresReentry: true };
            if (link) {
                const closed = await this.closeFromExistingLink(payload, link, operation.warnings || []);
                if (closed.kind !== 'continue') return outcomeToResult(closed);
            }
            if (!validateMeetingOperationSemantics(operation) || ((operation.state === 'linked' || operation.state === 'linked_degraded') && !link)) {
                const blocked = await this.blocked('storage_conflict');
                await this.persistBlocked(payload.cgcLinkId, operation, blocked);
                return outcomeToResult(blocked);
            }
            const handler = handlers[operation.state] || this.unsupportedState;
            const before = operationSignature(operation);
            const outcome = await handler(operation, payload);
            if (outcome.kind === 'blocked') {
                await this.persistBlocked(payload.cgcLinkId, operation, outcome);
                return outcomeToResult(outcome);
            }
            if (outcome.kind !== 'continue') return outcomeToResult(outcome);
            const after = await this.store.getOperation(payload.cgcLinkId);
            if (!after || operationSignature(after) === before) {
                const blocked = await this.blocked('limit_reached');
                await this.persistBlocked(payload.cgcLinkId, operation, blocked);
                return outcomeToResult(blocked);
            }
        }
        const operation = await this.store.getOperation(payload.cgcLinkId);
        const blocked = await this.blocked('limit_reached');
        if (operation) await this.persistBlocked(payload.cgcLinkId, operation, blocked);
        return outcomeToResult(blocked);
    }

    private handlers(): Record<MeetingOperationState, Handler> {
        return {
            preflight_ok: (operation, payload) => this.preflightOk(operation, payload),
            calendar_create_pending: (operation, payload) => this.calendarCreatePending(operation, payload),
            calendar_private_created: (operation, payload) => this.calendarPrivateCreated(operation, payload),
            conference_pending: (operation, payload) => this.conferencePending(operation, payload),
            conference_ready: (operation, payload) => this.conferenceReady(operation, payload),
            clickup_create_pending: (operation, payload) => this.reconcileClickUp(operation, payload),
            clickup_create_unknown: (operation, payload) => this.reconcileClickUp(operation, payload),
            clickup_created: (operation, payload) => this.clickupCreated(operation, payload),
            calendar_publish_pending: (operation, payload) => this.calendarPublishPending(operation, payload),
            linked: (operation) => Promise.resolve({ kind: 'terminal', result: { state: operation.state, warnings: operation.warnings || [] } }),
            linked_degraded: (operation) => Promise.resolve({ kind: 'terminal', result: { state: operation.state, warnings: operation.warnings || [] } }),
            repair_required: (operation) => Promise.resolve({ kind: 'terminal', result: { state: 'repair_required', warnings: operation.reason ? [operation.reason] : operation.warnings || [] } }),
            abandoned: () => Promise.resolve({ kind: 'terminal', result: { state: 'abandoned', warnings: [] } }),
        };
    }

    private unsupportedState = async (): Promise<TransitionOutcome> => this.blocked('storage_conflict');

    private async preflightOk(_operation: MeetingOperationV1, payload: MeetingCreationPayload): Promise<TransitionOutcome> {
        const eventId = createCalendarEventId(payload.cgcLinkId);
        await this.store.updateOperation(payload.cgcLinkId, (operation) => ({
            ...operation,
            state: 'calendar_create_pending',
            disposition: { ...operation.disposition, calendar: 'pending' },
            calendar: { calendarId: payload.calendarId, eventId },
        }));
        return { kind: 'continue' };
    }

    private async calendarCreatePending(operation: MeetingOperationV1, payload: MeetingCreationPayload): Promise<TransitionOutcome> {
        const eventId = operation.calendar?.eventId || createCalendarEventId(payload.cgcLinkId);
        const found = await this.calendar.getEvent(payload.calendarId, eventId);
        if (isMatchingCalendarRecord(found, payload, eventId)) return this.persistCalendarPrivateCreated(payload, found);
        const conferenceRequestId = await createConferenceRequestId(payload.cgcLinkId, this.digest);
        try {
            const inserted = await this.calendar.insertPrivateEvent({ ...payload, eventId, conferenceRequestId });
            if (!isMatchingCalendarRecord(inserted, payload, eventId)) return this.blocked('calendar_ambiguous', { conference: 'unknown' });
            return this.persistCalendarPrivateCreated(payload, inserted);
        } catch {
            const retryFound = await this.calendar.getEvent(payload.calendarId, eventId);
            if (isMatchingCalendarRecord(retryFound, payload, eventId)) return this.persistCalendarPrivateCreated(payload, retryFound);
            return this.blocked('calendar_ambiguous');
        }
    }

    private async calendarPrivateCreated(operation: MeetingOperationV1, payload: MeetingCreationPayload): Promise<TransitionOutcome> {
        const eventId = operation.calendar?.eventId || createCalendarEventId(payload.cgcLinkId);
        const event = await this.calendar.getEvent(payload.calendarId, eventId);
        if (!isMatchingCalendarRecord(event, payload, eventId)) return this.blocked('calendar_ambiguous', { conference: 'unknown' });
        return this.persistConferenceState(payload, event);
    }

    private async conferencePending(operation: MeetingOperationV1, payload: MeetingCreationPayload): Promise<TransitionOutcome> {
        const eventId = operation.calendar?.eventId || createCalendarEventId(payload.cgcLinkId);
        const event = await this.pollConference(() => this.calendar.getEvent(payload.calendarId, eventId));
        if (!isMatchingCalendarRecord(event, payload, eventId)) return this.blocked('calendar_ambiguous', { conference: 'unknown' });
        return this.persistConferenceState(payload, event);
    }

    private async conferenceReady(operation: MeetingOperationV1, payload: MeetingCreationPayload): Promise<TransitionOutcome> {
        const eventId = operation.calendar?.eventId || createCalendarEventId(payload.cgcLinkId);
        const event = await this.calendar.getEvent(payload.calendarId, eventId);
        if (!isMatchingCalendarRecord(event, payload, eventId) || event.conferenceStatus !== 'success') return this.blocked('calendar_ambiguous', { conference: event?.conferenceStatus === 'failure' ? 'failed_definite' : 'unknown' });
        await this.applyMeetSettingsIfNeeded(operation, payload);
        if (!payload.linkFieldId) {
            if (this.flags.meetingRecurrenceEnabled) return this.blocked('clickup_anchor_missing');
            if (operation.disposition.clickup !== 'not_started') return this.blocked('clickup_anchor_missing');
            await this.store.updateOperation(payload.cgcLinkId, (current) => ({ ...current, state: 'clickup_create_pending', disposition: { ...current.disposition, clickup: 'pending' }, clickup: clickupJournal(payload) }));
            try {
                const task = await this.clickup.createMeetingTask(payload);
                await this.persistClickUpCreated(payload, task.taskId);
                return { kind: 'continue' };
            } catch {
                await this.store.updateOperation(payload.cgcLinkId, (current) => ({ ...current, state: 'clickup_create_unknown', reason: 'clickup_ambiguous', disposition: { ...current.disposition, clickup: 'unknown' } }));
                return { kind: 'terminal', result: { state: 'clickup_create_unknown', warnings: ['clickup_ambiguous', ...dedupeWarnings(operation.warnings)] } };
            }
        }
        const matches = await this.clickup.findTasksByExactLink(payload.workspaceId, payload.linkFieldId, payload.cgcLinkId);
        if (matches.count > 1) return this.blocked('duplicate_conflict', undefined, { exactMatches: matches.count });
        if (matches.count === 1 && matches.taskId) {
            await this.persistClickUpCreated(payload, matches.taskId, 1);
            return { kind: 'continue' };
        }
        if (operation.disposition.clickup !== 'not_started') return this.blocked('clickup_ambiguous', undefined, { exactMatches: matches.count });
        await this.store.updateOperation(payload.cgcLinkId, (current) => ({ ...current, state: 'clickup_create_pending', disposition: { ...current.disposition, clickup: 'pending' }, clickup: clickupJournal(payload, undefined, matches.count) }));
        try {
            const task = await this.clickup.createMeetingTask(payload);
            await this.persistClickUpCreated(payload, task.taskId, 0);
            return { kind: 'continue' };
        } catch {
            await this.store.updateOperation(payload.cgcLinkId, (current) => ({ ...current, state: 'clickup_create_unknown', reason: 'clickup_ambiguous', disposition: { ...current.disposition, clickup: 'unknown' } }));
            return { kind: 'terminal', result: { state: 'clickup_create_unknown', warnings: ['clickup_ambiguous', ...dedupeWarnings(operation.warnings)] } };
        }
    }

    private async reconcileClickUp(operation: MeetingOperationV1, payload: MeetingCreationPayload): Promise<TransitionOutcome> {
        if (!payload.linkFieldId) return this.blocked('clickup_anchor_missing');
        const matches = await this.clickup.findTasksByExactLink(payload.workspaceId, payload.linkFieldId, payload.cgcLinkId);
        if (matches.count === 1 && matches.taskId) {
            await this.persistClickUpCreated(payload, matches.taskId, 1);
            return { kind: 'continue' };
        }
        return this.blocked(matches.count > 1 ? 'duplicate_conflict' : 'clickup_ambiguous', undefined, { exactMatches: matches.count, existing: operation.clickup });
    }

    private async clickupCreated(operation: MeetingOperationV1, payload: MeetingCreationPayload): Promise<TransitionOutcome> {
        const taskId = operation.clickup?.taskId;
        if (!isBoundedOpaqueId(taskId, 100)) return this.blocked('provider_unavailable');
        let readBack;
        try {
            readBack = await this.clickup.getTask(taskId);
        } catch {
            return this.blocked('provider_unavailable', undefined, { taskId });
        }
        const validation = validateClickUpReadBack(readBack, payload, taskId);
        if (!validation.ok) return this.blocked(validation.reason, { clickup: 'failed_definite' });
        const warnings = validation.degraded ? appendWarning(operation.warnings, 'custom_field_ignored') : operation.warnings;
        await this.store.updateOperation(payload.cgcLinkId, (current) => ({
            ...current,
            state: 'calendar_publish_pending',
            disposition: { ...current.disposition, clickup: 'succeeded', calendarPublish: 'not_started' },
            clickup: clickupJournal(payload, taskId, current.clickup?.exactMatches),
            warnings,
        }));
        return { kind: 'continue' };
    }

    private async calendarPublishPending(operation: MeetingOperationV1, payload: MeetingCreationPayload): Promise<TransitionOutcome> {
        const eventId = operation.calendar?.eventId || createCalendarEventId(payload.cgcLinkId);
        const taskId = operation.clickup?.taskId;
        const [event, task] = await Promise.all([
            this.calendar.getEvent(payload.calendarId, eventId),
            isBoundedOpaqueId(taskId, 100) ? this.clickup.getTask(taskId).catch(() => null) : Promise.resolve(null),
        ]);
        if (!isMatchingCalendarRecord(event, payload, eventId) || !isBoundedOpaqueId(taskId, 100)) return this.blocked('calendar_ambiguous', { calendarPublish: 'unknown' });
        const taskValidation = task ? validateClickUpReadBack(task as any, payload, taskId) : { ok: false as const, reason: 'provider_unavailable' as const };
        if (!taskValidation.ok) return this.blocked(taskValidation.reason, { calendarPublish: operation.disposition.calendarPublish === 'not_started' ? 'not_started' : 'unknown' });
        if (operation.disposition.calendarPublish === 'not_started') {
            await this.store.updateOperation(payload.cgcLinkId, (current) => ({ ...current, disposition: { ...current.disposition, calendarPublish: 'pending' } }));
            try {
                const patched = await this.calendar.patchTaskAndInvite({ calendarId: payload.calendarId, eventId, etag: event.etag || '', taskId, attendees: normalizedAttendees(payload), sendUpdates: 'all' });
                if (!isPublishedCalendarRecord(patched, payload, eventId, taskId)) {
                    await this.store.updateOperation(payload.cgcLinkId, (current) => ({ ...current, state: 'repair_required', reason: 'calendar_ambiguous', disposition: { ...current.disposition, calendarPublish: 'unknown' } }));
                    return { kind: 'terminal', result: { state: 'repair_required', warnings: ['calendar_ambiguous', ...dedupeWarnings(operation.warnings)] } };
                }
                return this.closeLink(payload, taskId, patched, operation.warnings || []);
            } catch {
                await this.store.updateOperation(payload.cgcLinkId, (current) => ({ ...current, state: 'repair_required', reason: 'calendar_ambiguous', disposition: { ...current.disposition, calendarPublish: 'unknown' } }));
                return { kind: 'terminal', result: { state: 'repair_required', warnings: ['calendar_ambiguous', ...dedupeWarnings(operation.warnings)] } };
            }
        }
        if (isPublishedCalendarRecord(event, payload, eventId, taskId)) return this.closeLink(payload, taskId, event, operation.warnings || []);
        return this.blocked('calendar_ambiguous', { calendarPublish: 'unknown' });
    }

    private async persistCalendarPrivateCreated(payload: MeetingCreationPayload, event: CalendarEventRecord): Promise<TransitionOutcome> {
        await this.store.updateOperation(payload.cgcLinkId, (operation) => ({
            ...operation,
            state: 'calendar_private_created',
            disposition: { ...operation.disposition, calendar: 'succeeded' },
            calendar: { calendarId: payload.calendarId, eventId: event.eventId, etag: event.etag },
        }));
        return { kind: 'continue' };
    }

    private async persistConferenceState(payload: MeetingCreationPayload, event: CalendarEventRecord): Promise<TransitionOutcome> {
        if (event.conferenceStatus === 'success') {
            await this.store.updateOperation(payload.cgcLinkId, (operation) => ({ ...operation, state: 'conference_ready', disposition: { ...operation.disposition, conference: 'succeeded' }, calendar: { ...operation.calendar, etag: event.etag } }));
            return { kind: 'continue' };
        }
        if (event.conferenceStatus === 'pending') {
            await this.store.updateOperation(payload.cgcLinkId, (operation) => ({ ...operation, state: 'conference_pending', disposition: { ...operation.disposition, conference: 'pending' }, calendar: { ...operation.calendar, etag: event.etag } }));
            return { kind: 'continue' };
        }
        return this.blocked('calendar_ambiguous', { conference: event.conferenceStatus === 'failure' ? 'failed_definite' : 'unknown' });
    }

    private async persistClickUpCreated(payload: MeetingCreationPayload, taskId: string, exactMatches?: number): Promise<void> {
        await this.store.updateOperation(payload.cgcLinkId, (operation) => ({ ...operation, state: 'clickup_created', disposition: { ...operation.disposition, clickup: 'succeeded' }, clickup: clickupJournal(payload, taskId, exactMatches) }));
    }

    private async applyMeetSettingsIfNeeded(operation: MeetingOperationV1, payload: MeetingCreationPayload): Promise<void> {
        if (!this.flags.meetAutoArtifactsEnabled || !payload.meetSpaceName || !this.meetSettings) return;
        if (operation.disposition.meetSettings !== 'not_started') return;
        await this.store.updateOperation(payload.cgcLinkId, (current) => ({ ...current, disposition: { ...current.disposition, meetSettings: 'pending' }, meet: { ...current.meet, spaceName: payload.meetSpaceName } }));
        const settings = await this.meetSettings.applyAutoArtifacts(payload.meetSpaceName).catch(() => ({ ok: false as const, reason: 'unsupported' as const }));
        const warning = settings.ok ? undefined : 'meet_settings_warning';
        await this.store.updateOperation(payload.cgcLinkId, (current) => ({
            ...current,
            disposition: { ...current.disposition, meetSettings: settings.ok ? 'succeeded' : 'unknown' },
            warnings: warning ? appendWarning(current.warnings, warning) : current.warnings,
            meet: { ...current.meet, spaceName: payload.meetSpaceName, settingsWarning: warning },
        }));
    }

    private async closeFromExistingLink(payload: MeetingCreationPayload, link: MeetingLinkV2, warnings: MeetingReasonCode[]): Promise<TransitionOutcome> {
        if (!isLinkCompatibleWithPayload(link, payload)) return this.blocked('storage_conflict');
        const state = link.health === 'healthy' ? 'linked' : 'linked_degraded';
        await this.store.updateOperation(payload.cgcLinkId, (operation) => ({
            ...operation,
            state,
            warnings: dedupeWarnings([...operation.warnings, ...warnings]),
            disposition: { ...operation.disposition, calendar: 'succeeded', conference: 'succeeded', clickup: 'succeeded', calendarPublish: 'succeeded' },
            calendar: { calendarId: link.calendar.calendarId, eventId: link.calendar.eventId, ...(link.calendar.etag ? { etag: link.calendar.etag } : {}) },
            clickup: clickupJournal(payload, link.clickup.taskId, operation.clickup?.exactMatches),
        }));
        return { kind: 'terminal', result: { state, warnings: dedupeWarnings(warnings) } };
    }

    private async closeLink(payload: MeetingCreationPayload, taskId: string, event: CalendarEventRecord, warnings: MeetingReasonCode[]): Promise<TransitionOutcome> {
        const cleanWarnings = dedupeWarnings(warnings);
        const state = cleanWarnings.length ? 'linked_degraded' : 'linked';
        const link: MeetingLinkV2 = { schemaVersion: 2, cgcLinkId: payload.cgcLinkId, source: 'created', health: state === 'linked' ? 'healthy' : 'linked_degraded', googleAccountKey: payload.googleAccountKey, calendar: { calendarId: payload.calendarId, eventId: event.eventId, etag: event.etag }, meet: { ...(payload.meetSpaceName ? { spaceName: payload.meetSpaceName } : {}), ...(payload.roomKey ? { roomKey: payload.roomKey } : {}) }, clickup: { workspaceId: payload.workspaceId, taskId, listId: payload.listId, customItemId: payload.customItemId, ...(payload.parentTaskId ? { parentTaskId: payload.parentTaskId } : {}), ...(payload.linkFieldId ? { linkFieldId: payload.linkFieldId } : {}) }, createdAt: Date.now(), updatedAt: Date.now() };
        try {
            await this.store.addLink(link);
        } catch {
            return this.blocked('storage_conflict', { calendarPublish: 'succeeded' });
        }
        await this.store.updateOperation(payload.cgcLinkId, (operation) => ({ ...operation, state, warnings: dedupeWarnings([...operation.warnings, ...cleanWarnings]), disposition: { ...operation.disposition, calendarPublish: 'succeeded' } }));
        return { kind: 'terminal', result: { state, warnings: cleanWarnings } };
    }

    private async blocked(reason: MeetingReasonCode, disposition?: Partial<Record<keyof MeetingOperationV1['disposition'], StepDisposition>>, clickup?: { taskId?: string; exactMatches?: number; existing?: MeetingOperationV1['clickup'] }, requiresReentry?: boolean): Promise<Extract<TransitionOutcome, { kind: 'blocked' }>> {
        return { kind: 'blocked', reason, disposition, clickup, requiresReentry };
    }

    private async persistBlocked(cgcLinkId: string, operation: MeetingOperationV1, outcome: Extract<TransitionOutcome, { kind: 'blocked' }>): Promise<void> {
        await this.store.updateOperation(cgcLinkId, (current) => ({
            ...current,
            state: 'repair_required',
            reason: outcome.reason,
            disposition: { ...current.disposition, ...(outcome.disposition || {}) },
            clickup: outcome.clickup ? { ...(outcome.clickup.existing || current.clickup), ...(outcome.clickup.taskId ? { taskId: outcome.clickup.taskId } : {}), ...(Number.isInteger(outcome.clickup.exactMatches) ? { exactMatches: outcome.clickup.exactMatches } : {}) } : current.clickup,
            warnings: appendWarning(current.warnings || operation.warnings || [], outcome.reason),
        }));
    }
}

function outcomeToResult(outcome: TransitionOutcome): SagaResult {
    if (outcome.kind === 'terminal') return outcome.result;
    if (outcome.kind === 'blocked') return { state: 'repair_required', warnings: [outcome.reason], requiresReentry: outcome.requiresReentry };
    return { state: 'repair_required', warnings: ['limit_reached'] };
}

function validatePayload(payload: MeetingCreationPayload | null): { ok: true; payload: MeetingCreationPayload } | { ok: false; reason: 'input_required' | 'payload_mismatch' } {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'input_required' };
    if (!isCgcUuid(payload.clientRequestId) || !isCgcUuid(payload.cgcLinkId) || !isPayloadHash(payload.payloadHash)) return { ok: false, reason: 'payload_mismatch' };
    if (!isBoundedOpaqueId(payload.calendarId, 256) || !isBoundedOpaqueId(payload.workspaceId, 100) || !isBoundedOpaqueId(payload.listId, 100) || !isBoundedOpaqueId(payload.googleAccountKey, 128)) return { ok: false, reason: 'payload_mismatch' };
    if (!Number.isInteger(payload.customItemId) || payload.customItemId <= 0 || !Number.isFinite(payload.dueDate) || payload.dueDate < 0 || payload.dueDate > 4_102_444_800_000 || !Number.isFinite(payload.estimateMs) || payload.estimateMs < 0 || payload.estimateMs > 365 * 24 * 60 * 60 * 1000) return { ok: false, reason: 'payload_mismatch' };
    if (!isIso(payload.startTime) || !isIso(payload.endTime)) return { ok: false, reason: 'payload_mismatch' };
    if (Date.parse(payload.startTime) >= Date.parse(payload.endTime)) return { ok: false, reason: 'payload_mismatch' };
    if (payload.linkFieldId !== undefined && !isBoundedOpaqueId(payload.linkFieldId, 100)) return { ok: false, reason: 'payload_mismatch' };
    if (payload.parentTaskId !== undefined && !isBoundedOpaqueId(payload.parentTaskId, 100)) return { ok: false, reason: 'payload_mismatch' };
    if (payload.roomKey !== undefined && !isRoomKey(payload.roomKey)) return { ok: false, reason: 'payload_mismatch' };
    if (payload.meetSpaceName !== undefined && !isMeetSpaceName(payload.meetSpaceName)) return { ok: false, reason: 'payload_mismatch' };
    const attendees = sanitizeAttendees(payload.attendees);
    if (!attendees.ok) return { ok: false, reason: 'payload_mismatch' };
    return { ok: true, payload: { ...payload, clientRequestId: payload.clientRequestId.toLowerCase(), cgcLinkId: payload.cgcLinkId.toLowerCase(), payloadHash: payload.payloadHash.toLowerCase(), attendees: attendees.value } };
}

function validateClickUpReadBack(readBack: { taskId: string; listId: string; parentTaskId?: string; customItemId?: number; linkValue?: string }, payload: MeetingCreationPayload, taskId: string): { ok: true; degraded: boolean } | { ok: false; reason: 'clickup_ambiguous' | 'custom_field_ignored' } {
    if (readBack.taskId !== taskId || readBack.listId !== payload.listId || readBack.customItemId !== payload.customItemId) return { ok: false, reason: 'clickup_ambiguous' };
    if ((payload.parentTaskId || undefined) !== (readBack.parentTaskId || undefined)) return { ok: false, reason: 'clickup_ambiguous' };
    if (payload.linkFieldId && readBack.linkValue !== payload.cgcLinkId) return { ok: false, reason: 'custom_field_ignored' };
    return { ok: true, degraded: !payload.linkFieldId };
}

function isIso(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function isMatchingCalendarRecord(event: CalendarEventRecord | null | undefined, payload: MeetingCreationPayload, eventId: string): event is CalendarEventRecord {
    return !!event && event.calendarId === payload.calendarId && event.eventId === eventId && event.cgcLinkId === payload.cgcLinkId && event.payloadHash === payload.payloadHash;
}

function isPublishedCalendarRecord(event: CalendarEventRecord | null | undefined, payload: MeetingCreationPayload, eventId: string, taskId: string): event is CalendarEventRecord {
    return isMatchingCalendarRecord(event, payload, eventId) && event.clickupTaskId === taskId && event.attendeesPublished === true;
}

function sanitizeAttendees(value: unknown): { ok: true; value: { email: string }[] } | { ok: false } {
    if (value === undefined) return { ok: true, value: [] };
    if (!Array.isArray(value) || value.length > 50) return { ok: false };
    const attendees: { email: string }[] = [];
    for (const attendee of value) {
        if (!attendee || typeof attendee !== 'object' || Array.isArray(attendee)) return { ok: false };
        const keys = Object.keys(attendee);
        if (keys.length !== 1 || keys[0] !== 'email') return { ok: false };
        const email = (attendee as any).email;
        if (typeof email !== 'string' || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false };
        attendees.push({ email });
    }
    return { ok: true, value: attendees };
}

function isLinkCompatibleWithPayload(link: MeetingLinkV2, payload: MeetingCreationPayload): boolean {
    return link.googleAccountKey === payload.googleAccountKey
        && link.calendar.calendarId === payload.calendarId
        && link.calendar.eventId === createCalendarEventId(payload.cgcLinkId)
        && link.clickup.workspaceId === payload.workspaceId
        && link.clickup.listId === payload.listId
        && link.clickup.customItemId === payload.customItemId
        && (link.clickup.parentTaskId || undefined) === (payload.parentTaskId || undefined)
        && (link.clickup.linkFieldId || undefined) === (payload.linkFieldId || undefined)
        && (link.meet.roomKey || undefined) === (payload.roomKey || undefined)
        && (link.meet.spaceName || undefined) === (payload.meetSpaceName || undefined);
}

function normalizedAttendees(payload: MeetingCreationPayload): readonly { email: string }[] {
    return (payload.attendees || []) as readonly { email: string }[];
}

function clickupJournal(payload: MeetingCreationPayload, taskId?: string, exactMatches?: number): MeetingOperationV1['clickup'] {
    return { workspaceId: payload.workspaceId, ...(taskId ? { taskId } : {}), listId: payload.listId, customItemId: payload.customItemId, ...(payload.linkFieldId ? { linkFieldId: payload.linkFieldId } : {}), ...(Number.isInteger(exactMatches) ? { exactMatches } : {}) };
}

function operationSignature(operation: MeetingOperationV1): string {
    return JSON.stringify({ state: operation.state, reason: operation.reason, disposition: operation.disposition, calendar: operation.calendar, clickup: operation.clickup, meet: operation.meet, warnings: operation.warnings });
}

function appendWarning(warnings: readonly MeetingReasonCode[], warning: MeetingReasonCode): MeetingReasonCode[] {
    return warnings.includes(warning) ? [...warnings] : [...warnings, warning];
}

function dedupeWarnings(warnings: readonly MeetingReasonCode[]): MeetingReasonCode[] {
    return [...new Set(warnings)];
}
