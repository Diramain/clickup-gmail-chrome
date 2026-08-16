export const DIAGNOSTIC_SESSION_KEY = 'safeDiagnosticLogV1';
export const DIAGNOSTIC_SCHEMA_VERSION = 1;
export const DIAGNOSTIC_MAX_EVENTS = 200;
const DIAGNOSTIC_MAX_COUNTER = 1_000_000;

export type DiagnosticEventName =
    | 'diagnostic_enabled'
    | 'diagnostic_disabled'
    | 'auth_state'
    | 'authorization_mode'
    | 'api_request'
    | 'api_response'
    | 'workspace_selection'
    | 'task_validation'
    | 'timer_poll'
    | 'timer_transition';

export interface SafeDiagnosticEvent {
    sequence: number;
    timestamp: number;
    event: DiagnosticEventName;
    details: Record<string, string | number | boolean>;
}

export interface SafeDiagnosticStatus {
    enabled: boolean;
    eventCount: number;
    droppedCount: number;
    maxEvents: number;
}

export interface SafeDiagnosticExport {
    schemaVersion: 1;
    extensionVersion: string;
    generatedAt: string;
    storageScope: 'browser-session';
    enabled: boolean;
    eventCount: number;
    droppedCount: number;
    maxEvents: number;
    events: SafeDiagnosticEvent[];
}

export type DiagnosticDetails = Record<string, unknown>;

interface DiagnosticState {
    enabled: boolean;
    nextSequence: number;
    droppedCount: number;
    events: SafeDiagnosticEvent[];
}

export interface DiagnosticSessionStorage {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
}

const EVENT_FIELDS: Record<DiagnosticEventName, readonly string[]> = {
    diagnostic_enabled: [],
    diagnostic_disabled: [],
    auth_state: ['stage', 'outcome', 'failureClass'],
    authorization_mode: ['stage', 'outcome', 'authorizationMode'],
    api_request: ['route', 'method', 'authorizationMode', 'attempt', 'fallback'],
    api_response: ['route', 'method', 'authorizationMode', 'attempt', 'fallback', 'outcome', 'failureClass', 'clickupCode'],
    workspace_selection: ['source', 'outcome', 'count'],
    task_validation: ['stage', 'outcome', 'failureClass', 'clickupCode'],
    timer_poll: ['outcome', 'failureClass'],
    timer_transition: ['action', 'outcome', 'reason'],
};

const STRING_VALUE_ALLOWLISTS: Record<string, ReadonlySet<string>> = {
    stage: new Set([
        'initialize', 'status', 'oauth', 'invalidate', 'request', 'probe', 'persist',
        'direct', 'workspace-fallback',
    ]),
    outcome: new Set([
        'started', 'success', 'failure', 'ready', 'no-token', 'reauth-required',
        'unavailable', 'cached', 'remote', 'stale-ignored', 'invalidated',
        'selected-preferred', 'selected-first', 'no-workspace', 'attempted', 'valid',
        'invalid', 'invalid-task', 'not-found', 'running', 'stopped', 'none', 'switched', 'stale',
        'suppressed', 'skipped', 'stopped-after-focus-change',
    ]),
    failureClass: new Set([
        'none', 'unauthorized', 'workspace-not-authorized', 'forbidden', 'not-found',
        'rate-limited', 'server-error', 'network', 'auth-unavailable', 'unknown',
    ]),
    route: new Set([
        'user', 'user-probe', 'teams', 'task-direct', 'task-workspace-fallback',
        'tasks-query', 'timer-current', 'timer-start', 'timer-stop', 'time-entries',
        'hierarchy', 'other',
    ]),
    method: new Set(['read', 'write']),
    authorizationMode: new Set(['raw', 'bearer']),
    source: new Set(['cache', 'remote', 'preferred', 'first-authorized', 'none']),
    action: new Set(['none', 'start', 'stop', 'switch']),
    reason: new Set([
        'direct', 'inbox-notification', 'disabled', 'outside-clickup', 'inbox',
        'clickup-other', 'same-task', 'different-task', 'timer-already-running',
        'auto-start-disabled', 'manually-stopped', 'manual', 'poll',
        'last-task-tab-closed', 'last-task-view-left', 'unknown',
    ]),
    clickupCode: new Set([
        'OAUTH_023', 'OAUTH_026', 'OAUTH_027',
        ...Array.from({ length: 17 }, (_, index) => `OAUTH_${String(index + 29).padStart(3, '0')}`),
    ]),
};

const EVENT_NAMES = new Set<DiagnosticEventName>(Object.keys(EVENT_FIELDS) as DiagnosticEventName[]);

export class SafeDiagnosticLog {
    private mutationQueue: Promise<void> = Promise.resolve();
    private statePromise: Promise<DiagnosticState> | null = null;

    constructor(
        private readonly storage: DiagnosticSessionStorage,
        private readonly now: () => number = () => Date.now(),
    ) {}

    async getStatus(): Promise<SafeDiagnosticStatus> {
        await this.mutationQueue;
        return toStatus(await this.readState());
    }

    setEnabled(enabled: boolean): Promise<SafeDiagnosticStatus> {
        return this.enqueue(async () => {
            const state = await this.readState();
            if (state.enabled === enabled) return toStatus(state);
            state.enabled = enabled;
            appendEvent(state, enabled ? 'diagnostic_enabled' : 'diagnostic_disabled', {}, this.now());
            await this.writeState(state);
            return toStatus(state);
        });
    }

