const CLICKUP_ORIGIN = 'https://app.clickup.com';
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const WORKSPACE_ID_PATTERN = /^\d{1,20}$/;
export const CLICKUP_TASK_TAB_INDEX_MAX_ENTRIES = 256;

export type ClickUpFocusContext =
    | { kind: 'task'; taskId: string; source: 'direct' | 'inbox-notification' }
    | { kind: 'no-task'; source: 'inbox' | 'clickup-other' }
    | { kind: 'outside-clickup'; source: 'outside-clickup' };

export interface FocusedTabSnapshot {
    windowId: number;
    tabId: number;
    url: string;
}

export interface TimerAutoSettings {
    autoStartTimer: boolean;
    autoStopTimer: boolean;
}

export type ClickUpTaskTabIndex = Record<string, string>;

export interface RemovedClickUpTaskTab {
    nextIndex: ClickUpTaskTabIndex;
    taskId: string | null;
}

export interface ClickUpTaskTabIndexTransition {
    nextIndex: ClickUpTaskTabIndex;
    previousTaskId: string | null;
    nextTaskId: string | null;
    exitedTaskId: string | null;
    outcome: 'index-hit' | 'index-miss';
}

export type FocusedTimerAction =
    | { type: 'none'; reason: string }
    | { type: 'stop'; reason: string }
    | { type: 'start'; taskId: string; reason: string }
    | { type: 'switch'; taskId: string; reason: string };

export type FocusedTimerExecutionResult =
    | 'none'
    | 'stale'
    | 'invalid-task'
    | 'stopped'
    | 'started'
    | 'switched'
    | 'stopped-after-focus-change';

export interface ManualStopSuppressionResult {
    action: FocusedTimerAction;
    nextSuppressedTaskId: string | null;
}

export interface FocusedTimerExecutor {
    isCurrent(): Promise<boolean>;
    validateTask(taskId: string): Promise<boolean>;
    stopTimer(): Promise<void>;
    startTimer(taskId: string): Promise<void>;
}

export function isValidClickUpTaskId(value: unknown): value is string {
    return typeof value === 'string' && TASK_ID_PATTERN.test(value);
}

export function getClickUpTaskIdFromUrl(rawUrl: string | undefined | null): string | null {
    const context = resolveClickUpFocusContext(rawUrl);
    return context.kind === 'task' ? context.taskId : null;
}

export function sanitizeClickUpTaskTabIndex(value: unknown): ClickUpTaskTabIndex {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    const sanitized: ClickUpTaskTabIndex = {};
    for (const [rawTabId, taskId] of Object.entries(value as Record<string, unknown>)) {
        if (Object.keys(sanitized).length >= CLICKUP_TASK_TAB_INDEX_MAX_ENTRIES) break;
        if (!/^\d{1,15}$/.test(rawTabId)) continue;
        const tabId = Number(rawTabId);
        if (!Number.isSafeInteger(tabId) || tabId < 0 || !isValidClickUpTaskId(taskId)) continue;
        sanitized[String(tabId)] = taskId;
    }
    return sanitized;
}

export function updateClickUpTaskTabIndex(
    value: unknown,
    tabId: number,
    rawUrl: string | undefined | null,
): ClickUpTaskTabIndex {
    const next = sanitizeClickUpTaskTabIndex(value);
    if (!Number.isSafeInteger(tabId) || tabId < 0) return next;

    const key = String(tabId);
    const taskId = getClickUpTaskIdFromUrl(rawUrl);
    if (!taskId) {
        delete next[key];
        return next;
    }

    if (next[key] || Object.keys(next).length < CLICKUP_TASK_TAB_INDEX_MAX_ENTRIES) {
        next[key] = taskId;
    }
    return next;
}

