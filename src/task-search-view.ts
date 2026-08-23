export interface SafeTaskSearchResult {
    id: string;
    name: string;
    status: string;
}

export function isTaskSearchFailure(response: unknown): boolean {
    if (!response || typeof response !== 'object') return true;
    const envelope = response as Record<string, unknown>;
    return envelope.success === false
        || envelope.requiresReauth === true
        || typeof envelope.error === 'string';
}

const MAX_RESULTS = 10;
const MAX_ID_LENGTH = 100;
const MAX_NAME_LENGTH = 500;
const MAX_STATUS_LENGTH = 100;

function boundedString(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function normalizeTaskSearchResponse(response: unknown): SafeTaskSearchResult[] {
    if (!response || typeof response !== 'object') return [];
    const tasks = (response as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) return [];

    return tasks.slice(0, MAX_RESULTS).flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const task = candidate as Record<string, unknown>;
        const id = boundedString(task.id, MAX_ID_LENGTH);
        const name = boundedString(task.name, MAX_NAME_LENGTH);
        if (!id || !name) return [];
        const statusObject = task.status && typeof task.status === 'object'
            ? task.status as Record<string, unknown>
            : null;
        const status = boundedString(statusObject?.status, MAX_STATUS_LENGTH) || 'Sin estado';
        return [{ id, name, status }];
    });
}

export function normalizeTaskSearchQuery(value: unknown): string {
    return boundedString(value, 100);
}
