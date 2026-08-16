export type MeetingLinkHealth =
    | 'healthy'
    | 'linked_degraded'
    | 'calendar_only'
    | 'clickup_only'
    | 'duplicate_conflict'
    | 'orphaned'
    | 'legacy_only'
    | 'disabled';

export type MeetingOperationState =
    | 'preflight_ok'
    | 'calendar_create_pending'
    | 'calendar_private_created'
    | 'conference_pending'
    | 'conference_ready'
    | 'clickup_create_pending'
    | 'clickup_create_unknown'
    | 'clickup_created'
    | 'calendar_publish_pending'
    | 'linked'
    | 'linked_degraded'
    | 'repair_required'
    | 'abandoned';

export type StepDisposition = 'not_started' | 'pending' | 'succeeded' | 'failed_definite' | 'unknown';

export type MeetingReasonCode =
    | 'input_required'
    | 'payload_mismatch'
    | 'calendar_ambiguous'
    | 'clickup_ambiguous'
    | 'clickup_anchor_missing'
    | 'duplicate_conflict'
    | 'storage_conflict'
    | 'limit_reached'
    | 'permission_denied'
    | 'provider_unavailable'
    | 'meet_settings_warning'
    | 'custom_field_ignored'
    | 'unsupported_recurrence'
    | 'disabled_by_flag';

export const MEETING_REASON_CODES: readonly MeetingReasonCode[] = [
    'input_required',
    'payload_mismatch',
    'calendar_ambiguous',
    'clickup_ambiguous',
    'clickup_anchor_missing',
    'duplicate_conflict',
    'storage_conflict',
    'limit_reached',
    'permission_denied',
    'provider_unavailable',
    'meet_settings_warning',
    'custom_field_ignored',
    'unsupported_recurrence',
    'disabled_by_flag',
] as const;

export interface MeetingLinkV2 {
    schemaVersion: 2;
    cgcLinkId: string;
    source: 'created' | 'recovered' | 'legacy-converted';
    health: MeetingLinkHealth;
    googleAccountKey: string;
    calendar: {
        calendarId: string;
        eventId: string;
        iCalUID?: string;
        recurringEventId?: string;
        originalStartTime?: string;
        etag?: string;
    };
    meet: {
        spaceName?: string;
        roomKey?: string;
    };
    clickup: {
        workspaceId: string;
        taskId: string;
        listId: string;
        parentTaskId?: string;
        customItemId: number;
        linkFieldId?: string;
    };
    createdAt: number;
    updatedAt: number;
    lastVerifiedAt?: number;
}

export interface MeetingLinksStoreV2 {
    schemaVersion: 2;
    revision: number;
    links: Record<string, MeetingLinkV2>;
    roomAliases: Record<string, string>;
}

export interface MeetingOperationV1 {
    schemaVersion: 1;
    cgcLinkId: string;
    clientRequestId: string;
    payloadHash: string;
    state: MeetingOperationState;
    disposition: {
        calendar: StepDisposition;
        conference: StepDisposition;
        clickup: StepDisposition;
        calendarPublish: StepDisposition;
        meetSettings: StepDisposition;
    };
    calendar?: {
        calendarId?: string;
        eventId?: string;
        etag?: string;
        recurringEventId?: string;
        originalStartTime?: string;
    };
    clickup?: {
        workspaceId?: string;
        taskId?: string;
        listId?: string;
        customItemId?: number;
        linkFieldId?: string;
        exactMatches?: number;
    };
    meet?: {
        spaceName?: string;
        roomKey?: string;
        settingsWarning?: MeetingReasonCode;
    };
    reason?: MeetingReasonCode;
    warnings: MeetingReasonCode[];
    createdAt: number;
    updatedAt: number;
}

export interface MeetingOperationsStoreV1 {
    schemaVersion: 1;
    revision: number;
    operations: Record<string, MeetingOperationV1>;
    requestIndex: Record<string, string>;
}

export interface MeetingWorkspaceConfigV1 {
    schemaVersion: 1;
    workspaceId: string;
    listId: string;
    customItemId: number;
    linkFieldId?: string;
    parentTaskId?: string;
}

export interface MeetingFeatureFlagsV1 {
    schemaVersion: 1;
    calendarIntegrationEnabled: boolean;
    calendarWriteEnabled: boolean;
    meetAutoArtifactsEnabled: boolean;
    meetingRecurrenceEnabled: boolean;
}