export function decideClickUpTaskTabIndexTransition(
    value: unknown,
    tabId: number,
    rawUrl: string | undefined | null,
): ClickUpTaskTabIndexTransition {
    const current = sanitizeClickUpTaskTabIndex(value);
    const previousTaskId = Number.isSafeInteger(tabId) && tabId >= 0 ? current[String(tabId)] || null : null;
    const nextIndex = updateClickUpTaskTabIndex(current, tabId, rawUrl);
    const nextTaskId = Number.isSafeInteger(tabId) && tabId >= 0 ? nextIndex[String(tabId)] || null : null;
    return {
        nextIndex,
        previousTaskId,
        nextTaskId,
        exitedTaskId: previousTaskId && previousTaskId !== nextTaskId ? previousTaskId : null,
        outcome: previousTaskId || nextTaskId ? 'index-hit' : 'index-miss',
    };
}

export function removeClickUpTaskTabIndexEntry(value: unknown, tabId: number): RemovedClickUpTaskTab {
    const nextIndex = sanitizeClickUpTaskTabIndex(value);
    if (!Number.isSafeInteger(tabId) || tabId < 0) return { nextIndex, taskId: null };

    const key = String(tabId);
    const taskId = nextIndex[key] || null;
    delete nextIndex[key];
    return { nextIndex, taskId };
}

export function hasOpenClickUpTaskTab(
    taskId: string,
    tabUrls: ReadonlyArray<string | undefined | null>,
): boolean {
    if (!isValidClickUpTaskId(taskId)) return false;
    return tabUrls.some((url) => getClickUpTaskIdFromUrl(url) === taskId);
}

export function decideLastTaskTabCloseAction(
    settings: Pick<TimerAutoSettings, 'autoStopTimer'>,
    closedTaskId: string | null,
    runningTaskId: string | null,
    remainingTabUrls: ReadonlyArray<string | undefined | null>,
    meetPriorityActive: boolean,
): FocusedTimerAction {
    if (meetPriorityActive) return { type: 'none', reason: 'meet-priority' };
    if (!settings.autoStopTimer) return { type: 'none', reason: 'auto-stop-disabled' };
    if (!isValidClickUpTaskId(closedTaskId)) return { type: 'none', reason: 'closed-task-unknown' };
    if (!isValidClickUpTaskId(runningTaskId)) return { type: 'none', reason: 'running-task-unknown' };
    if (closedTaskId !== runningTaskId) return { type: 'none', reason: 'closed-different-task' };
    if (hasOpenClickUpTaskTab(runningTaskId, remainingTabUrls)) {
        return { type: 'none', reason: 'same-task-tab-open' };
    }
    return { type: 'stop', reason: 'last-task-tab-closed' };
}

export function resolveClickUpFocusContext(rawUrl: string | undefined | null): ClickUpFocusContext {
    if (!rawUrl) return { kind: 'outside-clickup', source: 'outside-clickup' };

    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { kind: 'outside-clickup', source: 'outside-clickup' };
    }

    if (url.origin !== CLICKUP_ORIGIN) {
        return { kind: 'outside-clickup', source: 'outside-clickup' };
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const directTaskId = extractTaskIdFromDirectPath(parts);
    if (directTaskId) return { kind: 'task', taskId: directTaskId, source: 'direct' };

    const inboxIndex = parts.indexOf('inbox');
    if (inboxIndex >= 0) {
        if (parts[inboxIndex + 1] === 'b' && parts[inboxIndex + 2]) {
            const taskId = extractTaskIdFromInboxBundle(parts[inboxIndex + 2]);
            if (taskId) return { kind: 'task', taskId, source: 'inbox-notification' };
        }
        return { kind: 'no-task', source: 'inbox' };
    }

    return { kind: 'no-task', source: 'clickup-other' };
}

export function extractTaskIdFromDirectPath(parts: string[]): string | null {
    if (parts[0] !== 't') return null;
    if (parts.length === 2
        && !WORKSPACE_ID_PATTERN.test(parts[1])
        && isValidClickUpTaskId(parts[1])) {
        return parts[1];
    }
    if (parts.length === 3
        && WORKSPACE_ID_PATTERN.test(parts[1])
        && isValidClickUpTaskId(parts[2])) {
        return parts[2];
    }
    return null;
}

