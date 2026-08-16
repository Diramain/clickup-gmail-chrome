export const CAUSAL_TRACE_SCHEMA_VERSION = 1;
export const CAUSAL_TRACE_PORT_NAME = 'cgc-causal-trace-recorder';
const MAX_COUNTER = 1_000_000_000;
const MAX_REF_COUNTER = 100_000;

export type CausalTraceSource = 'extension-main' | 'session-observer';
export type CausalTraceEventType = 'listener' | 'navigation' | 'index' | 'guard' | 'decision' | 'attempt' | 'result' | 'diagnostic' | 'capture';
export type OriginCategory = 'clickup' | 'gmail' | 'meet' | 'extension' | 'other' | 'invalid' | 'none';
export type RouteCategory = 'task-direct' | 'inbox-notification' | 'inbox-general' | 'kanban-or-list' | 'home' | 'gmail' | 'meet' | 'extension-page' | 'other' | 'invalid' | 'none';

export interface SafeRouteInfo {
    originCategory: OriginCategory;
    routeCategory: RouteCategory;
    hasQuery: boolean;
    hasFragment: boolean;
}

export interface SafeCausalTraceEvent {
    schemaVersion: 1;
    source: CausalTraceSource;
    sequence: number;
    timestamp: number;
    captureRef: string;
    event: CausalTraceEventType;
    tabRef?: string;
    windowRef?: string;
    taskRef?: string;
    urlRef?: string;
    originCategory?: OriginCategory;
    routeCategory?: RouteCategory;
    hasQuery?: boolean;
    hasFragment?: boolean;
    action?: string;
    outcome?: string;
    reason?: string;
    errorCategory?: string;
    guard?: string;
}

export interface CausalTraceInput {
    event: CausalTraceEventType;
    rawUrl?: string | null;
    taskId?: string | null;
    tabId?: number | null;
    windowId?: number | null;
    action?: unknown;
    outcome?: unknown;
    reason?: unknown;
    error?: unknown;
    guard?: unknown;
}

