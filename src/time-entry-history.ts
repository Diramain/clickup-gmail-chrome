import type { ClickUpUserResponse, TimeEntry } from './types/clickup';

export function toTimeEntryTimestamp(value: number | string | undefined): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

export function extractCurrentUserId(value: ClickUpUserResponse | { id?: unknown; user?: { id?: unknown } } | null): number | null {
    const candidate = value as { id?: unknown; user?: { id?: unknown } } | null;
    const rawId = candidate?.user?.id ?? candidate?.id;
    const userId = Number(rawId);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function entryKey(entry: TimeEntry): string {
    if (entry.id) return `id:${entry.id}`;
    return `fallback:${entry.task?.id || 'none'}:${toTimeEntryTimestamp(entry.start)}`;
}

export function isCurrentTimeEntry(entry: TimeEntry, current: TimeEntry | null): boolean {
    if (!current) return false;
    if (entry.id && current.id && entry.id === current.id) return true;
    return entry.task?.id === current.task?.id
        && toTimeEntryTimestamp(entry.start) === toTimeEntryTimestamp(current.start);
}

export function prepareRecentTimeEntries(entries: TimeEntry[], current: TimeEntry | null, limit = 10): TimeEntry[] {
    const unique = new Map<string, TimeEntry>();
    if (current) unique.set(entryKey(current), current);

    for (const entry of Array.isArray(entries) ? entries : []) {
        if (current && isCurrentTimeEntry(entry, current)) continue;
        const key = entryKey(entry);
        if (!unique.has(key)) unique.set(key, entry);
    }

    return [...unique.values()]
        .sort((a, b) => {
            const currentA = isCurrentTimeEntry(a, current);
            const currentB = isCurrentTimeEntry(b, current);
            if (currentA !== currentB) return currentA ? -1 : 1;
            return toTimeEntryTimestamp(b.start) - toTimeEntryTimestamp(a.start);
        })
        .slice(0, Math.max(0, limit));
}

export function getTimeEntryDurationMs(entry: TimeEntry, current: TimeEntry | null, now = Date.now()): number {
    if (isCurrentTimeEntry(entry, current)) {
        return Math.max(0, now - toTimeEntryTimestamp(entry.start));
    }

    const duration = Number(entry.duration);
    return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

export function getTimeEntryTaskUrl(entry: TimeEntry): string | null {
    const taskId = String(entry.task?.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(taskId)) return null;
    return `https://app.clickup.com/t/${encodeURIComponent(taskId)}`;
}
