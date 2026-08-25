import type { CreateTaskPayload, EmailTaskMapping } from './types/clickup';

export type LinkValidationStatus =
    | 'pending'
    | 'partial_failed'
    | 'unverified'
    | 'linked'
    | 'unlinked_candidate'
    | 'unlinked'
    | 'not_found_candidate'
    | 'not_found'
    | 'auth_error'
    | 'rate_limited'
    | 'transient_error'
    | 'unknown_error';

export interface LinkValidationResult {
    status: LinkValidationStatus;
    valid: boolean;
    linked: boolean;
    task?: unknown;
    linkRecord?: EmailTaskMappingV2;
    retryAfterMs?: number;
    error?: string;
}

export type LinkSource = 'custom_field' | 'description' | 'comment' | 'sync' | 'legacy' | 'unknown';

export interface EmailTaskMappingV2 extends EmailTaskMapping {
    linkStatus: LinkValidationStatus;
    linkSource?: LinkSource;
    customFieldId?: string;
    createdAt: number;
    updatedAt: number;
    lastValidatedAt?: number;
    failureCount?: number;
}

export interface CustomFieldLike {
    id?: string;
    name?: string;
    value?: unknown;
    text_value?: unknown;
    applied_objects?: Array<{ object_type?: string | number; object_id?: string | number }>;
}

export type EmailTaskMappingsV1 = Record<string, EmailTaskMapping[]>;
export type EmailTaskMappingsV2 = Record<string, EmailTaskMappingV2[]>;

export const EMAIL_TASK_MAPPINGS_V2_KEY = 'emailTaskMappingsV2';
export const LINK_SCHEMA_VERSION = 2;
export const MAX_RETRY_DELAY_MS = 60_000;
export const LINK_REVALIDATION_TTL_MS = 5 * 60 * 1000;
export const HIERARCHY_PRELOAD_COOLDOWN_MS = 2 * 60 * 1000;

export interface HierarchyPreloadStatus {
    lastAttemptAt: number;
    lastSuccessAt?: number;
    status: 'in_progress' | 'success' | 'failed' | 'cooldown';
}

export function isConfirmedThreadId(threadId: unknown): threadId is string {
    if (typeof threadId !== 'string') return false;
    const trimmed = threadId.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (['unknown', 'undefined', 'null', 'temporary', 'fallback', 'pending', 'temp'].includes(lower)) return false;
    if (/^email_\d{10,}$/.test(lower)) return false;
    if (/^(temp|tmp|fallback)[_-]/.test(lower)) return false;
    if (/^email_(temp|tmp|fallback|unknown|undefined|null)/.test(lower)) return false;
    return true;
}

export function normalizeLegacyMapping(task: EmailTaskMapping, now = Date.now()): EmailTaskMappingV2 {
    const existing = task as EmailTaskMappingV2;
    return {
        id: task.id,
        name: typeof task.name === 'string' ? task.name : '',
        url: typeof task.url === 'string' ? task.url : '',
        status: typeof task.status === 'string' ? task.status : undefined,
        linkStatus: normalizeLinkStatus(existing.linkStatus),
        linkSource: normalizeLinkSource(existing.linkSource, 'legacy'),
        customFieldId: typeof existing.customFieldId === 'string' ? existing.customFieldId : undefined,
        createdAt: normalizeTimestamp(existing.createdAt || task.createdAt, now),
        updatedAt: normalizeTimestamp(existing.updatedAt, now),
        lastValidatedAt: normalizeOptionalTimestamp(existing.lastValidatedAt),
        failureCount: normalizeFailureCount(existing.failureCount),
    };
}

export function normalizeCustomFieldName(name: unknown): string {
    return typeof name === 'string' ? name.trim().toLocaleLowerCase() : '';
}

