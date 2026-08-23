export interface MeetMappingTaskDetail {
    id: string;
    name: string;
    status: string;
}

export const MEET_MAPPING_TASK_CACHE_LIMIT = 50;

export function normalizeMeetMappingTaskDetail(value: unknown, taskId: string): MeetMappingTaskDetail {
    const fallback: MeetMappingTaskDetail = { id: taskId, name: 'Tarea no disponible', status: 'No disponible' };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const task = value as Record<string, unknown>;
    if (task.id !== taskId) return fallback;
    const name = typeof task.name === 'string' ? task.name.trim().slice(0, 500) : '';
    const rawStatus = task.status && typeof task.status === 'object' && !Array.isArray(task.status)
        ? (task.status as Record<string, unknown>).status
        : task.status;
    const status = typeof rawStatus === 'string' ? rawStatus.trim().slice(0, 100) : '';
    return {
        id: taskId,
        name: name || fallback.name,
        status: status || 'Sin estado',
    };
}

export class MeetMappingTaskCache {
    private readonly values = new Map<string, MeetMappingTaskDetail>();

    get(taskId: string): MeetMappingTaskDetail | undefined {
        return this.values.get(taskId);
    }

    set(detail: MeetMappingTaskDetail): void {
        this.values.delete(detail.id);
        this.values.set(detail.id, detail);
        while (this.values.size > MEET_MAPPING_TASK_CACHE_LIMIT) {
            const oldest = this.values.keys().next().value;
            if (typeof oldest !== 'string') break;
            this.values.delete(oldest);
        }
    }

    get size(): number {
        return this.values.size;
    }
}