export type MeetingLinkSanitizeResult = { ok: true; value: MeetingLinkV2 } | { ok: false; reason: MeetingReasonCode };
export type MeetingOperationSanitizeResult = { ok: true; value: MeetingOperationV1 } | { ok: false; reason: MeetingReasonCode };
export type MeetingLinksStoreSanitizeResult = { ok: true; value: MeetingLinksStoreV2 } | { ok: false; reason: MeetingReasonCode };
export type MeetingOperationsStoreSanitizeResult = { ok: true; value: MeetingOperationsStoreV1 } | { ok: false; reason: MeetingReasonCode };

export const DEFAULT_MEETING_FEATURE_FLAGS: MeetingFeatureFlagsV1 = Object.freeze({
    schemaVersion: 1,
    calendarIntegrationEnabled: false,
    calendarWriteEnabled: false,
    meetAutoArtifactsEnabled: false,
    meetingRecurrenceEnabled: false,
});

export const EMPTY_MEETING_LINKS_STORE: MeetingLinksStoreV2 = Object.freeze({
    schemaVersion: 2,
    revision: 0,
    links: {},
    roomAliases: {},
});

export const EMPTY_MEETING_OPERATIONS_STORE: MeetingOperationsStoreV1 = Object.freeze({
    schemaVersion: 1,
    revision: 0,
    operations: {},
    requestIndex: {},
});

export function isMeetingReasonCode(value: unknown): value is MeetingReasonCode {
    return typeof value === 'string' && (MEETING_REASON_CODES as readonly string[]).includes(value);
}

export function isCgcUuid(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isPayloadHash(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function isRoomKey(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function isMeetSpaceName(value: unknown): value is string {
    return typeof value === 'string' && /^spaces\/[A-Za-z0-9_-]{1,100}$/.test(value);
}

export function isBoundedOpaqueId(value: unknown, max = 256): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\s/?#]/.test(value);
}

export function isSafeTimestamp(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4_102_444_800_000;
}

export function isOperationState(value: unknown): value is MeetingOperationState {
    return typeof value === 'string' && [
        'preflight_ok', 'calendar_create_pending', 'calendar_private_created', 'conference_pending', 'conference_ready',
        'clickup_create_pending', 'clickup_create_unknown', 'clickup_created', 'calendar_publish_pending', 'linked',
        'linked_degraded', 'repair_required', 'abandoned',
    ].includes(value);
}

export function isStepDisposition(value: unknown): value is StepDisposition {
    return typeof value === 'string' && ['not_started', 'pending', 'succeeded', 'failed_definite', 'unknown'].includes(value);
}

export function sanitizeMeetingLinkV2(value: unknown): MeetingLinkSanitizeResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'storage_conflict' };
    const raw = value as any;
    if (raw.schemaVersion !== 2 || !isCgcUuid(raw.cgcLinkId)) return { ok: false, reason: 'storage_conflict' };
    if (!['created', 'recovered', 'legacy-converted'].includes(raw.source)) return { ok: false, reason: 'storage_conflict' };
    if (!['healthy', 'linked_degraded', 'calendar_only', 'clickup_only', 'duplicate_conflict', 'orphaned', 'legacy_only', 'disabled'].includes(raw.health)) return { ok: false, reason: 'storage_conflict' };
    if (!isBoundedOpaqueId(raw.googleAccountKey, 128)) return { ok: false, reason: 'storage_conflict' };
    const calendar = raw.calendar || {};
    const meet = raw.meet || {};
    const clickup = raw.clickup || {};
    if (!isBoundedOpaqueId(calendar.calendarId, 256) || !isBoundedOpaqueId(calendar.eventId, 256)) return { ok: false, reason: 'storage_conflict' };
    if (!isBoundedOpaqueId(clickup.workspaceId, 100) || !isBoundedOpaqueId(clickup.taskId, 100) || !isBoundedOpaqueId(clickup.listId, 100) || !Number.isInteger(clickup.customItemId) || clickup.customItemId <= 0) return { ok: false, reason: 'storage_conflict' };
    if (!isSafeTimestamp(raw.createdAt) || !isSafeTimestamp(raw.updatedAt)) return { ok: false, reason: 'storage_conflict' };
    const sanitized: MeetingLinkV2 = {
        schemaVersion: 2,
        cgcLinkId: raw.cgcLinkId.toLowerCase(),
        source: raw.source,
        health: raw.health,
        googleAccountKey: raw.googleAccountKey,
        calendar: {
            calendarId: calendar.calendarId,
            eventId: calendar.eventId,
            ...(isBoundedOpaqueId(calendar.iCalUID, 256) ? { iCalUID: calendar.iCalUID } : {}),
            ...(isBoundedOpaqueId(calendar.recurringEventId, 256) ? { recurringEventId: calendar.recurringEventId } : {}),
            ...(isBoundedOpaqueId(calendar.originalStartTime, 64) ? { originalStartTime: calendar.originalStartTime } : {}),
            ...(isBoundedOpaqueId(calendar.etag, 256) ? { etag: calendar.etag } : {}),
        },
        meet: {
            ...(isMeetSpaceName(meet.spaceName) ? { spaceName: meet.spaceName } : {}),
            ...(isRoomKey(meet.roomKey) ? { roomKey: meet.roomKey } : {}),
        },
        clickup: {
            workspaceId: clickup.workspaceId,
            taskId: clickup.taskId,
            listId: clickup.listId,
            ...(isBoundedOpaqueId(clickup.parentTaskId, 100) ? { parentTaskId: clickup.parentTaskId } : {}),
            customItemId: clickup.customItemId,
            ...(isBoundedOpaqueId(clickup.linkFieldId, 100) ? { linkFieldId: clickup.linkFieldId } : {}),
        },
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        ...(isSafeTimestamp(raw.lastVerifiedAt) ? { lastVerifiedAt: raw.lastVerifiedAt } : {}),
    };
    return { ok: true, value: sanitized };
}