const TRACE_EVENTS = new Set<CausalTraceEventType>(['listener', 'navigation', 'index', 'guard', 'decision', 'attempt', 'result', 'diagnostic', 'capture']);
const SOURCES = new Set<CausalTraceSource>(['extension-main', 'session-observer']);
const ORIGINS = new Set<OriginCategory>(['clickup', 'gmail', 'meet', 'extension', 'other', 'invalid', 'none']);
const ROUTES = new Set<RouteCategory>(['task-direct', 'inbox-notification', 'inbox-general', 'kanban-or-list', 'home', 'gmail', 'meet', 'extension-page', 'other', 'invalid', 'none']);
const ACTIONS = new Set(['none', 'start', 'stop', 'switch', 'tabs.onUpdated', 'tabs.onActivated', 'tabs.onRemoved', 'windows.onFocusChanged', 'windows.onRemoved', 'timer-poll', 'focused-evaluation', 'last-task-view-exit', 'recording-started', 'recording-stopped', 'recording-continuity', 'tab-created', 'tab-updated', 'tab-activated', 'tab-removed', 'window-focus', 'window-removed', 'flush', 'compare', 'diagnostic_enabled', 'diagnostic_disabled', 'auth_state', 'authorization_mode', 'api_request', 'api_response', 'workspace_selection', 'task_validation', 'timer_poll', 'timer_transition']);
const OUTCOMES = new Set(['received', 'queued', 'skipped', 'none', 'attempted', 'stopped', 'started', 'switched', 'stale', 'invalid-task', 'failure', 'success', 'running', 'same-task-tab-open', 'stopped-after-focus-change', 'armed', 'disarmed', 'overflow', 'limit', 'permission-error', 'page-closed', 'manual-stop', 'scheduled-stop', 'closed', 'index-hit', 'index-miss', 'reconnected', 'in-flight']);
const REASONS = new Set(['direct', 'inbox-notification', 'inbox', 'clickup-other', 'outside-clickup', 'disabled', 'auto-stop-disabled', 'auto-start-disabled', 'running-task-unknown', 'closed-task-unknown', 'closed-different-task', 'same-task', 'different-task', 'timer-already-running', 'last-task-tab-closed', 'last-task-view-left', 'meet-priority', 'manual', 'manually-stopped', 'scheduled-1800', 'page-close', 'writer-limit', 'writer-overflow', 'writer-error', 'permission-error', 'service-worker-restart', 'unknown']);
const GUARDS = new Set(['auth', 'meet-priority', 'settings', 'focused-snapshot', 'team', 'api', 'running-task', 'manual-suppression', 'still-focused', 'last-view', 'writer', 'schema', 'none']);
const ERRORS = new Set(['unauthorized', 'not-found', 'rate-limited', 'server-error', 'permission-error', 'limit', 'unknown']);
const OPTIONAL_KEYS = ['tabRef', 'windowRef', 'taskRef', 'urlRef', 'originCategory', 'routeCategory', 'hasQuery', 'hasFragment', 'action', 'outcome', 'reason', 'errorCategory', 'guard'] as const;
const REQUIRED_KEYS = ['schemaVersion', 'source', 'sequence', 'timestamp', 'captureRef', 'event'] as const;
const ALL_KEYS = new Set([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);

export function createCaptureRef(prefix = 'cap'): string {
    const suffix = secureRandomHex(12);
    return `${prefix}-${Date.now().toString(36)}-${suffix}`;
}

export class CausalTraceSanitizer {
    private sequence = 0;
    private readonly taskRefs = new Map<string, string>();
    private readonly tabRefs = new Map<number, string>();
    private readonly windowRefs = new Map<number, string>();
    private readonly urlRefs = new Map<string, string>();

    constructor(
        private readonly source: CausalTraceSource,
        private readonly captureRef: string,
        private readonly now: () => number = () => Date.now(),
    ) {}

    event(input: CausalTraceInput): SafeCausalTraceEvent {
        const route = classifyRoute(input.rawUrl);
        const event: SafeCausalTraceEvent = {
            schemaVersion: CAUSAL_TRACE_SCHEMA_VERSION,
            source: this.source,
            sequence: this.nextSequence(),
            timestamp: safeTimestamp(this.now()),
            captureRef: safeRef(this.captureRef, 'cap'),
            event: TRACE_EVENTS.has(input.event) ? input.event : 'diagnostic',
            originCategory: route.originCategory,
            routeCategory: route.routeCategory,
            hasQuery: route.hasQuery,
            hasFragment: route.hasFragment,
        };
        if (route.originCategory === 'clickup' && typeof input.rawUrl === 'string') event.urlRef = this.urlRef(input.rawUrl);
        if (isSafeId(input.tabId)) event.tabRef = this.refFor(this.tabRefs, input.tabId, 'tab');
        if (isSafeId(input.windowId)) event.windowRef = this.refFor(this.windowRefs, input.windowId, 'win');
        if (typeof input.taskId === 'string' && input.taskId.length > 0) event.taskRef = this.taskRef(input.taskId);
        const action = safeEnum(input.action, ACTIONS);
        const outcome = safeEnum(input.outcome, OUTCOMES);
        const reason = safeEnum(input.reason, REASONS);
        const guard = safeEnum(input.guard, GUARDS);
        if (action) event.action = action;
        if (outcome) event.outcome = outcome;
        if (reason) event.reason = reason;
        if (guard) event.guard = guard;
        const errorCategory = classifyError(input.error);
        if (errorCategory) event.errorCategory = errorCategory;
        return event;
    }

    private nextSequence(): number {
        this.sequence = (this.sequence % MAX_COUNTER) + 1;
        return this.sequence;
    }

    private refFor(map: Map<number, string>, id: number, prefix: string): string {
        const existing = map.get(id);
        if (existing) return existing;
        const ref = `${prefix}-${Math.min(map.size + 1, MAX_REF_COUNTER)}`;
        map.set(id, ref);
        return ref;
    }

    private taskRef(taskId: string): string {
        const existing = this.taskRefs.get(taskId);
        if (existing) return existing;
        const ref = `task-${Math.min(this.taskRefs.size + 1, MAX_REF_COUNTER)}`;
        this.taskRefs.set(taskId, ref);
        return ref;
    }

    private urlRef(rawUrl: string): string {
        const existing = this.urlRefs.get(rawUrl);
        if (existing) return existing;
        const ref = `url-${Math.min(this.urlRefs.size + 1, MAX_REF_COUNTER)}`;
        this.urlRefs.set(rawUrl, ref);
        return ref;
    }
}

export function classifyRoute(rawUrl: string | undefined | null): SafeRouteInfo {
    if (!rawUrl) return { originCategory: 'none', routeCategory: 'none', hasQuery: false, hasFragment: false };
    let url: URL;
    try { url = new URL(rawUrl); } catch { return { originCategory: 'invalid', routeCategory: 'invalid', hasQuery: false, hasFragment: false }; }
    const hasQuery = url.search.length > 0;
    const hasFragment = url.hash.length > 0;
    if (url.origin === 'https://app.clickup.com') {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 't') return { originCategory: 'clickup', routeCategory: 'task-direct', hasQuery, hasFragment };
        if (parts.includes('inbox')) {
            const inboxIndex = parts.indexOf('inbox');
            return { originCategory: 'clickup', routeCategory: parts[inboxIndex + 1] === 'b' ? 'inbox-notification' : 'inbox-general', hasQuery, hasFragment };
        }
        if (parts.includes('v') || parts.includes('li') || parts.includes('board')) return { originCategory: 'clickup', routeCategory: 'kanban-or-list', hasQuery, hasFragment };
        if (parts.length <= 1) return { originCategory: 'clickup', routeCategory: 'home', hasQuery, hasFragment };
        return { originCategory: 'clickup', routeCategory: 'other', hasQuery, hasFragment };
    }
    if (url.origin === 'https://mail.google.com') return { originCategory: 'gmail', routeCategory: 'gmail', hasQuery, hasFragment };
    if (url.origin === 'https://meet.google.com') return { originCategory: 'meet', routeCategory: 'meet', hasQuery, hasFragment };
    if (url.protocol === 'chrome-extension:') return { originCategory: 'extension', routeCategory: 'extension-page', hasQuery, hasFragment };
    return { originCategory: 'other', routeCategory: 'other', hasQuery, hasFragment };
}

