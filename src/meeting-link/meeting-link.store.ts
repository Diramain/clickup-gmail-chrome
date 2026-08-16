import {
    EMPTY_MEETING_LINKS_STORE,
    EMPTY_MEETING_OPERATIONS_STORE,
    MeetingLinkV2,
    MeetingLinksStoreV2,
    MeetingOperationV1,
    MeetingOperationsStoreV1,
    isCgcUuid,
    isPayloadHash,
    isRoomKey,
    sanitizeMeetingLinksStoreV2,
    sanitizeMeetingOperationForJournal,
    sanitizeMeetingOperationsStoreV1,
} from './meeting-link.types';

export const MAX_MEETING_OPERATIONS = 200;

export interface MeetingLinkStoreSnapshot {
    links: MeetingLinksStoreV2;
    operations: MeetingOperationsStoreV1;
}

export interface SerializedMeetingStoreAdapter {
    read(): Promise<MeetingLinkStoreSnapshot>;
    write(snapshot: MeetingLinkStoreSnapshot, expected: { linksRevision: number; operationsRevision: number }): Promise<void>;
}

export interface MinimalStorageArea {
    get(keys: string[] | Record<string, unknown>): Promise<Record<string, unknown>> | void;
    set(items: Record<string, unknown>): Promise<void> | void;
}

const storageLocks = new WeakMap<object, Promise<unknown>>();

export type BeginOperationResult =
    | { ok: true; operation: MeetingOperationV1; existing: boolean }
    | { ok: false; reason: 'conflict' | 'limit_reached' };

export class InMemoryMeetingStoreAdapter implements SerializedMeetingStoreAdapter {
    private snapshot: MeetingLinkStoreSnapshot;

    constructor(snapshot: Partial<MeetingLinkStoreSnapshot> = {}) {
        this.snapshot = {
            links: cloneLinks(snapshot.links || EMPTY_MEETING_LINKS_STORE),
            operations: cloneOperations(snapshot.operations || EMPTY_MEETING_OPERATIONS_STORE),
        };
    }

    async read(): Promise<MeetingLinkStoreSnapshot> {
        return { links: cloneLinks(this.snapshot.links), operations: cloneOperations(this.snapshot.operations) };
    }

    async write(snapshot: MeetingLinkStoreSnapshot, expected: { linksRevision: number; operationsRevision: number }): Promise<void> {
        if (this.snapshot.links.revision !== expected.linksRevision || this.snapshot.operations.revision !== expected.operationsRevision) {
            throw new Error('MEETING_STORE_REVISION_CONFLICT');
        }
        this.snapshot = { links: cloneLinks(snapshot.links), operations: cloneOperations(snapshot.operations) };
    }
}

export class StorageAreaMeetingStoreAdapter implements SerializedMeetingStoreAdapter {
    constructor(
        private readonly storage: MinimalStorageArea,
        private readonly keys = { links: 'meetingLinksV2', operations: 'meetingOperationsV1' },
    ) {}

    async read(): Promise<MeetingLinkStoreSnapshot> {
        const raw = await Promise.resolve(this.storage.get([this.keys.links, this.keys.operations]) as Promise<Record<string, unknown>> | Record<string, unknown> | void) || {};
        const links = sanitizeMeetingLinksStoreV2(raw[this.keys.links]);
        const operations = sanitizeMeetingOperationsStoreV1(raw[this.keys.operations]);
        if (!links.ok || !operations.ok) throw new Error('MEETING_STORE_CORRUPT');
        return { links: links.value, operations: operations.value };
    }

    async write(snapshot: MeetingLinkStoreSnapshot, expected: { linksRevision: number; operationsRevision: number }): Promise<void> {
        return withStorageLock(this.storage as object, async () => {
            const current = await this.read();
            if (current.links.revision !== expected.linksRevision || current.operations.revision !== expected.operationsRevision) {
                throw new Error('MEETING_STORE_REVISION_CONFLICT');
            }
            const links = sanitizeMeetingLinksStoreV2(snapshot.links);
            const operations = sanitizeMeetingOperationsStoreV1(snapshot.operations);
            if (!links.ok || !operations.ok) throw new Error('MEETING_STORE_INVALID_WRITE');
            await Promise.resolve(this.storage.set({ [this.keys.links]: links.value, [this.keys.operations]: operations.value }));
            const after = await this.read();
            if (after.links.revision !== links.value.revision || after.operations.revision !== operations.value.revision) {
                throw new Error('MEETING_STORE_WRITE_VERIFY_FAILED');
            }
        });
    }
}