export function selectThreadIdCustomField(
    fields: CustomFieldLike[] | undefined | null,
    preferredFieldId?: string | null,
    configuredName?: string,
    customItemId?: string | number | null,
): CustomFieldLike | null {
    if (!Array.isArray(fields)) return null;
    const applicableFields = customItemId === undefined
        ? fields
        : fields.filter(field => {
            if (!Array.isArray(field.applied_objects) || field.applied_objects.length === 0) return true;
            if (customItemId === null) return false;
            return field.applied_objects.some(applied => String(applied.object_type) === '19' && String(applied.object_id) === String(customItemId));
        });

    if (preferredFieldId) {
        const byId = applicableFields.find(field => field.id === preferredFieldId);
        if (byId) return byId;
    }

    const normalizedName = normalizeCustomFieldName(configuredName || 'Gmail Thread ID');
    return applicableFields.find(field => normalizeCustomFieldName(field.name) === normalizedName) || null;
}

export function prepareThreadLinkedTaskPayload(
    taskData: CreateTaskPayload,
    fieldId: string | null | undefined,
    threadId: unknown,
): CreateTaskPayload {
    const payload = { ...taskData };
    delete payload.custom_fields;
    if (fieldId && isConfirmedThreadId(threadId)) {
        payload.custom_fields = [{ id: fieldId, value: threadId.trim() }];
    }
    return payload;
}

export function mergeThreadIdValue(existingValue: unknown, threadId: string): string {
    const existing = typeof existingValue === 'string' ? existingValue : '';
    const values = existing.split(',').map(value => value.trim()).filter(Boolean);
    if (!values.includes(threadId)) values.push(threadId);
    return values.join(',');
}

export function transitionLinkStatus(current: LinkValidationStatus | undefined, confirmed: boolean): LinkValidationStatus {
    if (confirmed) return 'linked';
    if (current === 'pending') return 'unverified';
    return current || 'unverified';
}

export function migrateMappingsV1ToV2(v1: EmailTaskMappingsV1 = {}, existingV2: EmailTaskMappingsV2 = {}, now = Date.now()): EmailTaskMappingsV2 {
    const migrated: EmailTaskMappingsV2 = sanitizeMappingsV2(existingV2);

    for (const [threadId, tasks] of Object.entries(v1)) {
        if (!isConfirmedThreadId(threadId)) continue;
        if (!Array.isArray(tasks)) continue;

        const current = migrated[threadId] ? [...migrated[threadId]] : [];

        for (const task of tasks) {
            if (!task?.id || typeof task.id !== 'string') continue;
            if (!current.some(existing => existing.id === task.id)) {
                current.push(normalizeLegacyMapping(task, now));
            }
        }

        migrated[threadId] = current;
    }

    return migrated;
}

export function readMappingsWithFallback(v2?: EmailTaskMappingsV2 | null, v1?: EmailTaskMappingsV1 | null, now = Date.now()): EmailTaskMappingsV2 {
    const sanitizedV2 = sanitizeMappingsV2(v2 || {});
    if (Object.keys(sanitizedV2).length > 0) {
        return migrateMappingsV1ToV2(v1 || {}, sanitizedV2, now);
    }
    return migrateMappingsV1ToV2(v1 || {}, {}, now);
}

export function sanitizeMappingsV2(v2: unknown): EmailTaskMappingsV2 {
    if (!v2 || typeof v2 !== 'object' || Array.isArray(v2)) return {};
    const sanitized: EmailTaskMappingsV2 = {};
    for (const [threadId, tasks] of Object.entries(v2 as Record<string, unknown>)) {
        if (!isConfirmedThreadId(threadId) || !Array.isArray(tasks)) continue;
        const validTasks = tasks.map(normalizeMappingV2).filter(Boolean) as EmailTaskMappingV2[];
        if (validTasks.length > 0) sanitized[threadId] = validTasks;
    }
    return sanitized;
}