export function sanitizeMeetingOperationV1(value: unknown): MeetingOperationSanitizeResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'storage_conflict' };
    const raw = value as any;
    if (raw.schemaVersion !== 1 || !isCgcUuid(raw.cgcLinkId) || !isCgcUuid(raw.clientRequestId) || !isPayloadHash(raw.payloadHash) || !isOperationState(raw.state)) return { ok: false, reason: 'storage_conflict' };
    if (!isSafeTimestamp(raw.createdAt) || !isSafeTimestamp(raw.updatedAt)) return { ok: false, reason: 'storage_conflict' };
    const disposition = raw.disposition || {};
    const keys = ['calendar', 'conference', 'clickup', 'calendarPublish', 'meetSettings'] as const;
    if (!keys.every((key) => isStepDisposition(disposition[key]))) return { ok: false, reason: 'storage_conflict' };
    const operation: MeetingOperationV1 = {
        schemaVersion: 1,
        cgcLinkId: raw.cgcLinkId.toLowerCase(),
        clientRequestId: raw.clientRequestId.toLowerCase(),
        payloadHash: raw.payloadHash.toLowerCase(),
        state: raw.state,
        disposition: {
            calendar: disposition.calendar,
            conference: disposition.conference,
            clickup: disposition.clickup,
            calendarPublish: disposition.calendarPublish,
            meetSettings: disposition.meetSettings,
        },
        warnings: Array.isArray(raw.warnings) ? raw.warnings.filter(isMeetingReasonCode) : [],
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
    };
    if (isMeetingReasonCode(raw.reason)) operation.reason = raw.reason;
    const calendar = raw.calendar || {};
    const clickup = raw.clickup || {};
    const meet = raw.meet || {};
    if (raw.calendar && typeof raw.calendar === 'object' && !Array.isArray(raw.calendar)) {
        operation.calendar = {
            ...(isBoundedOpaqueId(calendar.calendarId, 256) ? { calendarId: calendar.calendarId } : {}),
            ...(isBoundedOpaqueId(calendar.eventId, 256) ? { eventId: calendar.eventId } : {}),
            ...(isBoundedOpaqueId(calendar.etag, 256) ? { etag: calendar.etag } : {}),
            ...(isBoundedOpaqueId(calendar.recurringEventId, 256) ? { recurringEventId: calendar.recurringEventId } : {}),
            ...(isBoundedOpaqueId(calendar.originalStartTime, 64) ? { originalStartTime: calendar.originalStartTime } : {}),
        };
    }
    if (raw.clickup && typeof raw.clickup === 'object' && !Array.isArray(raw.clickup)) {
        operation.clickup = {
            ...(isBoundedOpaqueId(clickup.workspaceId, 100) ? { workspaceId: clickup.workspaceId } : {}),
            ...(isBoundedOpaqueId(clickup.taskId, 100) ? { taskId: clickup.taskId } : {}),
            ...(isBoundedOpaqueId(clickup.listId, 100) ? { listId: clickup.listId } : {}),
            ...(Number.isInteger(clickup.customItemId) && clickup.customItemId > 0 ? { customItemId: clickup.customItemId } : {}),
            ...(isBoundedOpaqueId(clickup.linkFieldId, 100) ? { linkFieldId: clickup.linkFieldId } : {}),
            ...(Number.isInteger(clickup.exactMatches) && clickup.exactMatches >= 0 ? { exactMatches: clickup.exactMatches } : {}),
        };
    }
    if (raw.meet && typeof raw.meet === 'object' && !Array.isArray(raw.meet)) {
        operation.meet = {
            ...(isMeetSpaceName(meet.spaceName) ? { spaceName: meet.spaceName } : {}),
            ...(isRoomKey(meet.roomKey) ? { roomKey: meet.roomKey } : {}),
            ...(isMeetingReasonCode(meet.settingsWarning) ? { settingsWarning: meet.settingsWarning } : {}),
        };
    }
    if (!validateMeetingOperationSemantics(operation)) return { ok: false, reason: 'storage_conflict' };
    return { ok: true, value: operation };
}