export class MeetingLinkStore {
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly adapter: SerializedMeetingStoreAdapter, private readonly now: () => number = () => Date.now()) {}

    beginOperation(input: { clientRequestId: string; payloadHash: string; cgcLinkId: string }): Promise<BeginOperationResult> {
        return this.serialized(async () => {
            if (!isCgcUuid(input.clientRequestId) || !isCgcUuid(input.cgcLinkId) || !isPayloadHash(input.payloadHash)) return { ok: false, reason: 'conflict' };
            const snapshot = await this.adapter.read();
            const clientRequestId = input.clientRequestId.toLowerCase();
            const cgcLinkId = input.cgcLinkId.toLowerCase();
            const payloadHash = input.payloadHash.toLowerCase();
            const existingLinkId = snapshot.operations.requestIndex[clientRequestId];
            if (existingLinkId) {
                const existing = snapshot.operations.operations[existingLinkId];
                if (existing && existing.payloadHash === payloadHash && existing.cgcLinkId === cgcLinkId) return { ok: true, operation: existing, existing: true };
                return { ok: false, reason: 'conflict' };
            }
            const existingByLink = snapshot.operations.operations[cgcLinkId];
            if (existingByLink && (existingByLink.clientRequestId !== clientRequestId || existingByLink.payloadHash !== payloadHash)) return { ok: false, reason: 'conflict' };
            if (Object.keys(snapshot.operations.operations).length >= MAX_MEETING_OPERATIONS) {
                return { ok: false, reason: 'limit_reached' };
            }
            const now = this.now();
            const operation = sanitizeMeetingOperationForJournal({
                schemaVersion: 1,
                cgcLinkId,
                clientRequestId,
                payloadHash,
                state: 'preflight_ok',
                disposition: {
                    calendar: 'not_started',
                    conference: 'not_started',
                    clickup: 'not_started',
                    calendarPublish: 'not_started',
                    meetSettings: 'not_started',
                },
                warnings: [],
                createdAt: now,
                updatedAt: now,
            });
            const next: MeetingLinkStoreSnapshot = {
                links: { ...snapshot.links, revision: snapshot.links.revision, links: { ...snapshot.links.links }, roomAliases: { ...snapshot.links.roomAliases } },
                operations: {
                    schemaVersion: 1,
                    revision: snapshot.operations.revision + 1,
                    operations: { ...snapshot.operations.operations, [cgcLinkId]: operation },
                    requestIndex: { ...snapshot.operations.requestIndex, [clientRequestId]: cgcLinkId },
                },
            };
            try {
                await this.adapter.write(next, { linksRevision: snapshot.links.revision, operationsRevision: snapshot.operations.revision });
            } catch (error: any) {
                if (String(error?.message || '').includes('REVISION_CONFLICT')) return { ok: false, reason: 'conflict' };
                throw error;
            }
            return { ok: true, operation, existing: false };
        });
    }

    updateOperation(cgcLinkId: string, update: (operation: MeetingOperationV1) => MeetingOperationV1): Promise<MeetingOperationV1> {
        return this.serialized(async () => {
            if (!isCgcUuid(cgcLinkId)) throw new Error('MEETING_OPERATION_NOT_FOUND');
            const normalizedLinkId = cgcLinkId.toLowerCase();
            const snapshot = await this.adapter.read();
            const current = snapshot.operations.operations[normalizedLinkId];
            if (!current) throw new Error('MEETING_OPERATION_NOT_FOUND');
            const operation = sanitizeMeetingOperationForJournal({ ...update(current), updatedAt: this.now() });
            const next: MeetingLinkStoreSnapshot = {
                links: cloneLinks(snapshot.links),
                operations: {
                    schemaVersion: 1,
                    revision: snapshot.operations.revision + 1,
                    operations: { ...snapshot.operations.operations, [normalizedLinkId]: operation },
                    requestIndex: { ...snapshot.operations.requestIndex },
                },
            };
            await this.adapter.write(next, { linksRevision: snapshot.links.revision, operationsRevision: snapshot.operations.revision });
            return operation;
        });
    }

    addLink(link: MeetingLinkV2): Promise<void> {
        return this.serialized(async () => {
            const sanitizedLink = sanitizeMeetingLinksStoreV2({ schemaVersion: 2, revision: 0, links: { [link.cgcLinkId]: link }, roomAliases: link.meet.roomKey ? { [link.meet.roomKey]: link.cgcLinkId } : {} });
            if (!sanitizedLink.ok) throw new Error('MEETING_LINK_INVALID');
            const cleanLink = sanitizedLink.value.links[link.cgcLinkId];
            const snapshot = await this.adapter.read();
            const current = snapshot.links.links[cleanLink.cgcLinkId];
            if (current && !isCompatibleLinkReplacement(current, cleanLink)) throw new Error('MEETING_LINK_REPLACEMENT_CONFLICT');
            const aliases = { ...snapshot.links.roomAliases };
            if (cleanLink.meet.roomKey) {
                const existingAlias = aliases[cleanLink.meet.roomKey];
                if (existingAlias && existingAlias !== cleanLink.cgcLinkId) throw new Error('MEETING_ROOM_ALIAS_CONFLICT');
                aliases[cleanLink.meet.roomKey] = cleanLink.cgcLinkId;
            }
            const next: MeetingLinkStoreSnapshot = {
                links: {
                    schemaVersion: 2,
                    revision: snapshot.links.revision + 1,
                    links: { ...snapshot.links.links, [cleanLink.cgcLinkId]: cleanLink },
                    roomAliases: aliases,
                },
                operations: cloneOperations(snapshot.operations),
            };
            await this.adapter.write(next, { linksRevision: snapshot.links.revision, operationsRevision: snapshot.operations.revision });
        });
    }

    async resolveRoomAlias(roomKey: string): Promise<MeetingLinkV2 | null> {
        if (!isRoomKey(roomKey)) return null;
        const snapshot = await this.adapter.read();
        const cgcLinkId = snapshot.links.roomAliases[roomKey];
        if (!cgcLinkId) return null;
        const link = snapshot.links.links[cgcLinkId];
        return link && link.health !== 'disabled' ? link : null;
    }

    async getOperation(cgcLinkId: string): Promise<MeetingOperationV1 | null> {
        if (!isCgcUuid(cgcLinkId)) return null;
        const snapshot = await this.adapter.read();
        return snapshot.operations.operations[cgcLinkId.toLowerCase()] || null;
    }

    async getLink(cgcLinkId: string): Promise<MeetingLinkV2 | null> {
        if (!isCgcUuid(cgcLinkId)) return null;
        const snapshot = await this.adapter.read();
        return snapshot.links.links[cgcLinkId.toLowerCase()] || null;
    }

    private serialized<T>(work: () => Promise<T>): Promise<T> {
        const next = this.queue.then(work, work);
        this.queue = next.catch(() => undefined);
        return next;
    }
}