export function normalizeMappingV2(task: unknown, now = Date.now()): EmailTaskMappingV2 | null {
    if (!task || typeof task !== 'object') return null;
    const candidate = task as Partial<EmailTaskMappingV2>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null;
    if (typeof candidate.name !== 'string') return null;
    if (typeof candidate.url !== 'string') return null;
    const createdAt = normalizeTimestamp(candidate.createdAt, now);
    const updatedAt = normalizeTimestamp(candidate.updatedAt, now);
    return {
        id: candidate.id,
        name: candidate.name,
        url: candidate.url,
        status: typeof candidate.status === 'string' ? candidate.status : undefined,
        linkStatus: normalizeLinkStatus(candidate.linkStatus),
        linkSource: normalizeLinkSource(candidate.linkSource, 'unknown'),
        customFieldId: typeof candidate.customFieldId === 'string' ? candidate.customFieldId : undefined,
        createdAt,
        updatedAt,
        lastValidatedAt: normalizeOptionalTimestamp(candidate.lastValidatedAt),
        failureCount: normalizeFailureCount(candidate.failureCount),
    };
}

export function isValidMappingV2(task: unknown): task is EmailTaskMappingV2 {
    if (!task || typeof task !== 'object') return false;
    const candidate = task as Partial<EmailTaskMappingV2>;
    return typeof candidate.id === 'string' && candidate.id.length > 0
        && typeof candidate.name === 'string'
        && typeof candidate.url === 'string'
        && typeof candidate.createdAt === 'number'
        && typeof candidate.updatedAt === 'number'
        && (!candidate.linkStatus || isKnownLinkStatus(candidate.linkStatus));
}

export function normalizeLinkStatus(status: unknown): LinkValidationStatus {
    const normalized = typeof status === 'string' ? status.trim().toLowerCase() : status;
    return isKnownLinkStatus(normalized) ? normalized : 'unverified';
}

export function normalizeLinkSource(source: unknown, fallback: LinkSource = 'unknown'): LinkSource {
    const normalized = typeof source === 'string' ? source.trim().toLowerCase() : source;
    return isKnownLinkSource(normalized) ? normalized : fallback;
}

export function isKnownLinkSource(source: unknown): source is LinkSource {
    return typeof source === 'string' && ['custom_field', 'description', 'comment', 'sync', 'legacy', 'unknown'].includes(source);
}