export function validateMeetingOperationSemantics(operation: MeetingOperationV1): boolean {
    const disposition = operation.disposition;
    const hasCalendarIds = isBoundedOpaqueId(operation.calendar?.calendarId, 256) && isBoundedOpaqueId(operation.calendar?.eventId, 256);
    const hasClickUpCore = isBoundedOpaqueId(operation.clickup?.workspaceId, 100)
        && isBoundedOpaqueId(operation.clickup?.listId, 100)
        && Number.isInteger(operation.clickup?.customItemId)
        && Number(operation.clickup?.customItemId) > 0;
    const hasTask = hasClickUpCore && isBoundedOpaqueId(operation.clickup?.taskId, 100);
    const coreNotStarted = disposition.calendar === 'not_started'
        && disposition.conference === 'not_started'
        && disposition.clickup === 'not_started'
        && disposition.calendarPublish === 'not_started';
    const calendarSucceeded = disposition.calendar === 'succeeded' && hasCalendarIds;
    const conferenceSucceeded = calendarSucceeded && disposition.conference === 'succeeded';
    const clickupSucceeded = conferenceSucceeded && disposition.clickup === 'succeeded' && hasTask;

    switch (operation.state) {
        case 'preflight_ok':
            return coreNotStarted;
        case 'calendar_create_pending':
            return disposition.calendar === 'pending'
                && hasCalendarIds
                && disposition.conference === 'not_started'
                && disposition.clickup === 'not_started'
                && disposition.calendarPublish === 'not_started';
        case 'calendar_private_created':
            return calendarSucceeded
                && (disposition.conference === 'not_started' || disposition.conference === 'pending')
                && disposition.clickup === 'not_started'
                && disposition.calendarPublish === 'not_started';
        case 'conference_pending':
            return calendarSucceeded
                && disposition.conference === 'pending'
                && disposition.clickup === 'not_started'
                && disposition.calendarPublish === 'not_started';
        case 'conference_ready':
            return conferenceSucceeded
                && disposition.clickup === 'not_started'
                && disposition.calendarPublish === 'not_started';
        case 'clickup_create_pending':
            return conferenceSucceeded
                && disposition.clickup === 'pending'
                && disposition.calendarPublish === 'not_started';
        case 'clickup_create_unknown':
            return conferenceSucceeded
                && disposition.clickup === 'unknown'
                && disposition.calendarPublish === 'not_started';
        case 'clickup_created':
            return clickupSucceeded && disposition.calendarPublish === 'not_started';
        case 'calendar_publish_pending':
            return clickupSucceeded && ['not_started', 'pending', 'unknown'].includes(disposition.calendarPublish);
        case 'linked':
        case 'linked_degraded':
            return clickupSucceeded && disposition.calendarPublish === 'succeeded';
        case 'repair_required':
        case 'abandoned':
            return true;
        default:
            return false;
    }
}

