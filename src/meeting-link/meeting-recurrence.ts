export const MAX_RECURRENCE_OCCURRENCES = 12;
export const MAX_RECURRENCE_DAYS = 90;

export interface RecurrenceWindowResult<T> {
    accepted: T[];
    truncated: boolean;
    reason?: 'max_occurrences' | 'max_days';
}

export function limitRecurrenceWindow<T extends { startTime: string }>(occurrences: readonly T[], anchorStartTime: string): RecurrenceWindowResult<T> {
    const anchor = Date.parse(anchorStartTime);
    if (!Number.isFinite(anchor)) return { accepted: [], truncated: true, reason: 'max_days' };
    const maxTime = anchor + MAX_RECURRENCE_DAYS * 24 * 60 * 60 * 1000;
    const accepted: T[] = [];
    for (const occurrence of occurrences) {
        const start = Date.parse(occurrence.startTime);
        if (!Number.isFinite(start) || start > maxTime) return { accepted, truncated: true, reason: 'max_days' };
        if (accepted.length >= MAX_RECURRENCE_OCCURRENCES) return { accepted, truncated: true, reason: 'max_occurrences' };
        accepted.push(occurrence);
    }
    return { accepted, truncated: false };
}