function normalizeTimestamp(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeOptionalTimestamp(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function normalizeFailureCount(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
}

export function isKnownLinkStatus(status: unknown): status is LinkValidationStatus {
    return typeof status === 'string' && [
        'pending', 'partial_failed', 'unverified', 'linked', 'unlinked_candidate', 'unlinked',
        'not_found_candidate', 'not_found', 'auth_error', 'rate_limited', 'transient_error', 'unknown_error'
    ].includes(status);
}

export function applyValidationToTask(task: EmailTaskMappingV2, result: LinkValidationResult, now = Date.now()): EmailTaskMappingV2 {
    const ambiguous: LinkValidationStatus[] = ['auth_error', 'rate_limited', 'transient_error', 'unknown_error'];
    let nextStatus = task.linkStatus;

    if (result.status === 'linked') {
        nextStatus = 'linked';
    } else if (result.status === 'not_found') {
        nextStatus = task.linkStatus === 'not_found_candidate' ? 'not_found' : 'not_found_candidate';
    } else if (result.status === 'unlinked') {
        nextStatus = task.linkStatus === 'unlinked_candidate' ? 'unlinked' : 'unlinked_candidate';
    } else if (!ambiguous.includes(result.status)) {
        nextStatus = result.status;
    }

    return {
        ...task,
        linkStatus: nextStatus,
        updatedAt: now,
        lastValidatedAt: now,
        failureCount: result.status === 'linked' ? 0 : (task.failureCount || 0) + 1,
    };
}

export function toVisibleLinkedTasks(tasks: EmailTaskMappingV2[] = []): EmailTaskMappingV2[] {
    return tasks.filter(task => task.linkStatus !== 'not_found' && task.linkStatus !== 'unlinked');
}

export function needsInactiveLinkConfirmation(task: EmailTaskMappingV2, result: LinkValidationResult): boolean {
    return (result.status === 'not_found' && task.linkStatus === 'not_found_candidate')
        || (result.status === 'unlinked' && task.linkStatus === 'unlinked_candidate');
}

export function shouldValidateLink(task: Pick<EmailTaskMappingV2, 'lastValidatedAt'>, now = Date.now(), ttlMs = LINK_REVALIDATION_TTL_MS): boolean {
    return !task.lastValidatedAt || now - task.lastValidatedAt >= ttlMs;
}

export function classifyValidationError(status?: number, error?: unknown): LinkValidationResult {
    if (status === 404) return { status: 'not_found', valid: false, linked: false, error: 'not_found' };
    if (status === 401 || status === 403) return { status: 'auth_error', valid: false, linked: false, error: 'auth_error' };
    if (status === 429) return { status: 'rate_limited', valid: false, linked: false, error: 'rate_limited' };
    if (typeof status === 'number' && status >= 500) return { status: 'transient_error', valid: false, linked: false, error: 'server_error' };

    const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
    if (message.includes('network') || message.includes('fetch')) {
        return { status: 'transient_error', valid: false, linked: false, error: 'network_error' };
    }

    return { status: 'unknown_error', valid: false, linked: false, error: 'unknown_error' };
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function commentsContainThreadId(comments: any[], threadId: string): boolean {
    if (!isConfirmedThreadId(threadId) || !Array.isArray(comments)) return false;
    const needles = [`**Thread ID:** ${threadId}`, `Thread ID: ${threadId}`, `inbox/${threadId}`];
    return comments.some(comment => {
        const text = String(comment?.comment_text || comment?.text || comment?.comment?.[0]?.text || '');
        return needles.some(needle => text.includes(needle));
    });
}

export function shouldAttemptHierarchyPreload(status: HierarchyPreloadStatus | null | undefined, now = Date.now(), cooldownMs = HIERARCHY_PRELOAD_COOLDOWN_MS): boolean {
    if (!status?.lastAttemptAt) return true;
    if (status.status === 'success') return true;
    return now - status.lastAttemptAt >= cooldownMs;
}

export function nextHierarchyPreloadStatus(previous: HierarchyPreloadStatus | null | undefined, status: HierarchyPreloadStatus['status'], now = Date.now()): HierarchyPreloadStatus {
    return {
        lastAttemptAt: now,
        lastSuccessAt: status === 'success' ? now : previous?.lastSuccessAt,
        status,
    };
}

export function calculateRetryDelayMs(headers: Headers | null | undefined, retryCount: number, now = Date.now(), random = Math.random): number {
    const retryAfter = headers?.get('Retry-After');
    const reset = headers?.get('X-RateLimit-Reset');
    let baseDelay = Math.pow(2, retryCount) * 1000;

    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) {
            baseDelay = seconds * 1000;
        } else {
            const dateDelay = Date.parse(retryAfter) - now;
            if (Number.isFinite(dateDelay) && dateDelay > 0) baseDelay = dateDelay;
        }
    } else if (reset) {
        const resetNumber = Number(reset);
        if (Number.isFinite(resetNumber)) {
            const resetMs = resetNumber > 10_000_000_000 ? resetNumber : resetNumber * 1000;
            baseDelay = Math.max(0, resetMs - now);
        }
    }

    const jitter = Math.floor(Math.min(baseDelay, 1000) * random());
    return Math.min(Math.max(0, baseDelay + jitter), MAX_RETRY_DELAY_MS);
}

export async function runWithConcurrencyLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const results: R[] = [];
    let nextIndex = 0;

    async function runWorker(): Promise<void> {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await worker(items[index], index);
        }
    }

    const workers = Array.from({ length: Math.min(safeLimit, items.length) }, () => runWorker());
    await Promise.all(workers);
    return results;
}

export class SingleFlight<K, V> {
    private inFlight = new Map<K, Promise<V>>();

    run(key: K, factory: () => Promise<V>): Promise<V> {
        const existing = this.inFlight.get(key);
        if (existing) return existing;

        const promise = factory().finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, promise);
        return promise;
    }
}
