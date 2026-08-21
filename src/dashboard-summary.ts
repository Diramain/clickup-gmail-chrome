import type { ClickUpTask, TimeEntry } from './types/clickup';
import { isCurrentTimeEntry, toTimeEntryTimestamp } from './time-entry-history';

export interface DashboardTaskTimeTotal {
    taskId: string;
    taskName: string;
    durationMs: number;
    lastTrackedAt: number;
}

export interface DashboardExecutionTask {
    taskId: string;
    taskName: string;
    taskUrl: string | null;
    dueAt: number | null;
    statusLabel: string;
    statusColor: string;
    priority: string | null;
    listName: string | null;
    listId: string | null;
    assignees: Array<{ id: string; name: string }>;
    trackedWeekMs: number;
}

export interface DashboardStatusItem {
    label: string;
    color: string;
    count: number;
}

export interface DashboardExecutionBoard {
    overdue: DashboardExecutionTask[];
    today: DashboardExecutionTask[];
    nextThreeDays: DashboardExecutionTask[];
    noDueDate: DashboardExecutionTask[];
    hiddenFutureCount: number;
    statuses: DashboardStatusItem[];
}

export interface DashboardSummary {
    generatedAt: number;
    periodStart: number;
    tasksToday: number;
    tasksOverdue: number;
    completedWeek: number;
    trackedTodayMs: number;
    gmailLinksWeek: number;
    taskTimeTotals: DashboardTaskTimeTotal[];
    executionBoard: DashboardExecutionBoard;
}

export interface DashboardSummaryInput {
    openTasks: ClickUpTask[];
    recentlyUpdatedTasks: ClickUpTask[];
    timeEntries: TimeEntry[];
    runningTimer: TimeEntry | null;
    gmailLinksWeek: number;
    currentUserId: number;
    now?: number;
}

function startOfLocalDay(timestamp: number): number {
    const value = new Date(timestamp);
    value.setHours(0, 0, 0, 0);
    return value.getTime();
}

function startOfLocalWeek(timestamp: number): number {
    const value = new Date(startOfLocalDay(timestamp));
    const mondayOffset = (value.getDay() + 6) % 7;
    value.setDate(value.getDate() - mondayOffset);
    return value.getTime();
}

function addLocalDays(timestamp: number, days: number): number {
    const value = new Date(timestamp);
    value.setDate(value.getDate() + days);
    return value.getTime();
}

function isAssignedTo(task: ClickUpTask, userId: number): boolean {
    return Array.isArray(task.assignees) && task.assignees.some((assignee) => Number(assignee.id) === userId);
}

function entryKey(entry: TimeEntry): string {
    if (entry.id) return `id:${entry.id}`;
    return `fallback:${entry.task?.id || 'none'}:${toTimeEntryTimestamp(entry.start)}`;
}

function entryDuration(entry: TimeEntry, running: TimeEntry | null, now: number): number {
    const isRunning = Boolean(running)
        && ((entry.id && running?.id && entry.id === running.id)
            || (entry.task?.id === running?.task?.id
                && toTimeEntryTimestamp(entry.start) === toTimeEntryTimestamp(running?.start)));
    if (isRunning || entry.running === true) return Math.max(0, now - toTimeEntryTimestamp(entry.start));
    const duration = Number(entry.duration);
    return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function overlapMs(start: number, duration: number, rangeStart: number, rangeEnd: number): number {
    const end = start + duration;
    return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
}

export function sanitizeClickUpStatusColor(value: unknown): string {
    if (typeof value !== 'string') return '#667085';
    const candidate = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(candidate)) {
        return `#${candidate.slice(1).split('').map((char) => char + char).join('')}`.toLowerCase();
    }
    return '#667085';
}