export function sanitizeMeetingLinksStoreV2(value: unknown): MeetingLinksStoreSanitizeResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: true, value: { ...EMPTY_MEETING_LINKS_STORE } };
    const raw = value as any;
    if (raw.schemaVersion !== 2 || !Number.isInteger(raw.revision) || raw.revision < 0) return { ok: false, reason: 'storage_conflict' };
    const linksRaw = raw.links && typeof raw.links === 'object' && !Array.isArray(raw.links) ? raw.links as Record<string, unknown> : null;
    const aliasesRaw = raw.roomAliases && typeof raw.roomAliases === 'object' && !Array.isArray(raw.roomAliases) ? raw.roomAliases as Record<string, unknown> : null;
    if (!linksRaw || !aliasesRaw) return { ok: false, reason: 'storage_conflict' };
    const links: Record<string, MeetingLinkV2> = {};
    for (const [key, linkValue] of Object.entries(linksRaw)) {
        const link = sanitizeMeetingLinkV2(linkValue);
        if (!link.ok || key !== link.value.cgcLinkId) return { ok: false, reason: 'storage_conflict' };
        links[key] = link.value;
    }
    const roomAliases: Record<string, string> = {};
    for (const [roomKey, linkId] of Object.entries(aliasesRaw)) {
        if (!isRoomKey(roomKey) || !isCgcUuid(linkId) || !links[String(linkId).toLowerCase()]) return { ok: false, reason: 'storage_conflict' };
        const normalizedLinkId = String(linkId).toLowerCase();
        const linked = links[normalizedLinkId];
        if (linked.meet.roomKey !== roomKey) return { ok: false, reason: 'storage_conflict' };
        roomAliases[roomKey] = normalizedLinkId;
    }
    for (const link of Object.values(links)) {
        if (link.health !== 'disabled' && link.meet.roomKey && roomAliases[link.meet.roomKey] !== link.cgcLinkId) {
            return { ok: false, reason: 'storage_conflict' };
        }
    }
    return { ok: true, value: { schemaVersion: 2, revision: raw.revision, links, roomAliases } };
}

export function sanitizeMeetingOperationsStoreV1(value: unknown): MeetingOperationsStoreSanitizeResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: true, value: { ...EMPTY_MEETING_OPERATIONS_STORE } };
    const raw = value as any;
    if (raw.schemaVersion !== 1 || !Number.isInteger(raw.revision) || raw.revision < 0) return { ok: false, reason: 'storage_conflict' };
    const opsRaw = raw.operations && typeof raw.operations === 'object' && !Array.isArray(raw.operations) ? raw.operations as Record<string, unknown> : null;
    const indexRaw = raw.requestIndex && typeof raw.requestIndex === 'object' && !Array.isArray(raw.requestIndex) ? raw.requestIndex as Record<string, unknown> : null;
    if (!opsRaw || !indexRaw) return { ok: false, reason: 'storage_conflict' };
    const operations: Record<string, MeetingOperationV1> = {};
    const cgcIds = new Set<string>();
    const rawOperationEntries = Object.entries(opsRaw);
    if (rawOperationEntries.length > 200) return { ok: false, reason: 'storage_conflict' };
    for (const [key, opValue] of rawOperationEntries) {
        const operation = sanitizeMeetingOperationV1(opValue);
        if (!operation.ok || key !== operation.value.cgcLinkId || cgcIds.has(key)) return { ok: false, reason: 'storage_conflict' };
        cgcIds.add(key);
        operations[key] = operation.value;
    }
    if (Object.keys(indexRaw).length !== rawOperationEntries.length) return { ok: false, reason: 'storage_conflict' };
    const requestIndex: Record<string, string> = {};
    for (const [requestId, linkId] of Object.entries(indexRaw)) {
        const normalizedLink = typeof linkId === 'string' ? linkId.toLowerCase() : '';
        if (!isCgcUuid(requestId) || !isCgcUuid(normalizedLink) || !operations[normalizedLink] || operations[normalizedLink].clientRequestId !== requestId.toLowerCase()) return { ok: false, reason: 'storage_conflict' };
        requestIndex[requestId.toLowerCase()] = normalizedLink;
    }
    for (const operation of Object.values(operations)) {
        if (requestIndex[operation.clientRequestId] !== operation.cgcLinkId) return { ok: false, reason: 'storage_conflict' };
    }
    return { ok: true, value: { schemaVersion: 1, revision: raw.revision, operations, requestIndex } };
}

export function sanitizeMeetingFeatureFlags(value: unknown): MeetingFeatureFlagsV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_MEETING_FEATURE_FLAGS };
    const flags = value as Partial<MeetingFeatureFlagsV1>;
    return {
        schemaVersion: 1,
        calendarIntegrationEnabled: flags.calendarIntegrationEnabled === true,
        calendarWriteEnabled: flags.calendarWriteEnabled === true,
        meetAutoArtifactsEnabled: flags.meetAutoArtifactsEnabled === true,
        meetingRecurrenceEnabled: flags.meetingRecurrenceEnabled === true,
    };
}

export function sanitizeMeetingOperationForJournal(value: MeetingOperationV1): MeetingOperationV1 {
    const sanitized = sanitizeMeetingOperationV1(value);
    if (!sanitized.ok) throw new Error('INVALID_MEETING_OPERATION_JOURNAL');
    return sanitized.value;
}