export function normalizeCausalTraceEvent(value: unknown, expectedSource?: CausalTraceSource): SafeCausalTraceEvent | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (Object.keys(raw).some(key => !ALL_KEYS.has(key as keyof SafeCausalTraceEvent))) return null;
    if (raw.schemaVersion !== 1 || !SOURCES.has(raw.source as CausalTraceSource) || !TRACE_EVENTS.has(raw.event as CausalTraceEventType)) return null;
    if (expectedSource && raw.source !== expectedSource) return null;
    if (!Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < 1) return null;
    if (!Number.isSafeInteger(raw.timestamp) || Number(raw.timestamp) < 0) return null;
    if (typeof raw.captureRef !== 'string' || !/^[a-z]+-[a-z0-9-]{1,90}$/i.test(raw.captureRef)) return null;

    const event: SafeCausalTraceEvent = {
        schemaVersion: 1,
        source: raw.source as CausalTraceSource,
        sequence: raw.sequence as number,
        timestamp: raw.timestamp as number,
        captureRef: raw.captureRef,
        event: raw.event as CausalTraceEventType,
    };
    if (!assignPattern(event, raw, 'tabRef', /^tab-\d{1,6}$/)) return null;
    if (!assignPattern(event, raw, 'windowRef', /^win-\d{1,6}$/)) return null;
    if (!assignPattern(event, raw, 'taskRef', /^task-\d{1,6}$/)) return null;
    if (!assignPattern(event, raw, 'urlRef', /^url-\d{1,6}$/)) return null;
    if (!assignEnum(event, raw, 'originCategory', ORIGINS)) return null;
    if (!assignEnum(event, raw, 'routeCategory', ROUTES)) return null;
    if (!assignBoolean(event, raw, 'hasQuery')) return null;
    if (!assignBoolean(event, raw, 'hasFragment')) return null;
    if (!assignEnum(event, raw, 'action', ACTIONS)) return null;
    if (!assignEnum(event, raw, 'outcome', OUTCOMES)) return null;
    if (!assignEnum(event, raw, 'reason', REASONS)) return null;
    if (!assignEnum(event, raw, 'errorCategory', ERRORS)) return null;
    if (!assignEnum(event, raw, 'guard', GUARDS)) return null;
    return event;
}