function priorityRank(priority: string | null): number {
    const normalized = String(priority || '').toLowerCase();
    return ({ urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>)[normalized] ?? 4;
}

function compareExecutionTasks(a: DashboardExecutionTask, b: DashboardExecutionTask): number {
    const dueA = a.dueAt ?? Number.MAX_SAFE_INTEGER;
    const dueB = b.dueAt ?? Number.MAX_SAFE_INTEGER;
    return dueA - dueB || priorityRank(a.priority) - priorityRank(b.priority) || a.taskName.localeCompare(b.taskName);
}

function toExecutionTask(task: ClickUpTask, weeklyTotals: Map<string, number>): DashboardExecutionTask {
    const taskId = String(task.id || '').trim().slice(0, 100);
    const due = Number(task.due_date);
    return {
        taskId,
        taskName: String(task.name || taskId || 'Tarea sin título').slice(0, 500),
        taskUrl: /^[A-Za-z0-9_-]{1,100}$/.test(taskId) ? `https://app.clickup.com/t/${encodeURIComponent(taskId)}` : null,
        dueAt: Number.isFinite(due) && due > 0 ? due : null,
        statusLabel: String(task.status?.status || 'Sin estado').slice(0, 100),
        statusColor: sanitizeClickUpStatusColor(task.status?.color),
        priority: task.priority?.priority ? String(task.priority.priority).slice(0, 30) : null,
        listName: task.list?.name ? String(task.list.name).slice(0, 200) : null,
        listId: /^[A-Za-z0-9_-]{1,100}$/.test(String(task.list?.id || '')) ? String(task.list.id) : null,
        assignees: Array.isArray(task.assignees) ? task.assignees.slice(0, 20).map((assignee) => ({
            id: String(assignee.id || '').slice(0, 100),
            name: String(assignee.username || assignee.initials || assignee.id || 'Responsable').slice(0, 200),
        })).filter((assignee) => assignee.id.length > 0) : [],
        trackedWeekMs: weeklyTotals.get(taskId) || 0,
    };
}

function buildExecutionBoard(tasks: ClickUpTask[], weeklyTotals: Map<string, number>, userId: number, todayStart: number, tomorrowStart: number): DashboardExecutionBoard {
    const futureCutoff = addLocalDays(todayStart, 4);
    const board: DashboardExecutionBoard = { overdue: [], today: [], nextThreeDays: [], noDueDate: [], hiddenFutureCount: 0, statuses: [] };
    const statusMap = new Map<string, DashboardStatusItem>();

    for (const task of tasks.filter((candidate) => isAssignedTo(candidate, userId))) {
        const item = toExecutionTask(task, weeklyTotals);
        const statusKey = `${item.statusLabel.toLocaleLowerCase()}|${item.statusColor}`;
        const status = statusMap.get(statusKey) || { label: item.statusLabel, color: item.statusColor, count: 0 };
        status.count += 1;
        statusMap.set(statusKey, status);

        if (item.dueAt === null) board.noDueDate.push(item);
        else if (item.dueAt < todayStart) board.overdue.push(item);
        else if (item.dueAt < tomorrowStart) board.today.push(item);
        else if (item.dueAt < futureCutoff) board.nextThreeDays.push(item);
        else board.hiddenFutureCount += 1;
    }

    board.overdue.sort(compareExecutionTasks);
    board.today.sort(compareExecutionTasks);
    board.nextThreeDays.sort(compareExecutionTasks);
    board.noDueDate.sort(compareExecutionTasks);
    board.statuses = [...statusMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return board;
}

export function buildDashboardSummary(input: DashboardSummaryInput): DashboardSummary {
    const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
    const todayStart = startOfLocalDay(now);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const todayEnd = tomorrowStart.getTime();
    const weekStart = startOfLocalWeek(now);

    const assignedDue = input.openTasks.filter((task) => isAssignedTo(task, input.currentUserId));
    const tasksToday = assignedDue.filter((task) => {
        const due = Number(task.due_date);
        return Number.isFinite(due) && due >= todayStart && due < todayEnd;
    }).length;
    const tasksOverdue = assignedDue.filter((task) => {
        const due = Number(task.due_date);
        return Number.isFinite(due) && due > 0 && due < todayStart;
    }).length;
    const completedWeek = input.recentlyUpdatedTasks.filter((task) => {
        if (!isAssignedTo(task, input.currentUserId)) return false;
        const closed = Number(task.date_closed);
        return Number.isFinite(closed) && closed >= weekStart && closed <= now;
    }).length;

    const unique = new Map<string, TimeEntry>();
    if (input.runningTimer) unique.set(entryKey(input.runningTimer), input.runningTimer);
    for (const entry of input.timeEntries) {
        if (isCurrentTimeEntry(entry, input.runningTimer)) continue;
        const key = entryKey(entry);
        if (!unique.has(key)) unique.set(key, entry);
    }

    let trackedTodayMs = 0;
    const totals = new Map<string, DashboardTaskTimeTotal>();
    for (const entry of unique.values()) {
        const start = toTimeEntryTimestamp(entry.start);
        const durationMs = entryDuration(entry, input.runningTimer, now);
        if (start <= 0 || durationMs <= 0) continue;
        trackedTodayMs += overlapMs(start, durationMs, todayStart, now);

        const taskId = String(entry.task?.id || '').trim();
        if (!taskId) continue;
        const weeklyDurationMs = overlapMs(start, durationMs, weekStart, now);
        if (weeklyDurationMs <= 0) continue;
        const existing = totals.get(taskId) || {
            taskId,
            taskName: String(entry.task?.name || taskId),
            durationMs: 0,
            lastTrackedAt: 0,
        };
        existing.durationMs += weeklyDurationMs;
        existing.lastTrackedAt = Math.max(existing.lastTrackedAt, Math.min(now, start + durationMs));
        if (existing.taskName === taskId && entry.task?.name) existing.taskName = entry.task.name;
        totals.set(taskId, existing);
    }

    const taskTimeTotals = [...totals.values()].sort((a, b) => b.durationMs - a.durationMs || a.taskId.localeCompare(b.taskId));
    const weeklyTotals = new Map(taskTimeTotals.map((total) => [total.taskId, total.durationMs]));

    return {
        generatedAt: now,
        periodStart: weekStart,
        tasksToday,
        tasksOverdue,
        completedWeek,
        trackedTodayMs,
        gmailLinksWeek: Math.max(0, Math.floor(Number(input.gmailLinksWeek) || 0)),
        taskTimeTotals,
        executionBoard: buildExecutionBoard(input.openTasks, weeklyTotals, input.currentUserId, todayStart, todayEnd),
    };
}