function cloneLinks(store: MeetingLinksStoreV2): MeetingLinksStoreV2 {
    return { schemaVersion: 2, revision: store.revision, links: { ...store.links }, roomAliases: { ...store.roomAliases } };
}

function cloneOperations(store: MeetingOperationsStoreV1): MeetingOperationsStoreV1 {
    return { schemaVersion: 1, revision: store.revision, operations: { ...store.operations }, requestIndex: { ...store.requestIndex } };
}

function isCompatibleLinkReplacement(current: MeetingLinkV2, next: MeetingLinkV2): boolean {
    return current.cgcLinkId === next.cgcLinkId
        && current.calendar.calendarId === next.calendar.calendarId
        && current.calendar.eventId === next.calendar.eventId
        && current.clickup.workspaceId === next.clickup.workspaceId
        && current.clickup.taskId === next.clickup.taskId
        && current.clickup.listId === next.clickup.listId
        && current.clickup.customItemId === next.clickup.customItemId
        && current.googleAccountKey === next.googleAccountKey
        && (current.clickup.parentTaskId || undefined) === (next.clickup.parentTaskId || undefined)
        && (current.clickup.linkFieldId || undefined) === (next.clickup.linkFieldId || undefined)
        && (current.meet.roomKey || undefined) === (next.meet.roomKey || undefined)
        && (current.meet.spaceName || undefined) === (next.meet.spaceName || undefined);
}

function withStorageLock<T>(storage: object, work: () => Promise<T>): Promise<T> {
    const previous = storageLocks.get(storage) || Promise.resolve();
    const next = previous.then(work, work);
    storageLocks.set(storage, next.catch(() => undefined));
    return next;
}