export function isSafeCausalTraceEvent(value: unknown): value is SafeCausalTraceEvent {
    return normalizeCausalTraceEvent(value) !== null;
}

export function assertNoRawTraceSecrets(serialized: string): boolean {
    return !/(https?:\/\/|chrome-extension:\/\/|[?&][A-Za-z0-9_-]+=|#[A-Za-z0-9_-]+|Authorization|Bearer\s+|cookies?|headers?|@|rawUrl|rawTitle|taskId|TASK-RAW|PRIVATE-TITLE|secret|token|email)/i.test(serialized);
}

function assignPattern(target: SafeCausalTraceEvent, raw: Record<string, unknown>, key: keyof SafeCausalTraceEvent, pattern: RegExp): boolean {
    if (!(key in raw)) return true;
    if (typeof raw[key] !== 'string' || !pattern.test(raw[key] as string)) return false;
    (target as unknown as Record<string, unknown>)[key] = raw[key];
    return true;
}

function assignEnum(target: SafeCausalTraceEvent, raw: Record<string, unknown>, key: keyof SafeCausalTraceEvent, allowed: ReadonlySet<string>): boolean {
    if (!(key in raw)) return true;
    if (typeof raw[key] !== 'string' || !allowed.has(raw[key] as string)) return false;
    (target as unknown as Record<string, unknown>)[key] = raw[key];
    return true;
}

function assignBoolean(target: SafeCausalTraceEvent, raw: Record<string, unknown>, key: 'hasQuery' | 'hasFragment'): boolean {
    if (!(key in raw)) return true;
    if (typeof raw[key] !== 'boolean') return false;
    target[key] = raw[key] as boolean;
    return true;
}

function safeTimestamp(value: number): number { return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0; }
function isSafeId(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function safeEnum(value: unknown, allowed: ReadonlySet<string>): string | undefined { return typeof value === 'string' && allowed.has(value) ? value : undefined; }
function safeRef(value: string, fallbackPrefix: string): string { return /^[a-z]+-[a-z0-9-]{1,90}$/i.test(value) ? value : `${fallbackPrefix}-invalid`; }
function classifyError(error: unknown): string | undefined {
    if (!error) return undefined;
    const status = Number((error as { status?: unknown } | null)?.status);
    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 404) return 'not-found';
    if (status === 429) return 'rate-limited';
    if (status >= 500) return 'server-error';
    const name = typeof (error as { name?: unknown } | null)?.name === 'string' ? String((error as { name?: unknown }).name) : '';
    if (/permission|security/i.test(name)) return 'permission-error';
    if (/quota|overflow|limit/i.test(name)) return 'limit';
    return 'unknown';
}

function secureRandomHex(bytes: number): string {
    const cryptoValue = globalThis.crypto;
    if (cryptoValue?.getRandomValues) {
        const data = new Uint8Array(bytes);
        cryptoValue.getRandomValues(data);
        return Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}