    record(event: DiagnosticEventName, details: DiagnosticDetails = {}): Promise<boolean> {
        return this.enqueue(async () => {
            if (!EVENT_NAMES.has(event)) return false;
            const state = await this.readState();
            if (!state.enabled) return false;
            appendEvent(state, event, sanitizeDetails(event, details), this.now());
            await this.writeState(state);
            return true;
        });
    }

    clear(): Promise<SafeDiagnosticStatus> {
        return this.enqueue(async () => {
            const state = await this.readState();
            state.events = [];
            state.droppedCount = 0;
            state.nextSequence = 0;
            await this.writeState(state);
            return toStatus(state);
        });
    }

    async createExport(extensionVersion: string): Promise<SafeDiagnosticExport> {
        await this.mutationQueue;
        const state = await this.readState();
        const safeVersion = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(extensionVersion)
            ? extensionVersion
            : 'unknown';
        return {
            schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
            extensionVersion: safeVersion,
            generatedAt: new Date(this.now()).toISOString(),
            storageScope: 'browser-session',
            enabled: state.enabled,
            eventCount: state.events.length,
            droppedCount: state.droppedCount,
            maxEvents: DIAGNOSTIC_MAX_EVENTS,
            events: state.events.map(event => ({ ...event, details: { ...event.details } })),
        };
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutationQueue.then(operation, operation);
        this.mutationQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async readState(): Promise<DiagnosticState> {
        if (!this.statePromise) {
            this.statePromise = this.storage.get(DIAGNOSTIC_SESSION_KEY)
                .then(stored => sanitizeState(stored[DIAGNOSTIC_SESSION_KEY]));
        }
        return this.statePromise;
    }

    private async writeState(state: DiagnosticState): Promise<void> {
        await this.storage.set({ [DIAGNOSTIC_SESSION_KEY]: state });
    }
}

function appendEvent(
    state: DiagnosticState,
    event: DiagnosticEventName,
    details: Record<string, string | number | boolean>,
    timestamp: number,
): void {
    const sequence = (state.nextSequence % DIAGNOSTIC_MAX_COUNTER) + 1;
    state.nextSequence = sequence;
    state.events.push({
        sequence,
        timestamp: safeNonNegativeInteger(timestamp),
        event,
        details,
    });
    if (state.events.length > DIAGNOSTIC_MAX_EVENTS) {
        const overflow = state.events.length - DIAGNOSTIC_MAX_EVENTS;
        state.events.splice(0, overflow);
        state.droppedCount = Math.min(DIAGNOSTIC_MAX_COUNTER, state.droppedCount + overflow);
    }
}

function sanitizeState(value: unknown): DiagnosticState {
    if (!isRecord(value)) return emptyState();
    const rawEvents = Array.isArray(value.events) ? value.events : [];
    const events = rawEvents
        .map(sanitizeStoredEvent)
        .filter((event): event is SafeDiagnosticEvent => event !== null)
        .slice(-DIAGNOSTIC_MAX_EVENTS);
    const overflow = Math.max(0, rawEvents.length - DIAGNOSTIC_MAX_EVENTS);
    const maxSequence = events.reduce((max, event) => Math.max(max, event.sequence), 0);
    return {
        enabled: value.enabled === true,
        nextSequence: Math.min(DIAGNOSTIC_MAX_COUNTER, Math.max(safeNonNegativeInteger(value.nextSequence), maxSequence)),
        droppedCount: Math.min(DIAGNOSTIC_MAX_COUNTER, safeNonNegativeInteger(value.droppedCount) + overflow),
        events,
    };
}

function sanitizeStoredEvent(value: unknown): SafeDiagnosticEvent | null {
    if (!isRecord(value) || typeof value.event !== 'string' || !EVENT_NAMES.has(value.event as DiagnosticEventName)) {
        return null;
    }
    const event = value.event as DiagnosticEventName;
    return {
        sequence: safeNonNegativeInteger(value.sequence),
        timestamp: safeNonNegativeInteger(value.timestamp),
        event,
        details: sanitizeDetails(event, isRecord(value.details) ? value.details : {}),
    };
}

function sanitizeDetails(
    event: DiagnosticEventName,
    details: DiagnosticDetails,
): Record<string, string | number | boolean> {
    const sanitized: Record<string, string | number | boolean> = {};
    for (const key of EVENT_FIELDS[event]) {
        const value = details[key];
        if (key === 'attempt') {
            const attempt = Number(value);
            if (Number.isInteger(attempt) && attempt >= 1 && attempt <= 4) sanitized[key] = attempt;
            continue;
        }
        if (key === 'count') {
            const count = Number(value);
            if (Number.isInteger(count) && count >= 0 && count <= 1000) sanitized[key] = count;
            continue;
        }
        if (key === 'fallback') {
            if (typeof value === 'boolean') sanitized[key] = value;
            continue;
        }
        if (typeof value === 'string' && STRING_VALUE_ALLOWLISTS[key]?.has(value)) {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

function toStatus(state: DiagnosticState): SafeDiagnosticStatus {
    return {
        enabled: state.enabled,
        eventCount: state.events.length,
        droppedCount: state.droppedCount,
        maxEvents: DIAGNOSTIC_MAX_EVENTS,
    };
}

function emptyState(): DiagnosticState {
    return { enabled: false, nextSequence: 0, droppedCount: 0, events: [] };
}

function safeNonNegativeInteger(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
