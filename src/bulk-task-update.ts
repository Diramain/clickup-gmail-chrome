export interface BulkTaskChangeInput {
    taskId: string;
    listId: string;
    status?: string;
    dueDate?: number | null;
    assigneeId?: number;
}

export interface BulkTaskChangeResult {
    ok: boolean;
    taskId: string;
    outcome: 'applied' | 'skipped' | 'failed';
    code: string;
    stop: boolean;
}

interface TaskLike {
    id?: unknown;
    status?: { status?: unknown } | null;
    due_date?: unknown;
    assignees?: Array<{ id?: unknown }>;
    list?: { id?: unknown } | null;
}

interface ListLike { statuses?: Array<{ status?: unknown }> }
interface MembersLike { members?: Array<{ id?: unknown }> }

export interface BulkTaskUpdatePort {
    getTask(taskId: string): Promise<TaskLike>;
    getList(listId: string): Promise<ListLike>;
    getListMembers(listId: string): Promise<MembersLike>;
    updateTask(taskId: string, payload: Record<string, unknown>): Promise<TaskLike>;
}

function safeId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[\s/?#]/.test(value);
}

function currentAssigneeIds(task: TaskLike): number[] {
    return (Array.isArray(task.assignees) ? task.assignees : [])
        .map((assignee) => Number(assignee?.id))
        .filter((id) => Number.isInteger(id) && id > 0);
}

function normalizedDueDate(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const due = Number(value);
    return Number.isFinite(due) && due >= 0 ? due : null;
}

function failure(taskId: string, code: string): BulkTaskChangeResult {
    return { ok: false, taskId, outcome: 'failed', code, stop: true };
}

function classifyError(error: unknown): string {
    const status = Number((error as { status?: unknown } | null)?.status);
    if (status === 401) return 'AUTHENTICATION_REQUIRED';
    if (status === 403) return 'PERMISSION_DENIED';
    if (status === 404) return 'TASK_NOT_FOUND';
    if (status === 429) return 'RATE_LIMITED';
    return 'UNEXPECTED_RESPONSE';
}

export function isValidBulkTaskChange(input: unknown): input is BulkTaskChangeInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
    const value = input as Record<string, unknown>;
    if (!Object.keys(value).every((key) => ['taskId', 'listId', 'status', 'dueDate', 'assigneeId'].includes(key))) return false;
    if (!safeId(value.taskId) || !safeId(value.listId)) return false;
    if (value.status !== undefined && (typeof value.status !== 'string' || value.status.trim().length === 0 || value.status.length > 100)) return false;
    if (value.dueDate !== undefined && value.dueDate !== null && (!Number.isInteger(value.dueDate) || Number(value.dueDate) < 0)) return false;
    if (value.assigneeId !== undefined && (!Number.isInteger(value.assigneeId) || Number(value.assigneeId) <= 0)) return false;
    return value.status !== undefined || value.dueDate !== undefined || value.assigneeId !== undefined;
}

export async function applyValidatedBulkTaskChange(
    port: BulkTaskUpdatePort,
    input: BulkTaskChangeInput,
): Promise<BulkTaskChangeResult> {
    if (!isValidBulkTaskChange(input)) return failure('', 'INVALID_REQUEST');
    try {
        const task = await port.getTask(input.taskId);
        if (String(task.id || '') !== input.taskId || String(task.list?.id || '') !== input.listId) {
            return failure(input.taskId, 'TASK_CONTEXT_CHANGED');
        }

        const payload: Record<string, unknown> = {};
        if (input.status !== undefined) {
            const list = await port.getList(input.listId);
            const validStatus = (Array.isArray(list.statuses) ? list.statuses : [])
                .map((status) => typeof status?.status === 'string' ? status.status.trim() : '')
                .find((status) => status.toLocaleLowerCase() === input.status!.trim().toLocaleLowerCase());
            if (!validStatus) return failure(input.taskId, 'STATUS_NOT_COMPATIBLE');
            if (String(task.status?.status || '').toLocaleLowerCase() !== validStatus.toLocaleLowerCase()) payload.status = validStatus;
        }

        if (input.dueDate !== undefined && normalizedDueDate(task.due_date) !== input.dueDate) {
            payload.due_date = input.dueDate;
            payload.due_date_time = false;
        }

        if (input.assigneeId !== undefined) {
            const members = await port.getListMembers(input.listId);
            const compatible = (Array.isArray(members.members) ? members.members : [])
                .some((member) => Number(member?.id) === input.assigneeId);
            if (!compatible) return failure(input.taskId, 'ASSIGNEE_NOT_COMPATIBLE');
            const current = currentAssigneeIds(task);
            if (current.length !== 1 || current[0] !== input.assigneeId) {
                payload.assignees = {
                    add: current.includes(input.assigneeId) ? [] : [input.assigneeId],
                    rem: current.filter((id) => id !== input.assigneeId),
                };
            }
        }

        if (Object.keys(payload).length === 0) {
            return { ok: true, taskId: input.taskId, outcome: 'skipped', code: 'NO_CHANGES', stop: false };
        }

        await port.updateTask(input.taskId, payload);
        const verified = await port.getTask(input.taskId);
        if (String(verified.id || '') !== input.taskId || String(verified.list?.id || '') !== input.listId) {
            return failure(input.taskId, 'VERIFY_CONTEXT_FAILED');
        }
        if (input.status !== undefined && String(verified.status?.status || '').toLocaleLowerCase() !== input.status.trim().toLocaleLowerCase()) {
            return failure(input.taskId, 'VERIFY_STATUS_FAILED');
        }
        if (input.dueDate !== undefined && normalizedDueDate(verified.due_date) !== input.dueDate) {
            return failure(input.taskId, 'VERIFY_DUE_DATE_FAILED');
        }
        if (input.assigneeId !== undefined) {
            const verifiedAssignees = currentAssigneeIds(verified);
            if (verifiedAssignees.length !== 1 || verifiedAssignees[0] !== input.assigneeId) {
                return failure(input.taskId, 'VERIFY_ASSIGNEE_FAILED');
            }
        }
        return { ok: true, taskId: input.taskId, outcome: 'applied', code: 'APPLIED', stop: false };
    } catch (error) {
        return failure(input.taskId, classifyError(error));
    }
}