export function extractTaskIdFromInboxBundle(encodedBundle: string): string | null {
    const candidates = collectBundleCandidates(encodedBundle);

    for (const candidate of candidates) {
        const parsed = parseBundleJson(candidate);
        if (!parsed || parsed.entityResourceType !== 'task') continue;
        if (isValidClickUpTaskId(parsed.entityResourceId)) return parsed.entityResourceId;
    }

    return null;
}

export function decideFocusedTimerAction(
    settings: TimerAutoSettings,
    context: ClickUpFocusContext,
    runningTaskId: string | null,
): FocusedTimerAction {
    if (!settings.autoStartTimer && !settings.autoStopTimer) {
        return { type: 'none', reason: 'disabled' };
    }

    if (context.kind === 'outside-clickup') {
        return { type: 'none', reason: 'outside-clickup' };
    }

    if (context.kind === 'no-task') {
        return { type: 'none', reason: context.source };
    }

    if (runningTaskId === context.taskId) {
        return { type: 'none', reason: 'same-task' };
    }

    if (runningTaskId) {
        if (settings.autoStopTimer && settings.autoStartTimer) {
            return { type: 'switch', taskId: context.taskId, reason: context.source };
        }
        if (settings.autoStopTimer) {
            return { type: 'stop', reason: 'different-task' };
        }
        return { type: 'none', reason: 'timer-already-running' };
    }

    return settings.autoStartTimer
        ? { type: 'start', taskId: context.taskId, reason: context.source }
        : { type: 'none', reason: 'auto-start-disabled' };
}

export function applyManualStopSuppression(
    action: FocusedTimerAction,
    suppressedTaskId: string | null,
): ManualStopSuppressionResult {
    if (!suppressedTaskId) return { action, nextSuppressedTaskId: null };
    if (action.type !== 'start' && action.type !== 'switch') {
        return { action, nextSuppressedTaskId: suppressedTaskId };
    }
    if (action.taskId === suppressedTaskId) {
        return {
            action: { type: 'none', reason: 'manually-stopped' },
            nextSuppressedTaskId: suppressedTaskId,
        };
    }
    return { action, nextSuppressedTaskId: suppressedTaskId };
}

export async function executeFocusedTimerAction(
    action: FocusedTimerAction,
    executor: FocusedTimerExecutor,
): Promise<FocusedTimerExecutionResult> {
    if (action.type === 'none') return 'none';

    if ((action.type === 'start' || action.type === 'switch')
        && !await executor.validateTask(action.taskId)) {
        return 'invalid-task';
    }

    if (!await executor.isCurrent()) return 'stale';

    if (action.type === 'stop') {
        await executor.stopTimer();
        return 'stopped';
    }

    if (action.type === 'switch') {
        await executor.stopTimer();
        if (!await executor.isCurrent()) return 'stopped-after-focus-change';
        await executor.startTimer(action.taskId);
        return 'switched';
    }

    await executor.startTimer(action.taskId);
    return 'started';
}

function collectBundleCandidates(encodedBundle: string): string[] {
    const candidates = new Set<string>();
    let current = encodedBundle;

    for (let i = 0; i < 3; i += 1) {
        candidates.add(current);
        try {
            const decoded = decodeURIComponent(current);
            if (decoded === current) break;
            current = decoded;
        } catch {
            break;
        }
    }

    for (const candidate of [...candidates]) {
        const decodedBase64 = decodeBase64Utf8(candidate);
        if (decodedBase64) candidates.add(decodedBase64);
    }

    return [...candidates];
}

function parseBundleJson(candidate: string): { entityResourceType?: unknown; entityResourceId?: unknown } | null {
    try {
        const value = JSON.parse(candidate);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

function decodeBase64Utf8(value: string): string | null {
    try {
        if (value.length === 0 || value.length > 20_000) return null;
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
        return decodeURIComponent(Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
    } catch {
        return null;
    }
}
