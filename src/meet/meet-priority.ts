import { isValidClickUpTaskId } from '../clickup-focus';
import { sanitizeMeetTitle } from './meet-task-prompt';

export type MeetPriorityStatus = 'idle' | 'awaiting-task' | 'tracking' | 'paused' | 'ignored';

export interface MeetTaskMappingV1 {
    roomKey: string;
    taskId: string;
    teamId: string;
    createdAt: number;
    lastUsedAt: number;
    enabled: boolean;
}

export interface MeetPrioritySession {
    roomKey: string;
    tabId: number;
    windowId: number;
    status: Exclude<MeetPriorityStatus, 'idle'>;
    taskId?: string;
    teamId?: string;
    startedAt?: number;
    previousTaskId?: string;
    previousTeamId?: string;
    joinedAt: number;
    durationConfirmedAt?: number;
    lastSeenAt: number;
    title?: string;
}

export interface MeetMappingStoreV1 {
    schemaVersion: 1;
    mappings: Record<string, MeetTaskMappingV1>;
}

export interface MeetTabIdentity {
    roomKey: string;
    tabId: number;
    windowId: number;
}

export type MeetJoinAuthority = 'continue' | 'accept' | 'replace' | 'conflict';

export function isValidRoomKey(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isValidMeetTaskMapping(value: unknown): value is MeetTaskMappingV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const mapping = value as Partial<MeetTaskMappingV1>;
    return isValidRoomKey(mapping.roomKey)
        && isValidClickUpTaskId(mapping.taskId)
        && typeof mapping.teamId === 'string'
        && mapping.teamId.length > 0
        && mapping.teamId.length <= 100
        && isNonNegativeFiniteNumber(mapping.createdAt)
        && isNonNegativeFiniteNumber(mapping.lastUsedAt)
        && typeof mapping.enabled === 'boolean';
}

export function sanitizeMeetMappingStore(value: unknown): MeetMappingStoreV1 {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value as { mappings?: unknown }
        : {};
    const rawMappings = source.mappings && typeof source.mappings === 'object' && !Array.isArray(source.mappings)
        ? source.mappings as Record<string, unknown>
        : {};
    const mappings: Record<string, MeetTaskMappingV1> = {};

    for (const [roomKey, mapping] of Object.entries(rawMappings).slice(0, 500)) {
        if (!isValidMeetTaskMapping(mapping) || mapping.roomKey !== roomKey) continue;
        mappings[roomKey] = {
            roomKey: mapping.roomKey,
            taskId: mapping.taskId,
            teamId: mapping.teamId,
            createdAt: mapping.createdAt,
            lastUsedAt: mapping.lastUsedAt,
            enabled: mapping.enabled,
        };
    }

    return { schemaVersion: 1, mappings };
}

export function selectMeetMapping(store: MeetMappingStoreV1, roomKey: string): MeetTaskMappingV1 | null {
    const mapping = store.mappings[roomKey];
    return mapping?.enabled ? mapping : null;
}

export function sanitizeMeetPrioritySession(value: unknown): MeetPrioritySession | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const session = value as Partial<MeetPrioritySession>;
    if (!isValidRoomKey(session.roomKey)
        || !Number.isInteger(session.tabId) || session.tabId! < 0
        || !Number.isInteger(session.windowId) || session.windowId! < 0
        || !['awaiting-task', 'tracking', 'paused', 'ignored'].includes(session.status || '')
        || !isNonNegativeFiniteNumber(session.joinedAt)
        || !isNonNegativeFiniteNumber(session.lastSeenAt)) {
        return null;
    }
    if (session.taskId !== undefined && !isValidClickUpTaskId(session.taskId)) return null;
    if (session.previousTaskId !== undefined && !isValidClickUpTaskId(session.previousTaskId)) return null;
    if (session.teamId !== undefined && !isBoundedId(session.teamId)) return null;
    if (session.previousTeamId !== undefined && !isBoundedId(session.previousTeamId)) return null;
    if (session.startedAt !== undefined && !isNonNegativeFiniteNumber(session.startedAt)) return null;
    if (session.durationConfirmedAt !== undefined && !isNonNegativeFiniteNumber(session.durationConfirmedAt)) return null;
    const title = session.title === undefined ? undefined : sanitizeMeetTitle(session.title);
    if (session.title !== undefined && !title) return null;
    if (session.status === 'tracking' || session.status === 'paused') {
        if (!isValidClickUpTaskId(session.taskId) || !isBoundedId(session.teamId)
            || !isNonNegativeFiniteNumber(session.startedAt)) return null;
    } else if (session.taskId !== undefined || session.teamId !== undefined || session.startedAt !== undefined) {
        return null;
    }
    return {
        roomKey: session.roomKey,
        tabId: session.tabId!,
        windowId: session.windowId!,
        status: session.status as MeetPrioritySession['status'],
        taskId: session.taskId,
        teamId: session.teamId,
        startedAt: session.startedAt,
        previousTaskId: session.previousTaskId,
        previousTeamId: session.previousTeamId,
        joinedAt: session.joinedAt!,
        durationConfirmedAt: session.durationConfirmedAt,
        lastSeenAt: session.lastSeenAt!,
        title,
    };
}

export function decideMeetJoinAuthority(
    current: MeetPrioritySession | null,
    incoming: MeetTabIdentity,
    focusedTab: { tabId: number; windowId: number } | null,
): MeetJoinAuthority {
    if (current
        && current.roomKey === incoming.roomKey
        && current.tabId === incoming.tabId
        && current.windowId === incoming.windowId) {
        return 'continue';
    }
    const incomingIsFocused = !!focusedTab
        && focusedTab.tabId === incoming.tabId
        && focusedTab.windowId === incoming.windowId;
    if (!incomingIsFocused) return 'conflict';
    return current ? 'replace' : 'accept';
}

function isBoundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
