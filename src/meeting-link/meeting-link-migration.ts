import { MeetingLinkStore } from './meeting-link.store';
import { sanitizeMeetMappingStore } from '../meet/meet-priority';

export interface LegacyMeetTaskMappingV1 {
    roomKey: string;
    taskId: string;
    teamId: string;
    createdAt: number;
    lastUsedAt: number;
    enabled: boolean;
}

export interface MeetMappingStoreV1 {
    schemaVersion: 1;
    mappings: Record<string, LegacyMeetTaskMappingV1>;
}

export interface LegacyMeetMigrationV1 {
    schemaVersion: 1;
    revision: number;
    mappings: Record<string, { roomKey: string; taskId: string; teamId: string; state: 'shadowed' | 'legacy_active' | 'converted' | 'disabled'; shadowedAt: number }>;
}

export function createShadowLegacyMigration(store: MeetMappingStoreV1, now = Date.now()): LegacyMeetMigrationV1 {
    const sanitized = sanitizeMeetMappingStore(store) as MeetMappingStoreV1;
    const mappings: LegacyMeetMigrationV1['mappings'] = {};
    for (const mapping of Object.values(sanitized.mappings)) {
        mappings[mapping.roomKey] = {
            roomKey: mapping.roomKey,
            taskId: mapping.taskId,
            teamId: mapping.teamId,
            state: mapping.enabled ? 'legacy_active' : 'shadowed',
            shadowedAt: now,
        };
    }
    return { schemaVersion: 1, revision: 0, mappings };
}

export function migrateLegacyMeetMappingsIdempotently(previous: LegacyMeetMigrationV1 | null | undefined, store: MeetMappingStoreV1, now = Date.now()): LegacyMeetMigrationV1 {
    const sanitized = sanitizeMeetMappingStore(store) as MeetMappingStoreV1;
    const next = previous ? { schemaVersion: 1 as const, revision: previous.revision, mappings: { ...previous.mappings } } : createShadowLegacyMigration({ schemaVersion: 1, mappings: {} }, now);
    let added = false;
    for (const mapping of Object.values(sanitized.mappings)) {
        if (next.mappings[mapping.roomKey]) continue;
        next.mappings[mapping.roomKey] = {
            roomKey: mapping.roomKey,
            taskId: mapping.taskId,
            teamId: mapping.teamId,
            state: mapping.enabled ? 'legacy_active' : 'shadowed',
            shadowedAt: now,
        };
        added = true;
    }
    if (previous && added) next.revision += 1;
    return next;
}

export async function resolveMeetRoomForTimer(input: { roomKey: string; v2Store: MeetingLinkStore; v1Store: MeetMappingStoreV1 }): Promise<{ source: 'v2'; cgcLinkId: string; taskId: string; teamId: string } | { source: 'v1'; taskId: string; teamId: string } | null> {
    const link = await input.v2Store.resolveRoomAlias(input.roomKey);
    if (link) return { source: 'v2', cgcLinkId: link.cgcLinkId, taskId: link.clickup.taskId, teamId: link.clickup.workspaceId };
    const legacy = input.v1Store.mappings[input.roomKey];
    if (legacy && !legacy.enabled) return null;
    return legacy ? { source: 'v1', taskId: legacy.taskId, teamId: legacy.teamId } : null;
}
