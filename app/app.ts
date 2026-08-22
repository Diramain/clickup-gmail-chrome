import { classifyLocalClickUpStatus, type ClickUpConnectionView } from '../src/connections-state';
import { isTaskSearchFailure, normalizeTaskSearchQuery, normalizeTaskSearchResponse, type SafeTaskSearchResult } from '../src/task-search-view';
import {
    classifyDestinationState,
    describeDestinationState,
    filterDestinationLists,
    normalizeDestinationOptions,
    sanitizeDestinationSelection,
    type DestinationOptions,
    type DestinationSelection,
} from '../src/destination-config';
import '../popup/popup';
import { initCausalRecorder } from '../diagnostics/recorder';
import type { DashboardExecutionBoard, DashboardExecutionTask, DashboardStatusItem, DashboardSummary, DashboardTaskTimeTotal } from '../src/dashboard-summary';
import type { BulkTaskChangeInput, BulkTaskChangeResult } from '../src/bulk-task-update';
import type { CalendarAgendaItemV1, CalendarAgendaState, CalendarAgendaViewV1 } from '../src/calendar/calendar-agenda';
import type { CalendarTaskLinkScope, CalendarTaskTypeSelectionV1 } from '../src/calendar/calendar-linking';
import type { ClickUpCustomTaskType } from '../src/types/clickup';

const ROUTES = Object.freeze(['inicio', 'gmail', 'tiempo', 'meet', 'sync', 'conexion', 'datos']);
type AppRoute = typeof ROUTES[number];
let refreshDefaultDestination: (() => Promise<void>) | null = null;

const ROUTE_TITLES: Record<AppRoute, string> = {
    inicio: 'Inicio',
    gmail: 'Integración con Gmail',
    tiempo: 'Jornada y tiempo',
    meet: 'Calendar y Meet',
    sync: 'Sincronización',
    conexion: 'Conexión',
    datos: 'Datos y diagnóstico',
};

export function sanitizeAppRoute(hash: string): AppRoute {
    const route = hash.replace(/^#/, '').toLowerCase();
    return (ROUTES as readonly string[]).includes(route) ? route as AppRoute : 'inicio';
}

export function renderAppRoute(route: AppRoute, focusHeading = false): void {
    document.querySelectorAll<HTMLElement>('[data-page]').forEach((section) => {
        section.hidden = section.dataset.page !== route;
    });

    document.querySelectorAll<HTMLAnchorElement>('[data-route]').forEach((link) => {
        if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = ROUTE_TITLES[route];
    document.title = `${ROUTE_TITLES[route]} · ClickUp Gmail Tracker`;
    if (route === 'gmail' && refreshDefaultDestination) void refreshDefaultDestination();

    if (focusHeading) {
        const heading = document.querySelector<HTMLElement>(`[data-page="${route}"] h2`);
        if (heading) {
            heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
        }
    }
}

export function initAppNavigation(): void {
    renderAppRoute(sanitizeAppRoute(window.location.hash));
    window.addEventListener('hashchange', () => {
        renderAppRoute(sanitizeAppRoute(window.location.hash), true);
    });
}

export async function initGmailIntegrationPreference(): Promise<void> {
    const toggle = document.getElementById('gmailIntegrationToggle') as HTMLInputElement | null;
    const status = document.getElementById('gmailIntegrationStatus');
    if (!toggle || !status) return;

    const render = (enabled: boolean, saved = false): void => {
        toggle.checked = enabled;
        status.textContent = `${saved ? 'Guardado. ' : ''}Los controles de ClickUp están ${enabled ? 'visibles' : 'ocultos'} en Gmail.`;
    };

    try {
        const preference = await chrome.runtime.sendMessage({ action: 'getGmailIntegrationPreference' }) as { enabled?: boolean };
        render(preference?.enabled !== false);
    } catch {
        render(true);
        status.textContent = 'No se pudo leer la preferencia; los controles permanecen visibles.';
    }

    toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try {
            await chrome.runtime.sendMessage({
                action: 'setGmailIntegrationPreference',
                data: { enabled: toggle.checked },
            });
            render(toggle.checked, true);
        } catch {
            toggle.checked = !toggle.checked;
            status.textContent = 'No se pudo guardar el cambio.';
        } finally {
            toggle.disabled = false;
        }
    });
}

/* ------------------------------------------------------------------ *
 * Preferencias locales
 *
 * Las preferencias visuales usan `localStorage` detrás de un puerto
 * inyectable. La jornada usa su propia clave versionada en
 * `chrome.storage.local`; no comparte datos ni autoridad con el background.
 * ------------------------------------------------------------------ */

export interface PreferencePort {
    read(key: string): string | null;
    write(key: string, value: string): void;
}

const localPreferencePort: PreferencePort = {
    read(key) {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    write(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch {
            /* almacenamiento bloqueado: la preferencia se pierde, la app sigue */
        }
    },
};

export const THEME_STORAGE_KEY = 'cgc-app-theme-v1';
export const DASHBOARD_STORAGE_PREFIX = 'cgc-app-dashboard-config-v1';
export const EXECUTION_BOARD_STORAGE_KEY = 'cgc-execution-board-preferences-v1';
export const TASK_TIME_SORT_STORAGE_KEY = 'cgc-task-time-sort-v1';
export const WORK_SCHEDULE_STORAGE_KEY = 'cgc-work-schedule-v1';
export type TaskTimeSort = 'duration' | 'recent';

export const WORK_WEEK_DAYS = Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const);
export type WorkWeekDay = typeof WORK_WEEK_DAYS[number];

export interface WorkScheduleSettingsV1 {
    version: 1;
    workdays: WorkWeekDay[];
    dailyTargetHours: number;
}

export interface WorkScheduleStoragePort {
    read(): Promise<unknown>;
    write(settings: WorkScheduleSettingsV1): Promise<void>;
}

export function defaultWorkScheduleSettings(): WorkScheduleSettingsV1 {
    return { version: 1, workdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], dailyTargetHours: 8 };
}

export function normalizeDailyTargetHours(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 8;
    return Math.min(24, Math.max(0.5, Math.round(parsed * 2) / 2));
}

export function normalizeWorkScheduleSettings(value: unknown): WorkScheduleSettingsV1 {
    const fallback = defaultWorkScheduleSettings();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const source = value as Partial<WorkScheduleSettingsV1>;
    if (source.version !== 1 || !Array.isArray(source.workdays)) return fallback;
    const workdays = WORK_WEEK_DAYS.filter((day) => source.workdays!.includes(day));
    return { version: 1, workdays, dailyTargetHours: normalizeDailyTargetHours(source.dailyTargetHours) };
}

export function weeklyTargetHours(settings: WorkScheduleSettingsV1): number {
    return Math.round(settings.workdays.length * settings.dailyTargetHours * 10) / 10;
}

const chromeWorkScheduleStoragePort: WorkScheduleStoragePort = {
    async read() {
        const stored = await chrome.storage.local.get(WORK_SCHEDULE_STORAGE_KEY);
        return stored[WORK_SCHEDULE_STORAGE_KEY];
    },
    async write(settings) {
        await chrome.storage.local.set({ [WORK_SCHEDULE_STORAGE_KEY]: settings });
    },
};

export async function initWorkSchedule(port: WorkScheduleStoragePort = chromeWorkScheduleStoragePort): Promise<void> {
    const targetInput = document.getElementById('dailyTrackedHoursTarget') as HTMLInputElement | null;
    const weeklyOutput = document.getElementById('weeklyTrackedHoursTarget');
    const status = document.getElementById('workScheduleStatus');
    const dayInputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-workday]'));
    if (!targetInput || !weeklyOutput || !status || dayInputs.length !== WORK_WEEK_DAYS.length) return;

    let settings = defaultWorkScheduleSettings();
    try { settings = normalizeWorkScheduleSettings(await port.read()); }
    catch { status.textContent = 'No se pudo leer la jornada guardada; se muestran los valores predeterminados.'; }

    const render = (): void => {
        targetInput.value = String(settings.dailyTargetHours);
        for (const input of dayInputs) input.checked = settings.workdays.includes(input.dataset.workday as WorkWeekDay);
        const weekly = weeklyTargetHours(settings);
        weeklyOutput.textContent = `${weekly.toLocaleString('es-AR', { maximumFractionDigits: 1 })} h por semana`;
    };
    const save = async (): Promise<void> => {
        status.textContent = 'Guardando jornada local…';
        try {
            await port.write(settings);
            status.textContent = 'Jornada guardada sólo en este navegador.';
        } catch {
            status.textContent = 'No se pudo guardar la jornada en este navegador.';
        }
    };

    for (const input of dayInputs) {
        input.addEventListener('change', () => {
            settings = {
                ...settings,
                workdays: WORK_WEEK_DAYS.filter((day) => dayInputs.some((candidate) => candidate.dataset.workday === day && candidate.checked)),
            };
            render();
            void save();
        });
    }
    targetInput.addEventListener('change', () => {
        settings = { ...settings, dailyTargetHours: normalizeDailyTargetHours(targetInput.value) };
        render();
        void save();
    });
    render();
}

export const EXECUTION_COLUMN_IDS = Object.freeze(['overdue', 'today', 'next', 'undated'] as const);
export type ExecutionColumnId = typeof EXECUTION_COLUMN_IDS[number];
export type ExecutionDateSort = 'asc' | 'desc';

export interface ExecutionBoardPreferences {
    columnOrder: ExecutionColumnId[];
    dateSort: Record<ExecutionColumnId, ExecutionDateSort>;
}

export function defaultExecutionBoardPreferences(): ExecutionBoardPreferences {
    return {
        columnOrder: [...EXECUTION_COLUMN_IDS],
        dateSort: { overdue: 'asc', today: 'asc', next: 'asc', undated: 'asc' },
    };
}

export function normalizeExecutionBoardPreferences(value: unknown): ExecutionBoardPreferences {
    const fallback = defaultExecutionBoardPreferences();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const source = value as Partial<ExecutionBoardPreferences>;
    const columnOrder: ExecutionColumnId[] = [];
    if (Array.isArray(source.columnOrder)) {
        for (const id of source.columnOrder) {
            if (!EXECUTION_COLUMN_IDS.includes(id as ExecutionColumnId) || columnOrder.includes(id as ExecutionColumnId)) continue;
            columnOrder.push(id as ExecutionColumnId);
        }
    }
    for (const id of EXECUTION_COLUMN_IDS) if (!columnOrder.includes(id)) columnOrder.push(id);
    const dateSort = { ...fallback.dateSort };
    for (const id of EXECUTION_COLUMN_IDS) {
        if (source.dateSort?.[id] === 'desc') dateSort[id] = 'desc';
    }
    return { columnOrder, dateSort };
}

export function readExecutionBoardPreferences(port: PreferencePort = localPreferencePort): ExecutionBoardPreferences {
    const raw = port.read(EXECUTION_BOARD_STORAGE_KEY);
    if (!raw) return defaultExecutionBoardPreferences();
    try {
        return normalizeExecutionBoardPreferences(JSON.parse(raw));
    } catch {
        return defaultExecutionBoardPreferences();
    }
}

export function writeExecutionBoardPreferences(port: PreferencePort, preferences: ExecutionBoardPreferences): void {
    port.write(EXECUTION_BOARD_STORAGE_KEY, JSON.stringify(normalizeExecutionBoardPreferences(preferences)));
}

interface DashboardSnapshot extends DashboardSummary {
    source: 'network' | 'cache';
    expiresAt: number;
}

export interface DashboardSummaryPort {
    read(forceRefresh?: boolean): Promise<DashboardSnapshot>;
}

const chromeDashboardSummaryPort: DashboardSummaryPort = {
    read: (forceRefresh = false) => chrome.runtime.sendMessage({ action: forceRefresh ? 'refreshDashboardSummary' : 'getDashboardSummary' }),
};

let executionPreferences = defaultExecutionBoardPreferences();
let executionPreferencePort: PreferencePort = localPreferencePort;
let executionActiveStatus: string | null = null;
let latestExecutionBoard: DashboardExecutionBoard | null = null;
let taskTimeSort: TaskTimeSort = 'duration';
let latestTaskTimeTotals: DashboardTaskTimeTotal[] = [];
let executionSelectionMode = false;
const selectedExecutionTaskIds = new Set<string>();

export function formatDashboardDuration(durationMs: number): string {
    const safe = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    const totalMinutes = Math.floor(safe / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

function setDashboardValue(id: string, value: string): void {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
}

export function sortDashboardTaskTotals(totals: readonly DashboardTaskTimeTotal[], sort: TaskTimeSort): DashboardTaskTimeTotal[] {
    return [...totals].sort((a, b) => sort === 'recent'
        ? b.lastTrackedAt - a.lastTrackedAt || b.durationMs - a.durationMs || a.taskId.localeCompare(b.taskId)
        : b.durationMs - a.durationMs || b.lastTrackedAt - a.lastTrackedAt || a.taskId.localeCompare(b.taskId));
}

export function renderDashboardTaskTotals(totals: DashboardTaskTimeTotal[]): void {
    latestTaskTimeTotals = totals;
    const container = document.getElementById('dashboardTaskTimeTotals');
    if (!container) return;
    container.replaceChildren();
    if (totals.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'dashboard-time-empty';
        empty.textContent = 'No hay entradas de tiempo asociadas a tareas en este período.';
        container.append(empty);
        return;
    }
    for (const total of sortDashboardTaskTotals(totals, taskTimeSort).slice(0, 8)) {
        const row = document.createElement('div');
        row.className = 'dashboard-time-row';
        const identity = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = total.taskName;
        const id = document.createElement('small');
        const lastTracked = total.lastTrackedAt > 0
            ? new Date(total.lastTrackedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
            : 'Sin actividad reciente';
        id.textContent = `${total.taskId} · último: ${lastTracked}`;
        identity.append(name, id);
        const duration = document.createElement('time');
        duration.textContent = formatDashboardDuration(total.durationMs);
        duration.dateTime = `PT${Math.floor(total.durationMs / 3_600_000)}H${Math.floor((total.durationMs % 3_600_000) / 60_000)}M`;
        row.append(identity, duration);
        container.append(row);
    }
}

export function initTaskTimeSort(port: PreferencePort = localPreferencePort): void {
    const select = document.getElementById('taskTimeSort') as HTMLSelectElement | null;
    if (!select || select.dataset.sortReady === 'true') return;
    select.dataset.sortReady = 'true';
    taskTimeSort = port.read(TASK_TIME_SORT_STORAGE_KEY) === 'recent' ? 'recent' : 'duration';
    select.value = taskTimeSort;
    select.addEventListener('change', () => {
        taskTimeSort = select.value === 'recent' ? 'recent' : 'duration';
        port.write(TASK_TIME_SORT_STORAGE_KEY, taskTimeSort);
        renderDashboardTaskTotals(latestTaskTimeTotals);
    });
}

function applyStatusPalette(node: HTMLElement, color: string): void {
    const safe = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#667085';
    const red = Number.parseInt(safe.slice(1, 3), 16) / 255;
    const green = Number.parseInt(safe.slice(3, 5), 16) / 255;
    const blue = Number.parseInt(safe.slice(5, 7), 16) / 255;
    const linear = (channel: number): number => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    const luminance = .2126 * linear(red) + .7152 * linear(green) + .0722 * linear(blue);
    const foreground = luminance > .179 ? '#111111' : '#ffffff';
    node.style.setProperty('--status-bg', safe);
    node.style.setProperty('--status-border', safe);
    node.style.setProperty('--status-color', foreground);
    node.style.setProperty('--status-text', foreground);
}

function safeStatusColor(color: string): string {
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#667085';
}

export function executionStatusKey(status: Pick<DashboardStatusItem, 'label' | 'color'>): string {
    return JSON.stringify([status.label.trim().toLocaleLowerCase(), safeStatusColor(status.color)]);
}

function createStatusPill(status: Pick<DashboardStatusItem, 'label' | 'color'>, count?: number): HTMLElement {
    const pill = document.createElement('span');
    pill.className = 'status-pill';
    applyStatusPalette(pill, status.color);
    const text = document.createElement('span');
    text.textContent = count === undefined ? status.label : `${status.label} · ${count}`;
    pill.append(text);
    return pill;
}

function formatTaskDueDate(timestamp: number | null): string {
    if (timestamp === null) return 'Sin fecha';
    return new Date(timestamp).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
}

export function sortExecutionTasks(tasks: readonly DashboardExecutionTask[], direction: ExecutionDateSort): DashboardExecutionTask[] {
    const factor = direction === 'desc' ? -1 : 1;
    return [...tasks].sort((a, b) => {
        const dueA = a.dueAt ?? 0;
        const dueB = b.dueAt ?? 0;
        if (dueA !== dueB) return (dueA - dueB) * factor;
        return a.taskName.localeCompare(b.taskName, undefined, { sensitivity: 'base' }) * factor;
    });
}

function renderExecutionTaskList(containerId: string, tasks: DashboardExecutionTask[]): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.replaceChildren();
    if (tasks.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'execution-empty';
        empty.textContent = 'No hay tareas en este grupo.';
        container.append(empty);
        return;
    }

    for (const task of tasks) {
        const card = document.createElement('article');
        card.className = 'execution-task-card';
        card.dataset.taskId = task.taskId;
        const selected = selectedExecutionTaskIds.has(task.taskId);
        if (executionSelectionMode || selected) {
            card.classList.add('is-selectable');
            const selector = document.createElement('input');
            selector.type = 'checkbox';
            selector.className = 'execution-task-selector';
            selector.checked = selected;
            selector.setAttribute('aria-label', `Seleccionar ${task.taskName}`);
            selector.addEventListener('click', (event) => event.stopPropagation());
            selector.addEventListener('change', () => toggleExecutionTaskSelection(task.taskId));
            card.append(selector);
        }
        card.classList.toggle('is-selected', selected);
        card.setAttribute('aria-selected', String(selected));
        card.addEventListener('click', (event) => {
            if (!executionSelectionMode && !event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            toggleExecutionTaskSelection(task.taskId);
        });
        const title = task.taskUrl ? document.createElement('a') : document.createElement('strong');
        title.textContent = task.taskName;
        if (title instanceof HTMLAnchorElement && task.taskUrl) {
            title.href = task.taskUrl;
            title.target = '_blank';
            title.rel = 'noopener noreferrer';
        }
        const meta = document.createElement('div');
        meta.className = 'execution-task-meta';
        meta.append(createStatusPill({ label: task.statusLabel, color: task.statusColor }));
        if (task.priority) {
            const priority = document.createElement('span');
            priority.className = 'chip blocked';
            priority.textContent = task.priority;
            meta.append(priority);
        }
        const detail = document.createElement('div');
        detail.className = 'execution-task-detail';
        const context = document.createElement('span');
        context.textContent = task.listName || formatTaskDueDate(task.dueAt);
        const due = document.createElement('time');
        const dueLabel = formatTaskDueDate(task.dueAt);
        due.textContent = task.trackedWeekMs > 0 ? `${dueLabel} · ${formatDashboardDuration(task.trackedWeekMs)} (7d)` : dueLabel;
        if (task.dueAt) due.dateTime = new Date(task.dueAt).toISOString();
        detail.append(context, due);
        card.append(title, meta, detail);
        container.append(card);
    }
}

export function renderExecutionBoard(board: DashboardExecutionBoard): void {
    latestExecutionBoard = board;
    const availableTaskIds = new Set(allExecutionTasks(board).map((task) => task.taskId));
    for (const taskId of selectedExecutionTaskIds) if (!availableTaskIds.has(taskId)) selectedExecutionTaskIds.delete(taskId);
    const boardNode = document.getElementById('executionBoard');
    if (boardNode) {
        for (const id of executionPreferences.columnOrder) {
            const column = boardNode.querySelector<HTMLElement>(`[data-execution-column="${id}"]`);
            if (column) boardNode.append(column);
        }
    }

    const groups: Record<ExecutionColumnId, { containerId: string; countId: string; tasks: DashboardExecutionTask[] }> = {
        overdue: { containerId: 'executionOverdueTasks', countId: 'executionOverdueCount', tasks: board.overdue },
        today: { containerId: 'executionTodayTasks', countId: 'executionTodayCount', tasks: board.today },
        next: { containerId: 'executionNextTasks', countId: 'executionNextCount', tasks: board.nextThreeDays },
        undated: { containerId: 'executionUndatedTasks', countId: 'executionUndatedCount', tasks: board.noDueDate },
    };
    for (const id of EXECUTION_COLUMN_IDS) {
        const group = groups[id];
        const visible = executionActiveStatus
            ? group.tasks.filter((task) => executionStatusKey({ label: task.statusLabel, color: task.statusColor }) === executionActiveStatus)
            : group.tasks;
        const sorted = sortExecutionTasks(visible, executionPreferences.dateSort[id]);
        setDashboardValue(group.countId, String(sorted.length));
        renderExecutionTaskList(group.containerId, sorted);
        const sortButton = document.querySelector<HTMLButtonElement>(`[data-sort-column="${id}"]`);
        if (sortButton) {
            const ascending = executionPreferences.dateSort[id] === 'asc';
            const field = id === 'undated' ? 'Título' : 'Fecha';
            sortButton.textContent = `${field} ${ascending ? '↑' : '↓'}`;
            sortButton.setAttribute('aria-label', `Ordenar ${field.toLocaleLowerCase()} ${ascending ? 'descendente' : 'ascendente'}`);
            sortButton.setAttribute('aria-pressed', String(!ascending));
        }
    }

    const future = document.getElementById('executionFutureCount');
    const futureText = future?.querySelector('span:last-child');
    if (future && futureText) {
        futureText.textContent = board.hiddenFutureCount === 1 ? '1 tarea futura oculta' : `${board.hiddenFutureCount} tareas futuras ocultas`;
        future.classList.toggle('blocked', board.hiddenFutureCount === 0);
    }

    const legend = document.getElementById('executionStatusLegend');
    if (legend) {
        const filters = board.statuses.map((status) => {
            const key = executionStatusKey(status);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'status-pill execution-status-filter';
            button.dataset.statusKey = key;
            button.setAttribute('aria-pressed', String(executionActiveStatus === key));
            button.setAttribute('aria-label', `${executionActiveStatus === key ? 'Quitar filtro' : 'Filtrar'} por estado ${status.label}`);
            applyStatusPalette(button, status.color);
            const text = document.createElement('span');
            text.textContent = `${status.label} · ${status.count}`;
            button.append(text);
            button.addEventListener('click', () => {
                executionActiveStatus = executionActiveStatus === key ? null : key;
                renderExecutionBoard(board);
            });
            return button;
        });
        legend.replaceChildren(...filters);
        legend.setAttribute('aria-label', executionActiveStatus ? 'Estados presentes. Filtro activo.' : 'Estados presentes en tus tareas');
    }
    updateBulkSelectionUi();
}

export function allExecutionTasks(board: DashboardExecutionBoard): DashboardExecutionTask[] {
    return [...board.overdue, ...board.today, ...board.nextThreeDays, ...board.noDueDate];
}

function toggleExecutionTaskSelection(taskId: string): void {
    if (selectedExecutionTaskIds.has(taskId)) selectedExecutionTaskIds.delete(taskId);
    else selectedExecutionTaskIds.add(taskId);
    invalidateBulkPlan();
    if (latestExecutionBoard) renderExecutionBoard(latestExecutionBoard);
}

function updateBulkSelectionUi(): void {
    const count = selectedExecutionTaskIds.size;
    const modeButton = document.getElementById('toggleExecutionSelection') as HTMLButtonElement | null;
    if (modeButton) {
        modeButton.setAttribute('aria-pressed', String(executionSelectionMode));
        modeButton.textContent = executionSelectionMode ? 'Finalizar selección' : 'Seleccionar';
    }
    const rail = document.getElementById('bulkActionRailButton') as HTMLButtonElement | null;
    if (rail) {
        rail.hidden = count === 0;
        const value = rail.querySelector('span');
        if (value) value.textContent = String(count);
    }
    setDashboardValue('bulkSelectedCount', count === 1 ? '1 tarea' : `${count} tareas`);
    if (count === 0) closeBulkEditDrawer();
}

function persistExecutionPreferences(): void {
    writeExecutionBoardPreferences(executionPreferencePort, executionPreferences);
    if (latestExecutionBoard) renderExecutionBoard(latestExecutionBoard);
}

function moveExecutionColumn(id: ExecutionColumnId, direction: 'left' | 'right'): void {
    const order = [...executionPreferences.columnOrder];
    const index = order.indexOf(id);
    const target = direction === 'left' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    executionPreferences = { ...executionPreferences, columnOrder: order };
    persistExecutionPreferences();
    document.querySelector<HTMLElement>(`[data-execution-column="${id}"] .execution-drag-handle`)?.focus();
}

export function initExecutionBoardControls(port: PreferencePort = localPreferencePort): void {
    executionPreferencePort = port;
    executionPreferences = readExecutionBoardPreferences(port);
    const boardNode = document.getElementById('executionBoard');
    if (!boardNode || boardNode.dataset.controlsReady === 'true') return;
    boardNode.dataset.controlsReady = 'true';
    let draggedId: ExecutionColumnId | null = null;

    boardNode.querySelectorAll<HTMLElement>('.execution-drag-handle').forEach((handle) => { handle.draggable = true; });
    boardNode.addEventListener('click', (event) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-sort-column]');
        const id = button?.dataset.sortColumn as ExecutionColumnId | undefined;
        if (!id || !EXECUTION_COLUMN_IDS.includes(id)) return;
        executionPreferences = {
            ...executionPreferences,
            dateSort: { ...executionPreferences.dateSort, [id]: executionPreferences.dateSort[id] === 'asc' ? 'desc' : 'asc' },
        };
        persistExecutionPreferences();
    });
    boardNode.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const handle = (event.target as Element | null)?.closest('.execution-drag-handle');
        const column = handle?.closest<HTMLElement>('[data-execution-column]');
        const id = column?.dataset.executionColumn as ExecutionColumnId | undefined;
        if (!id || !EXECUTION_COLUMN_IDS.includes(id)) return;
        event.preventDefault();
        moveExecutionColumn(id, event.key === 'ArrowLeft' ? 'left' : 'right');
    });
    boardNode.addEventListener('dragstart', (event) => {
        const handle = (event.target as Element | null)?.closest('.execution-drag-handle');
        const column = handle?.closest<HTMLElement>('[data-execution-column]');
        const id = column?.dataset.executionColumn as ExecutionColumnId | undefined;
        if (!column || !id || !EXECUTION_COLUMN_IDS.includes(id)) {
            event.preventDefault();
            return;
        }
        draggedId = id;
        column.classList.add('is-dragging');
        event.dataTransfer?.setData('text/plain', id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    boardNode.addEventListener('dragover', (event) => {
        const target = (event.target as Element | null)?.closest<HTMLElement>('[data-execution-column]');
        if (!draggedId || !target || target.dataset.executionColumn === draggedId) return;
        event.preventDefault();
        boardNode.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
        target.classList.add('is-drop-target');
    });
    boardNode.addEventListener('drop', (event) => {
        const target = (event.target as Element | null)?.closest<HTMLElement>('[data-execution-column]');
        if (!draggedId || !target) return;
        event.preventDefault();
        const dragged = boardNode.querySelector<HTMLElement>(`[data-execution-column="${draggedId}"]`);
        if (dragged && target !== dragged) {
            const after = event.clientX > target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
            target.insertAdjacentElement(after ? 'afterend' : 'beforebegin', dragged);
            const columnOrder = [...boardNode.querySelectorAll<HTMLElement>('[data-execution-column]')]
                .map((column) => column.dataset.executionColumn as ExecutionColumnId);
            executionPreferences = normalizeExecutionBoardPreferences({ ...executionPreferences, columnOrder });
            writeExecutionBoardPreferences(executionPreferencePort, executionPreferences);
        }
        boardNode.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
    });
    boardNode.addEventListener('dragend', () => {
        boardNode.querySelectorAll('.is-dragging, .is-drop-target').forEach((node) => node.classList.remove('is-dragging', 'is-drop-target'));
        draggedId = null;
    });
    if (latestExecutionBoard) renderExecutionBoard(latestExecutionBoard);
}

interface BulkCatalogStatus { name: string; color: string }
interface BulkCatalogMember { id: string; name: string }
interface BulkListCatalog { statuses: BulkCatalogStatus[]; members: BulkCatalogMember[] }

export interface BulkEditCatalogPort {
    readList(listId: string): Promise<unknown>;
    readMembers(listId: string): Promise<unknown>;
}

export interface BulkEditApplyPort {
    applyTask(change: BulkTaskChangeInput): Promise<unknown>;
}

const chromeBulkEditCatalogPort: BulkEditCatalogPort = {
    readList: (listId) => chrome.runtime.sendMessage({ action: 'getList', data: { listId } }),
    readMembers: (listId) => chrome.runtime.sendMessage({ action: 'getMembers', data: { listId } }),
};

const chromeBulkEditApplyPort: BulkEditApplyPort = {
    applyTask: (change) => chrome.runtime.sendMessage({ action: 'applyBulkTaskChange', data: change }),
};

const bulkCatalogCache = new Map<string, BulkListCatalog>();
let bulkCatalogRequestId = 0;
let currentBulkPlan: BulkTaskChangeInput[] = [];
let bulkApplyInProgress = false;

function setBulkApplyReady(ready: boolean, message: string): void {
    const apply = document.getElementById('applyBulkChanges') as HTMLButtonElement | null;
    const state = document.getElementById('bulkApplyState');
    if (apply) {
        apply.disabled = !ready || bulkApplyInProgress;
        apply.setAttribute('aria-disabled', String(apply.disabled));
    }
    if (state) state.textContent = message;
}

function invalidateBulkPlan(): void {
    currentBulkPlan = [];
    if (!bulkApplyInProgress) setBulkApplyReady(false, 'Previsualizá los cambios antes de aplicarlos.');
}

export function bulkDateInputToTimestamp(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date.getTime();
}

function selectedExecutionTasks(): DashboardExecutionTask[] {
    if (!latestExecutionBoard) return [];
    return allExecutionTasks(latestExecutionBoard).filter((task) => selectedExecutionTaskIds.has(task.taskId));
}

function normalizeBulkListCatalog(listResponse: unknown, memberResponse: unknown): BulkListCatalog {
    const list = listResponse && typeof listResponse === 'object' ? listResponse as { statuses?: unknown[] } : {};
    const members = memberResponse && typeof memberResponse === 'object' ? memberResponse as { members?: unknown[] } : {};
    const statuses: BulkCatalogStatus[] = [];
    for (const raw of Array.isArray(list.statuses) ? list.statuses.slice(0, 100) : []) {
        if (!raw || typeof raw !== 'object') continue;
        const value = raw as { status?: unknown; color?: unknown };
        const name = typeof value.status === 'string' ? value.status.trim().slice(0, 100) : '';
        if (!name || statuses.some((status) => status.name.toLocaleLowerCase() === name.toLocaleLowerCase())) continue;
        statuses.push({ name, color: safeStatusColor(typeof value.color === 'string' ? value.color : '') });
    }
    const normalizedMembers: BulkCatalogMember[] = [];
    for (const raw of Array.isArray(members.members) ? members.members.slice(0, 500) : []) {
        if (!raw || typeof raw !== 'object') continue;
        const value = raw as { id?: unknown; username?: unknown; initials?: unknown };
        const id = String(value.id || '').trim().slice(0, 100);
        const name = String(value.username || value.initials || value.id || '').trim().slice(0, 200);
        if (!id || !name || normalizedMembers.some((member) => member.id === id)) continue;
        normalizedMembers.push({ id, name });
    }
    return { statuses, members: normalizedMembers };
}

function commonCatalogValues<T>(catalogs: BulkListCatalog[], field: 'statuses' | 'members', key: (value: T) => string): T[] {
    if (catalogs.length === 0) return [];
    const first = catalogs[0][field] as T[];
    return first.filter((value) => catalogs.every((catalog) => (catalog[field] as T[]).some((candidate) => key(candidate) === key(value))));
}

function replaceSelectOptions(select: HTMLSelectElement, values: Array<{ value: string; label: string }>, placeholder = 'Sin cambios'): void {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder;
    const options = values.map((value) => {
        const option = document.createElement('option');
        option.value = value.value;
        option.textContent = value.label;
        return option;
    });
    select.replaceChildren(empty, ...options);
    select.disabled = options.length === 0;
}

async function loadBulkEditCatalogs(port: BulkEditCatalogPort): Promise<void> {
    const requestId = ++bulkCatalogRequestId;
    const tasks = selectedExecutionTasks();
    const listIds = [...new Set(tasks.map((task) => task.listId).filter((id): id is string => Boolean(id)))];
    const statusSelect = document.getElementById('bulkStatus') as HTMLSelectElement | null;
    const assigneeSelect = document.getElementById('bulkAssignee') as HTMLSelectElement | null;
    const statusHelp = document.getElementById('bulkStatusHelp');
    const assigneeHelp = document.getElementById('bulkAssigneeHelp');
    if (!statusSelect || !assigneeSelect || !statusHelp || !assigneeHelp) return;
    replaceSelectOptions(statusSelect, []);
    replaceSelectOptions(assigneeSelect, []);
    if (listIds.length === 0 || listIds.length > 20 || tasks.some((task) => !task.listId)) {
        statusHelp.textContent = listIds.length > 20 ? 'Demasiadas listas para una validación masiva segura.' : 'Falta identificar la lista de una o más tareas.';
        assigneeHelp.textContent = 'Responsables no disponibles para esta selección.';
        return;
    }
    statusHelp.textContent = 'Consultando estados compatibles…';
    assigneeHelp.textContent = 'Consultando responsables compatibles…';
    try {
        const catalogs = await Promise.all(listIds.map(async (listId) => {
            const cached = bulkCatalogCache.get(listId);
            if (cached) return cached;
            const [list, members] = await Promise.all([port.readList(listId), port.readMembers(listId)]);
            const catalog = normalizeBulkListCatalog(list, members);
            bulkCatalogCache.set(listId, catalog);
            return catalog;
        }));
        if (requestId !== bulkCatalogRequestId) return;
        const statuses = commonCatalogValues<BulkCatalogStatus>(catalogs, 'statuses', (status) => status.name.toLocaleLowerCase());
        const members = commonCatalogValues<BulkCatalogMember>(catalogs, 'members', (member) => member.id);
        replaceSelectOptions(statusSelect, statuses.map((status) => ({ value: status.name, label: status.name })));
        replaceSelectOptions(assigneeSelect, members.map((member) => ({ value: member.id, label: member.name })));
        statusHelp.textContent = statuses.length > 0 ? `${statuses.length} estados comunes disponibles.` : 'No existe un estado común entre todas las listas.';
        assigneeHelp.textContent = members.length > 0 ? `${members.length} responsables comunes disponibles; la asignación actual será reemplazada.` : 'No existe un responsable común entre todas las listas.';
    } catch {
        if (requestId !== bulkCatalogRequestId) return;
        statusHelp.textContent = 'No se pudieron validar estados. La fecha sigue disponible.';
        assigneeHelp.textContent = 'No se pudieron validar responsables. No se aplicará ningún cambio.';
    }
}

export function openBulkEditDrawer(port: BulkEditCatalogPort = chromeBulkEditCatalogPort): void {
    if (selectedExecutionTaskIds.size === 0) return;
    invalidateBulkPlan();
    const drawer = document.getElementById('bulkEditDrawer');
    const rail = document.getElementById('bulkActionRailButton');
    drawer?.setAttribute('aria-hidden', 'false');
    rail?.setAttribute('aria-expanded', 'true');
    (document.getElementById('closeBulkEdit') as HTMLButtonElement | null)?.focus();
    void loadBulkEditCatalogs(port);
}

export function closeBulkEditDrawer(): void {
    document.getElementById('bulkEditDrawer')?.setAttribute('aria-hidden', 'true');
    document.getElementById('bulkActionRailButton')?.setAttribute('aria-expanded', 'false');
}

export function renderBulkPreview(): void {
    const container = document.getElementById('bulkPreview');
    const dueMode = (document.getElementById('bulkDueMode') as HTMLSelectElement | null)?.value || 'none';
    const dueDate = (document.getElementById('bulkDueDate') as HTMLInputElement | null)?.value || '';
    const statusSelect = document.getElementById('bulkStatus') as HTMLSelectElement | null;
    const assigneeSelect = document.getElementById('bulkAssignee') as HTMLSelectElement | null;
    if (!container) return;
    invalidateBulkPlan();
    const status = statusSelect?.value || '';
    const assigneeId = assigneeSelect?.value || '';
    const assigneeName = assigneeSelect?.selectedOptions[0]?.textContent || '';
    if (dueMode === 'set' && !dueDate) {
        const error = document.createElement('p');
        error.textContent = 'Elegí una fecha antes de previsualizar.';
        container.replaceChildren(error);
        return;
    }
    const dueTimestamp = dueMode === 'set' ? bulkDateInputToTimestamp(dueDate) : null;
    if (dueMode === 'set' && dueTimestamp === null) {
        const error = document.createElement('p');
        error.textContent = 'La fecha elegida no es válida.';
        container.replaceChildren(error);
        return;
    }
    if (dueMode === 'none' && !status && !assigneeId) {
        const empty = document.createElement('p');
        empty.textContent = 'Elegí uno o más cambios para preparar la vista previa.';
        container.replaceChildren(empty);
        return;
    }
    const tasks = selectedExecutionTasks();
    if (tasks.length === 0 || tasks.length > 50 || tasks.some((task) => !task.listId)) {
        const error = document.createElement('p');
        error.textContent = tasks.length > 50
            ? 'Seleccioná como máximo 50 tareas por aplicación.'
            : tasks.some((task) => !task.listId) ? 'Falta identificar la lista de una o más tareas.' : 'La selección ya no está disponible.';
        container.replaceChildren(error);
        return;
    }
    const numericAssigneeId = assigneeId ? Number(assigneeId) : undefined;
    if (assigneeId && (!Number.isInteger(numericAssigneeId) || Number(numericAssigneeId) <= 0)) {
        const error = document.createElement('p');
        error.textContent = 'El responsable elegido no es válido.';
        container.replaceChildren(error);
        return;
    }
    currentBulkPlan = tasks.map((task) => ({
        taskId: task.taskId,
        listId: task.listId!,
        ...(status ? { status } : {}),
        ...(dueMode === 'clear' ? { dueDate: null } : {}),
        ...(dueMode === 'set' ? { dueDate: dueTimestamp! } : {}),
        ...(numericAssigneeId !== undefined ? { assigneeId: numericAssigneeId } : {}),
    }));
    const rows = tasks.map((task) => {
        const row = document.createElement('div');
        row.className = 'bulk-preview-row';
        const title = document.createElement('strong');
        title.textContent = task.taskName;
        const changes: string[] = [];
        if (dueMode === 'clear') changes.push(`${formatTaskDueDate(task.dueAt)} → Sin fecha`);
        if (dueMode === 'set') changes.push(`${formatTaskDueDate(task.dueAt)} → ${dueDate}`);
        if (status) changes.push(`Estado: ${task.statusLabel} → ${status}`);
        if (assigneeId) changes.push(`Responsable: ${task.assignees.map((assignee) => assignee.name).join(', ') || 'Sin responsable'} → ${assigneeName}`);
        const detail = document.createElement('span');
        detail.textContent = changes.join(' · ');
        row.append(title, detail);
        return row;
    });
    container.replaceChildren(...rows);
    setBulkApplyReady(true, `Listo para aplicar sobre ${tasks.length === 1 ? '1 tarea' : `${tasks.length} tareas`}. Se pedirá confirmación final.`);
}

function normalizeBulkApplyResult(value: unknown, taskId: string): BulkTaskChangeResult {
    if (!value || typeof value !== 'object') return { ok: false, taskId, outcome: 'failed', code: 'INVALID_RESPONSE', stop: true };
    const result = value as Partial<BulkTaskChangeResult>;
    if (result.taskId !== taskId || !['applied', 'skipped', 'failed'].includes(String(result.outcome)) || typeof result.code !== 'string') {
        return { ok: false, taskId, outcome: 'failed', code: 'INVALID_RESPONSE', stop: true };
    }
    return {
        ok: result.ok === true,
        taskId,
        outcome: result.outcome as BulkTaskChangeResult['outcome'],
        code: result.code.slice(0, 100),
        stop: result.stop === true,
    };
}

const BULK_RESULT_COPY: Record<string, string> = {
    APPLIED: 'Aplicada y verificada en ClickUp.',
    NO_CHANGES: 'Omitida: la tarea ya tenía esos valores.',
    AUTHENTICATION_REQUIRED: 'Falló: es necesario reconectar ClickUp.',
    PERMISSION_DENIED: 'Falló: ClickUp rechazó los permisos.',
    TASK_NOT_FOUND: 'Falló: la tarea ya no está disponible.',
    TASK_CONTEXT_CHANGED: 'Falló: la tarea cambió de lista.',
    STATUS_NOT_COMPATIBLE: 'Falló: el estado ya no es compatible.',
    ASSIGNEE_NOT_COMPATIBLE: 'Falló: el responsable ya no es compatible.',
    RATE_LIMITED: 'Falló: ClickUp limitó temporalmente las solicitudes.',
    VERIFY_STATUS_FAILED: 'Aplicación no verificada: revisá el estado en ClickUp.',
    VERIFY_DUE_DATE_FAILED: 'Aplicación no verificada: revisá la fecha en ClickUp.',
    VERIFY_ASSIGNEE_FAILED: 'Aplicación no verificada: revisá el responsable en ClickUp.',
    VERIFY_CONTEXT_FAILED: 'Aplicación no verificada: la tarea cambió de contexto.',
    INVALID_REQUEST: 'Falló la validación local de la solicitud.',
    INVALID_RESPONSE: 'ClickUp devolvió una respuesta inesperada.',
    UNEXPECTED_RESPONSE: 'La operación se detuvo por una respuesta inesperada.',
};

async function applyBulkPlan(port: BulkEditApplyPort): Promise<void> {
    if (bulkApplyInProgress || currentBulkPlan.length === 0) return;
    const plan = currentBulkPlan.map((change) => ({ ...change }));
    const tasks = selectedExecutionTasks();
    const confirmed = window.confirm(`Vas a modificar ${plan.length === 1 ? '1 tarea' : `${plan.length} tareas`} en ClickUp. Los cambios exitosos no se revierten automáticamente si otra tarea falla. ¿Continuar?`);
    if (!confirmed) return;

    bulkApplyInProgress = true;
    const drawer = document.getElementById('bulkEditDrawer');
    const controls = [...(drawer?.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button, select, input') || [])];
    const previousDisabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    drawer?.setAttribute('aria-busy', 'true');
    setBulkApplyReady(false, 'Aplicando cambios de forma secuencial…');
    const container = document.getElementById('bulkPreview');
    const rows = plan.map((change) => {
        const row = document.createElement('div');
        row.className = 'bulk-preview-row';
        const title = document.createElement('strong');
        title.textContent = tasks.find((task) => task.taskId === change.taskId)?.taskName || change.taskId;
        const detail = document.createElement('span');
        detail.textContent = 'Pendiente…';
        row.append(title, detail);
        return { change, row, detail };
    });
    container?.replaceChildren(...rows.map((entry) => entry.row));

    let applied = 0;
    let skipped = 0;
    let failed = 0;
    let stopped = false;
    for (const entry of rows) {
        if (stopped) {
            entry.row.dataset.result = 'skipped';
            entry.detail.textContent = 'No aplicada: el proceso se detuvo antes de esta tarea.';
            skipped += 1;
            continue;
        }
        entry.detail.textContent = 'Validando compatibilidad…';
        let result: BulkTaskChangeResult;
        try {
            result = normalizeBulkApplyResult(await port.applyTask(entry.change), entry.change.taskId);
        } catch {
            result = { ok: false, taskId: entry.change.taskId, outcome: 'failed', code: 'UNEXPECTED_RESPONSE', stop: true };
        }
        entry.row.dataset.result = result.outcome;
        entry.detail.textContent = BULK_RESULT_COPY[result.code] || 'La tarea devolvió un resultado no reconocido.';
        if (result.outcome === 'applied') applied += 1;
        else if (result.outcome === 'skipped') skipped += 1;
        else failed += 1;
        stopped = result.stop;
    }

    bulkApplyInProgress = false;
    controls.forEach((control, index) => { control.disabled = previousDisabled[index]; });
    drawer?.removeAttribute('aria-busy');
    currentBulkPlan = [];
    setBulkApplyReady(false, `Resultado: ${applied} aplicadas, ${skipped} omitidas y ${failed} fallidas. Actualizá el dashboard para ver el estado vigente.`);
}

export function initBulkEditPreview(port: BulkEditCatalogPort = chromeBulkEditCatalogPort, applyPort: BulkEditApplyPort = chromeBulkEditApplyPort): void {
    const modeButton = document.getElementById('toggleExecutionSelection') as HTMLButtonElement | null;
    const rail = document.getElementById('bulkActionRailButton') as HTMLButtonElement | null;
    const closer = document.getElementById('closeBulkEdit') as HTMLButtonElement | null;
    const clear = document.getElementById('clearBulkSelection') as HTMLButtonElement | null;
    const preview = document.getElementById('previewBulkChanges') as HTMLButtonElement | null;
    const dueMode = document.getElementById('bulkDueMode') as HTMLSelectElement | null;
    const dueDate = document.getElementById('bulkDueDate') as HTMLInputElement | null;
    const status = document.getElementById('bulkStatus') as HTMLSelectElement | null;
    const assignee = document.getElementById('bulkAssignee') as HTMLSelectElement | null;
    const apply = document.getElementById('applyBulkChanges') as HTMLButtonElement | null;
    if (!modeButton || !rail || !closer || !clear || !preview || !dueMode || !dueDate || !status || !assignee || !apply || modeButton.dataset.bulkReady === 'true') return;
    modeButton.dataset.bulkReady = 'true';
    modeButton.addEventListener('click', () => {
        executionSelectionMode = !executionSelectionMode;
        if (latestExecutionBoard) renderExecutionBoard(latestExecutionBoard);
        else updateBulkSelectionUi();
    });
    rail.addEventListener('click', () => openBulkEditDrawer(port));
    closer.addEventListener('click', () => { closeBulkEditDrawer(); rail.focus(); });
    clear.addEventListener('click', () => {
        invalidateBulkPlan();
        selectedExecutionTaskIds.clear();
        executionSelectionMode = false;
        if (latestExecutionBoard) renderExecutionBoard(latestExecutionBoard);
        else updateBulkSelectionUi();
    });
    dueMode.addEventListener('change', () => {
        invalidateBulkPlan();
        dueDate.disabled = dueMode.value !== 'set';
        if (dueMode.value !== 'set') dueDate.value = '';
    });
    dueDate.addEventListener('change', invalidateBulkPlan);
    status.addEventListener('change', invalidateBulkPlan);
    assignee.addEventListener('change', invalidateBulkPlan);
    preview.addEventListener('click', renderBulkPreview);
    apply.addEventListener('click', () => { void applyBulkPlan(applyPort); });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.getElementById('bulkEditDrawer')?.getAttribute('aria-hidden') === 'false') closeBulkEditDrawer();
    });
    updateBulkSelectionUi();
}

export function renderDashboardSummary(summary: DashboardSnapshot): void {
    setDashboardValue('kpiTasksToday', String(summary.tasksToday));
    setDashboardValue('kpiTasksOverdue', String(summary.tasksOverdue));
    setDashboardValue('kpiCompletedWeek', String(summary.completedWeek));
    setDashboardValue('kpiTrackedToday', formatDashboardDuration(summary.trackedTodayMs));
    setDashboardValue('kpiGmailTasks', String(summary.gmailLinksWeek));
    renderDashboardTaskTotals(summary.taskTimeTotals);
    renderExecutionBoard(summary.executionBoard);
    const state = document.getElementById('dashboardDataState');
    if (state) {
        const generated = new Date(summary.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        state.textContent = `Actualizado ${generated} · ${summary.source === 'cache' ? 'caché local' : 'ClickUp'}`;
    }
}

export async function initDashboardSummary(port: DashboardSummaryPort = chromeDashboardSummaryPort, forceRefresh = false): Promise<boolean> {
    try {
        const summary = await port.read(forceRefresh);
        if (!summary || !Array.isArray(summary.taskTimeTotals) || !summary.executionBoard) throw new Error('INVALID_DASHBOARD_SUMMARY');
        renderDashboardSummary(summary);
        return true;
    } catch {
        const state = document.getElementById('dashboardDataState');
        if (state) state.textContent = 'No se pudieron actualizar los datos de ClickUp.';
        const totals = document.getElementById('dashboardTaskTimeTotals');
        if (totals) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-time-empty';
            empty.textContent = 'Los datos permanecen sin completar.';
            totals.replaceChildren(empty);
        }
        for (const containerId of ['executionOverdueTasks', 'executionTodayTasks', 'executionNextTasks', 'executionUndatedTasks']) {
            const container = document.getElementById(containerId);
            if (!container) continue;
            const empty = document.createElement('p');
            empty.className = 'execution-empty';
            empty.textContent = 'Sin datos disponibles.';
            container.replaceChildren(empty);
        }
        return false;
    }
}

export function initDashboardRefresh(port: DashboardSummaryPort = chromeDashboardSummaryPort): void {
    const button = document.getElementById('refreshExecutionBoard') as HTMLButtonElement | null;
    if (!button || button.dataset.refreshReady === 'true') return;
    button.dataset.refreshReady = 'true';
    button.addEventListener('click', async () => {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        const label = button.querySelector('span:last-child');
        if (label) label.textContent = 'Actualizando…';
        const success = await initDashboardSummary(port, true);
        if (label) label.textContent = success ? 'Actualizado' : 'Reintentar';
        button.removeAttribute('aria-busy');
        button.disabled = false;
        window.setTimeout(() => { if (label) label.textContent = 'Actualizar'; }, 1800);
    });
}

/* ------------------------------------------------------------------ *
 * Temas
 * ------------------------------------------------------------------ */

const THEMES = Object.freeze(['paper', 'clickup', 'spiritfox']);
export type AppTheme = typeof THEMES[number];

const DEFAULT_THEME: AppTheme = 'paper';
const OWNER_THEME: AppTheme = 'spiritfox';
let ownerThemeUnlocked = false;

export interface ResolvedTheme {
    theme: AppTheme;
    source: 'stored' | 'auto';
}

export function sanitizeThemeChoice(value: unknown): AppTheme {
    if (typeof value !== 'string') return DEFAULT_THEME;
    const candidate = value.trim().toLowerCase();
    return (THEMES as readonly string[]).includes(candidate) ? candidate as AppTheme : DEFAULT_THEME;
}

/**
 * Sin preferencia guardada el tema es claro y la fuente queda en `auto`, que es
 * lo que habilita a la hoja de estilos a seguir `prefers-color-scheme`. Una
 * elección explícita gana siempre, incluso contra el sistema.
 */
export function resolveInitialTheme(stored: unknown, _prefersDark = false, ownerUnlocked = false): ResolvedTheme {
    if (typeof stored !== 'string' || stored.trim() === '') {
        return { theme: DEFAULT_THEME, source: 'auto' };
    }

    const theme = sanitizeThemeChoice(stored);
    if (theme === OWNER_THEME && !ownerUnlocked) {
        return { theme: 'clickup', source: 'stored' };
    }
    return { theme, source: 'stored' };
}

export function applyTheme(resolved: ResolvedTheme, root: HTMLElement = document.documentElement): void {
    root.dataset.theme = resolved.theme;
    root.dataset.themeSource = resolved.source;

    document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.themeChoice === resolved.theme));
    });
}

export function initThemeSwitcher(port: PreferencePort = localPreferencePort, ownerUnlocked = false): void {
    ownerThemeUnlocked = ownerUnlocked;
    const prefersDark = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches;

    applyTheme(resolveInitialTheme(port.read(THEME_STORAGE_KEY), prefersDark, ownerUnlocked));

    if (ownerThemeUnlocked) {
        document.querySelectorAll<HTMLElement>('.owner-theme-option').forEach((button) => {
            button.hidden = false;
        });
    }

    document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((button) => {
        button.addEventListener('click', () => {
            const choice = sanitizeThemeChoice(button.dataset.themeChoice);
            if (choice === OWNER_THEME && !ownerThemeUnlocked) return;
            port.write(THEME_STORAGE_KEY, choice);
            applyTheme({ theme: choice, source: 'stored' });
        });
    });
}

export function initOwnerThemeUnlock(): void {
    const button = document.getElementById('pluginVersionUnlock') as HTMLButtonElement | null;
    if (!button) return;
    button.textContent = `v${chrome.runtime.getManifest().version}`;
    let clicks = 0;
    button.addEventListener('click', () => {
        clicks += 1;
        if (clicks < 7) return;
        clicks = 0;
        ownerThemeUnlocked = true;
        document.querySelectorAll<HTMLElement>('.owner-theme-option').forEach((option) => { option.hidden = false; });
        button.dataset.unlocked = 'true';
        button.setAttribute('aria-label', 'Tema Spiritfox desbloqueado');
    });
}

/* ------------------------------------------------------------------ *
 * Dashboard
 *
 * B2 entrega la infraestructura vacía. Ningún módulo está disponible
 * todavía: cada fase de la migración habilita el suyo. No hay ni debe
 * haber widgets con datos de muestra.
 * ------------------------------------------------------------------ */

export interface WidgetDefinition {
    id: string;
    label: string;
    note: string;
    available: boolean;
    inPmPreset: boolean;
}

export const WIDGET_CATALOG: readonly WidgetDefinition[] = Object.freeze([
    { id: 'rhythm', label: 'Ritmo del día', note: 'Llega con la fase de jornada y tiempo.', available: false, inPmPreset: true },
    { id: 'meetings', label: 'Agenda y reuniones', note: 'Llega con la fase de Calendar y Meet.', available: false, inPmPreset: true },
    { id: 'gmail', label: 'Actividad desde Gmail', note: 'Llega con la fase de Integración con Gmail.', available: false, inPmPreset: false },
    { id: 'focus', label: 'Calidad del foco', note: 'Llega con la fase de jornada y tiempo.', available: false, inPmPreset: false },
    { id: 'execution', label: 'Ejecución de tareas', note: 'Llega con la fase de Integración con Gmail.', available: false, inPmPreset: false },
]);

const WIDGET_IDS: readonly string[] = WIDGET_CATALOG.map((widget) => widget.id);

export interface DashboardLayout {
    order: string[];
    hidden: string[];
}

export function pmPresetLayout(): DashboardLayout {
    return {
        order: [...WIDGET_IDS],
        hidden: WIDGET_CATALOG.filter((widget) => !widget.inPmPreset).map((widget) => widget.id),
    };
}

export function normalizeDashboardLayout(layout: unknown): DashboardLayout {
    const source = (layout ?? {}) as Partial<DashboardLayout>;

    const requestedOrder = Array.isArray(source.order) ? source.order : [];
    const order: string[] = [];
    for (const id of requestedOrder) {
        if (typeof id !== 'string') continue;
        if (!WIDGET_IDS.includes(id)) continue;
        if (order.includes(id)) continue;
        order.push(id);
    }
    for (const id of WIDGET_IDS) {
        if (!order.includes(id)) order.push(id);
    }

    const requestedHidden = Array.isArray(source.hidden) ? source.hidden : [];
    const hidden: string[] = [];
    for (const id of requestedHidden) {
        if (typeof id !== 'string') continue;
        if (!WIDGET_IDS.includes(id)) continue;
        if (hidden.includes(id)) continue;
        hidden.push(id);
    }

    // Un panel completamente oculto no es una preferencia, es un error de datos.
    if (hidden.length >= order.length) return pmPresetLayout();

    return { order, hidden };
}

export function moveWidget(order: readonly string[], id: string, direction: 'up' | 'down'): string[] {
    const next = [...order];
    const index = next.indexOf(id);
    if (index < 0) return next;

    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= next.length) return next;

    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

export function readDashboardLayout(port: PreferencePort, scope: string): DashboardLayout {
    const raw = port.read(`${DASHBOARD_STORAGE_PREFIX}:${scope}`);
    if (!raw) return pmPresetLayout();
    try {
        return normalizeDashboardLayout(JSON.parse(raw));
    } catch {
        return pmPresetLayout();
    }
}

export function writeDashboardLayout(port: PreferencePort, scope: string, layout: DashboardLayout): void {
    port.write(`${DASHBOARD_STORAGE_PREFIX}:${scope}`, JSON.stringify(normalizeDashboardLayout(layout)));
}

function widgetById(id: string): WidgetDefinition | undefined {
    return WIDGET_CATALOG.find((widget) => widget.id === id);
}

export function renderWidgetConfigList(layout: DashboardLayout, container: HTMLElement, onChange: (next: DashboardLayout) => void): void {
    container.replaceChildren();

    layout.order.forEach((id, index) => {
        const definition = widgetById(id);
        if (!definition) return;

        const row = document.createElement('div');
        row.className = 'widget-config-row';
        row.dataset.widgetId = id;

        const label = document.createElement('label');
        label.className = 'switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !layout.hidden.includes(id);
        input.setAttribute('aria-label', `Mostrar ${definition.label}`);
        const track = document.createElement('span');
        track.setAttribute('aria-hidden', 'true');
        label.append(input, track);

        const text = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = definition.label;
        const note = document.createElement('small');
        note.textContent = definition.available ? 'Disponible' : definition.note;
        text.append(title, note);

        const controls = document.createElement('div');
        controls.className = 'order-controls';
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'order-btn';
        up.textContent = '↑';
        up.setAttribute('aria-label', `Subir ${definition.label}`);
        up.disabled = index === 0;
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'order-btn';
        down.textContent = '↓';
        down.setAttribute('aria-label', `Bajar ${definition.label}`);
        down.disabled = index === layout.order.length - 1;
        controls.append(up, down);

        input.addEventListener('change', () => {
            const hidden = input.checked
                ? layout.hidden.filter((hiddenId) => hiddenId !== id)
                : [...layout.hidden, id];
            onChange(normalizeDashboardLayout({ order: layout.order, hidden }));
        });
        up.addEventListener('click', () => {
            onChange(normalizeDashboardLayout({ order: moveWidget(layout.order, id, 'up'), hidden: layout.hidden }));
        });
        down.addEventListener('click', () => {
            onChange(normalizeDashboardLayout({ order: moveWidget(layout.order, id, 'down'), hidden: layout.hidden }));
        });

        row.append(label, text, controls);
        container.append(row);
    });
}

export function renderDashboardWidgets(layout: DashboardLayout): void {
    const grid = document.getElementById('dashboardWidgets');
    const empty = document.getElementById('dashboardEmptyState');
    if (!grid) return;

    grid.replaceChildren();
    const visible = layout.order.filter((id) => {
        if (layout.hidden.includes(id)) return false;
        return widgetById(id)?.available === true;
    });

    if (empty) empty.hidden = visible.length > 0;
}

const FOCUSABLE = 'button:not([disabled]), select, input, [href], [tabindex]:not([tabindex="-1"])';

export function initDashboardCustomizer(port: PreferencePort = localPreferencePort, scope = 'local'): void {
    const backdrop = document.getElementById('dashboardCustomizer');
    const panel = backdrop?.querySelector<HTMLElement>('.customizer-panel');
    const opener = document.getElementById('openCustomizer') as HTMLButtonElement | null;
    const closer = document.getElementById('closeCustomizer') as HTMLButtonElement | null;
    const list = document.getElementById('widgetConfigList');
    const presetSelect = document.getElementById('presetSelect') as HTMLSelectElement | null;
    const resetButton = document.getElementById('resetPmPreset') as HTMLButtonElement | null;
    const saveButton = document.getElementById('saveDashboardPreset') as HTMLButtonElement | null;
    const state = document.getElementById('customizerState');
    if (!backdrop || !panel || !opener || !closer || !list || !presetSelect) return;

    let layout = readDashboardLayout(port, scope);
    renderDashboardWidgets(layout);

    const update = (next: DashboardLayout): void => {
        layout = next;
        renderWidgetConfigList(layout, list, update);
        renderDashboardWidgets(layout);
    };

    const close = (): void => {
        backdrop.hidden = true;
        opener.focus({ preventScroll: true });
    };

    const onKeydown = (event: KeyboardEvent): void => {
        if (backdrop.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        if (event.key !== 'Tab') return;

        const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => !node.hasAttribute('hidden'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    opener.addEventListener('click', () => {
        renderWidgetConfigList(layout, list, update);
        backdrop.hidden = false;
        presetSelect.focus({ preventScroll: true });
    });
    closer.addEventListener('click', close);
    backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown);

    resetButton?.addEventListener('click', () => {
        update(pmPresetLayout());
        if (state) state.textContent = 'Preset PM restablecido. Todavía no hay módulos disponibles.';
    });

    saveButton?.addEventListener('click', () => {
        writeDashboardLayout(port, scope, layout);
        if (state) state.textContent = 'Preferencias guardadas en este navegador.';
    });
}

/* ------------------------------------------------------------------ *
 * Conexiones locales y búsqueda de tareas
 * ------------------------------------------------------------------ */

interface LocalConnectionPort {
    getClickUpStatus(): Promise<unknown>;
}

const chromeConnectionPort: LocalConnectionPort = {
    getClickUpStatus: () => chrome.runtime.sendMessage({ action: 'getLocalConnectionStatus' }),
};

export const TASK_SEARCH_RUNTIME_ENABLED = false;

interface TaskSearchPort {
    searchTasks(query: string): Promise<unknown>;
}

const chromeTaskSearchPort: TaskSearchPort = {
    searchTasks: (query) => chrome.runtime.sendMessage({ action: 'searchTasks', data: { query } }),
};

export function renderClickUpConnection(view: ClickUpConnectionView): void {
    const state = document.getElementById('clickUpConnectionState');
    const label = document.getElementById('clickUpConnectionLabel');
    const detail = document.getElementById('clickUpConnectionDetail');
    if (!state || !label || !detail) return;
    state.dataset.state = view.state;
    label.textContent = view.label;
    detail.textContent = view.detail;
}

export async function initLocalConnections(port: LocalConnectionPort = chromeConnectionPort): Promise<void> {
    try {
        renderClickUpConnection(classifyLocalClickUpStatus(await port.getClickUpStatus()));
    } catch {
        renderClickUpConnection(classifyLocalClickUpStatus(null));
    }
}

/* ------------------------------------------------------------------ *
 * Calendar y Meet
 *
 * La UI consume contratos cerrados del background. Lectura, vinculación y
 * creación permanecen detrás de acciones explícitas y puertos inyectables.
 * ------------------------------------------------------------------ */

export interface CalendarAgendaPort {
    getAgenda(): Promise<unknown>;
    connect(): Promise<unknown>;
    refresh(): Promise<unknown>;
    disconnect(): Promise<unknown>;
    searchTasks(query: string): Promise<unknown>;
    linkTask(eventKey: string, taskId: string, scope: CalendarTaskLinkScope): Promise<unknown>;
    createTask(eventKey: string, scope: CalendarTaskLinkScope, customItemId: number, listId: string, parentTaskId?: string): Promise<unknown>;
    getDestinationOptions(): Promise<unknown>;
    getTaskTypeConfig(): Promise<unknown>;
    getCustomTaskTypes(): Promise<unknown>;
    saveTaskTypeConfig(customItemId: number): Promise<unknown>;
    openMeet(eventKey: string): Promise<unknown>;
}

const chromeCalendarAgendaPort: CalendarAgendaPort = {
    getAgenda: () => chrome.runtime.sendMessage({ action: 'getGoogleCalendarAgenda' }),
    connect: () => chrome.runtime.sendMessage({ action: 'connectGoogleCalendar' }),
    refresh: () => chrome.runtime.sendMessage({ action: 'refreshGoogleCalendarAgenda' }),
    disconnect: () => chrome.runtime.sendMessage({ action: 'disconnectGoogleCalendar' }),
    searchTasks: (query) => chrome.runtime.sendMessage({ action: 'searchTasks', data: { query } }),
    linkTask: (eventKey, taskId, scope) => chrome.runtime.sendMessage({ action: 'linkGoogleCalendarEventTask', data: { eventKey, taskId, scope } }),
    createTask: (eventKey, scope, customItemId, listId, parentTaskId) => chrome.runtime.sendMessage({ action: 'createGoogleCalendarEventTask', data: { eventKey, scope, customItemId, listId, ...(parentTaskId ? { parentTaskId } : {}) } }),
    getDestinationOptions: () => chrome.runtime.sendMessage({ action: 'getDestinationOptions' }),
    getTaskTypeConfig: () => chrome.runtime.sendMessage({ action: 'getCalendarTaskTypeConfig' }),
    getCustomTaskTypes: () => chrome.runtime.sendMessage({ action: 'getClickUpCustomTaskTypes' }),
    saveTaskTypeConfig: (customItemId) => chrome.runtime.sendMessage({ action: 'setCalendarTaskTypeConfig', data: { customItemId } }),
    openMeet: (eventKey) => chrome.runtime.sendMessage({ action: 'openGoogleCalendarMeet', data: { eventKey } }),
};

export const CALENDAR_SHOW_ALL_DAY_STORAGE_KEY = 'cgc-calendar-show-all-day-v1';
export const CALENDAR_AGENDA_VIEW_STORAGE_KEY = 'cgc-calendar-agenda-view-v1';
type CalendarAgendaDisplayMode = 'agenda' | 'week';

interface CalendarAgendaHandlers {
    open(eventKey: string): void;
    link(eventKey: string): void;
    search?(eventKey: string, query: string): void;
    selectTask?(eventKey: string, task: SafeTaskSearchResult): void;
    saveLink?(eventKey: string): void;
    create?(eventKey: string): void;
    searchCreateList?(eventKey: string, query: string): void;
    selectCreateList?(eventKey: string, listId: string): void;
    searchParent?(eventKey: string, query: string): void;
    selectParent?(eventKey: string, task: SafeTaskSearchResult | null): void;
    setScope?(eventKey: string, scope: CalendarTaskLinkScope): void;
    setTab?(eventKey: string, tab: 'search' | 'create'): void;
    setView?(view: CalendarAgendaDisplayMode): void;
}

interface CalendarAgendaRenderOptions {
    showAllDay?: boolean;
    activeEventKey?: string;
    activeScope?: CalendarTaskLinkScope;
    activeTab?: 'search' | 'create';
    searchResults?: SafeTaskSearchResult[];
    selectedTaskId?: string;
    panelStatus?: string;
    taskTypeName?: string;
    viewMode?: CalendarAgendaDisplayMode;
    createLists?: DestinationOptions['lists'];
    createListQuery?: string;
    selectedCreateListId?: string;
    parentQuery?: string;
    parentResults?: SafeTaskSearchResult[];
    selectedParentTaskId?: string;
    viewStatus?: string;
    compactWeek?: boolean;
    inlinePanel?: boolean;
}

const CALENDAR_WEEK_START_HOUR = 7;
const CALENDAR_WEEK_END_HOUR = 21;
const CALENDAR_WEEK_HOUR_HEIGHT = 56;
let closeActiveCalendarEventDialog: (() => void) | null = null;

const CALENDAR_STATES: readonly CalendarAgendaState[] = [
    'disabled', 'disconnected', 'loading', 'ready', 'empty', 'error', 'reconnect-required',
];

function normalizeCalendarView(value: unknown): CalendarAgendaViewV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { state: 'disabled', capabilityEnabled: false, items: [] };
    }
    const source = value as Record<string, unknown>;
    if (source.capabilityEnabled !== true) return { state: 'disabled', capabilityEnabled: false, items: [] };
    const state = CALENDAR_STATES.includes(source.state as CalendarAgendaState)
        ? source.state as CalendarAgendaState
        : 'error';
    const items = Array.isArray(source.items)
        ? source.items.slice(0, 20).flatMap((candidate) => {
            const item = normalizeCalendarItem(candidate);
            return item ? [item] : [];
        })
        : [];
    const errorCode = ['AUTH_REQUIRED', 'PERMISSION_DENIED', 'RATE_LIMITED', 'REMOTE_UNAVAILABLE', 'INVALID_RESPONSE']
        .includes(String(source.errorCode))
        ? source.errorCode as CalendarAgendaViewV1['errorCode']
        : undefined;
    return { state, capabilityEnabled: true, items, ...(errorCode ? { errorCode } : {}) };
}

function normalizeCalendarItem(value: unknown): CalendarAgendaItemV1 | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (typeof item.key !== 'string' || !/^[a-f0-9]{64}$/.test(item.key)) return null;
    const seriesKey = typeof item.seriesKey === 'string' && /^[a-f0-9]{64}$/.test(item.seriesKey) ? item.seriesKey : undefined;
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 160) : '';
    const start = typeof item.start === 'string' ? item.start.slice(0, 64) : '';
    const end = typeof item.end === 'string' ? item.end.slice(0, 64) : '';
    if (!title || !start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) return null;
    if (item.status !== 'confirmed' && item.status !== 'tentative') return null;
    if (typeof item.hasMeet !== 'boolean') return null;
    const linked = item.linkedTask && typeof item.linkedTask === 'object' && !Array.isArray(item.linkedTask)
        ? item.linkedTask as Record<string, unknown>
        : null;
    const linkedTask = linked
        && typeof linked.id === 'string' && linked.id.trim().length > 0 && linked.id.length <= 100
        && typeof linked.name === 'string' && linked.name.trim().length > 0 && linked.name.length <= 500
        ? { id: linked.id.trim(), name: linked.name.trim() }
        : undefined;
    const attendanceStatus = ['accepted', 'declined', 'tentative', 'needsAction'].includes(String(item.attendanceStatus))
        ? item.attendanceStatus as CalendarAgendaItemV1['attendanceStatus']
        : undefined;
    return {
        key: item.key,
        ...(seriesKey ? { seriesKey } : {}),
        title,
        start,
        end,
        allDay: item.allDay === true,
        status: item.status,
        ...(attendanceStatus ? { attendanceStatus } : {}),
        hasMeet: item.hasMeet,
        ...(linkedTask ? { linkedTask } : {}),
    };
}

function describeCalendarState(view: CalendarAgendaViewV1): { title: string; detail: string } {
    switch (view.state) {
        case 'disconnected': return { title: 'Calendar no conectado', detail: 'Conectá Google Calendar para leer los próximos siete días.' };
        case 'loading': return { title: 'Leyendo agenda…', detail: 'Consultando sólo el calendario principal.' };
        case 'ready': return { title: 'Agenda actualizada', detail: `${view.items.length} evento${view.items.length === 1 ? '' : 's'} en los próximos siete días.` };
        case 'empty': return { title: 'Sin próximos eventos', detail: 'No hay eventos visibles dentro de la ventana de siete días.' };
        case 'error':
            if (view.errorCode === 'RATE_LIMITED') return { title: 'Calendar limitó la consulta', detail: 'Esperá antes de actualizar; no se harán reintentos automáticos.' };
            if (view.errorCode === 'REMOTE_UNAVAILABLE') return { title: 'Calendar no está disponible', detail: 'La consulta se detuvo sin reintentos automáticos.' };
            return { title: 'No se pudo leer Calendar', detail: 'Podés reconectar para renovar la autorización.' };
        case 'reconnect-required':
            return view.errorCode === 'PERMISSION_DENIED'
                ? { title: 'Calendar rechazó la autorización', detail: 'Reconectá para aprobar el permiso de sólo lectura.' }
                : { title: 'Reconexión requerida', detail: 'Volvé a conectar Google Calendar mediante un clic explícito.' };
        default: return { title: 'Calendar desactivado', detail: 'OAuth permanece apagado hasta el canario autorizado.' };
    }
}

function describeCalendarSync(view: CalendarAgendaViewV1): string {
    switch (view.state) {
        case 'ready': return `Sincronizado · ${view.items.length} evento${view.items.length === 1 ? '' : 's'} en los próximos siete días.`;
        case 'empty': return 'Sincronizado · no hay eventos en los próximos siete días.';
        case 'loading': return 'Sincronizando Google Calendar…';
        case 'disconnected': return 'Desconectado · administrá la autorización desde Conexión.';
        case 'reconnect-required': return 'Reconexión requerida para volver a sincronizar.';
        case 'error': return 'La última sincronización falló. Podés actualizar o reconectar.';
        default: return 'Google Calendar no está disponible.';
    }
}

function formatCalendarRange(item: CalendarAgendaItemV1): string {
    if (item.allDay) {
        const formatter = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: '2-digit', month: 'short' });
        return `Todo el día · ${formatter.format(new Date(`${item.start}T00:00:00`))}`;
    }
    const start = new Date(item.start);
    const end = new Date(item.end);
    const formatter = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function formatCalendarTimeRange(item: CalendarAgendaItemV1): string {
    if (item.allDay) return 'Todo el día';
    const formatter = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' });
    return `${formatter.format(new Date(item.start))}–${formatter.format(new Date(item.end))}`;
}

function calendarItemDayKey(item: CalendarAgendaItemV1): string {
    return item.start.slice(0, 10);
}

function formatCalendarDayLabel(dayKey: string): string {
    const date = new Date(`${dayKey}T00:00:00`);
    return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: '2-digit', month: 'long' }).format(date);
}

function agendaWeekDays(now = new Date()): string[] {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return calendarLocalDayKey(date);
    });
}

function renderCalendarViewSelector(active: CalendarAgendaDisplayMode, handlers: CalendarAgendaHandlers): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'calendar-view-tabs';
    wrapper.setAttribute('role', 'tablist');
    wrapper.setAttribute('aria-label', 'Vista de próximos eventos');
    for (const [value, label] of [['agenda', 'Agenda'], ['week', 'Semana']] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn small';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(active === value));
        button.setAttribute('aria-pressed', String(active === value));
        button.textContent = label;
        button.addEventListener('click', () => handlers.setView?.(value));
        wrapper.append(button);
    }
    return wrapper;
}

function renderCalendarRows(items: CalendarAgendaItemV1[], handlers: CalendarAgendaHandlers, options: CalendarAgendaRenderOptions): HTMLElement[] {
    const rows: HTMLElement[] = [];
    const byDay = new Map<string, CalendarAgendaItemV1[]>();
    for (const item of items) {
        const dayKey = calendarItemDayKey(item);
        byDay.set(dayKey, [...(byDay.get(dayKey) || []), item]);
    }
    for (const dayKey of agendaWeekDays()) {
        const divider = document.createElement('li');
        divider.className = 'calendar-day-divider';
        divider.textContent = formatCalendarDayLabel(dayKey);
        rows.push(divider);
        const dayItems = byDay.get(dayKey) || [];
        if (dayItems.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'calendar-day-empty';
            empty.textContent = 'Sin eventos';
            rows.push(empty);
        } else {
            rows.push(...dayItems.map((item) => createCalendarEventRow(item, handlers, options)));
        }
    }
    return rows;
}

function createCalendarEventRow(item: CalendarAgendaItemV1, handlers: CalendarAgendaHandlers, options: CalendarAgendaRenderOptions): HTMLElement {
    const row = document.createElement('li');
    row.className = 'agenda-item calendar-agenda-item';
    if (item.attendanceStatus === 'declined') row.classList.add('is-declined');
    row.dataset.eventKey = item.key;
    const body = document.createElement('div');
    const itemTitle = document.createElement('strong');
    itemTitle.textContent = item.title;
    const time = document.createElement('span');
    time.textContent = formatCalendarRange(item);
    const metadata = document.createElement('small');
    metadata.textContent = item.allDay
        ? 'Evento de todo el día'
        : item.linkedTask
        ? `Tarea vinculada: ${item.linkedTask.name}`
        : item.hasMeet ? 'Google Meet disponible' : 'Sin enlace Google Meet';
    body.append(itemTitle);
    if (!options.compactWeek) body.append(time, metadata);
    if (options.compactWeek) {
        row.append(body);
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-haspopup', 'dialog');
        row.setAttribute('aria-label', `${item.title}. ${formatCalendarTimeRange(item)}. Abrir detalles.`);
        const openDetails = (): void => openCalendarEventDetails(item, handlers);
        row.addEventListener('click', openDetails);
        row.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openDetails();
        });
        return row;
    }
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    if (item.hasMeet) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = options.compactWeek ? 'btn small' : 'btn';
        open.textContent = options.compactWeek ? 'Meet' : 'Abrir Meet';
        open.addEventListener('click', () => handlers.open(item.key));
        actions.append(open);
    }
    const link = document.createElement('button');
    link.type = 'button';
    link.className = options.compactWeek ? 'btn small' : 'btn';
    link.textContent = options.compactWeek ? (item.linkedTask ? 'Cambiar' : 'Tarea') : (item.linkedTask ? 'Cambiar tarea' : 'Vincular tarea');
    link.addEventListener('click', () => handlers.link(item.key));
    actions.append(link);
    row.append(body, actions);
    if (options.inlinePanel !== false && options.activeEventKey === item.key) row.append(createCalendarInlinePanel(item, handlers, options));
    return row;
}

function openCalendarEventDetails(item: CalendarAgendaItemV1, handlers: CalendarAgendaHandlers): void {
    closeActiveCalendarEventDialog?.();
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = document.createElement('div');
    backdrop.id = 'calendarEventDetailDialog';
    backdrop.className = 'calendar-event-detail-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'calendar-event-detail-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'calendarEventDetailTitle');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn small calendar-event-detail-close';
    close.textContent = 'Cerrar';
    const title = document.createElement('h3');
    title.id = 'calendarEventDetailTitle';
    title.textContent = item.title;
    const schedule = document.createElement('p');
    schedule.textContent = formatCalendarRange(item);
    const attendance = document.createElement('p');
    attendance.className = 'field-help';
    attendance.textContent = item.attendanceStatus === 'declined'
        ? 'Marcaste que no asistirás.'
        : item.attendanceStatus === 'tentative'
            ? 'Tu asistencia figura como tentativa.'
            : item.attendanceStatus === 'needsAction'
                ? 'Todavía no respondiste la invitación.'
                : 'Asistencia confirmada o sin respuesta propia disponible.';
    const task = document.createElement('p');
    task.className = 'field-help';
    task.textContent = item.linkedTask ? `Tarea vinculada: ${item.linkedTask.name}` : 'Todavía no hay una tarea vinculada.';
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    if (item.hasMeet) {
        const meet = document.createElement('button');
        meet.type = 'button';
        meet.className = 'btn small';
        meet.textContent = 'Abrir Meet';
        meet.addEventListener('click', () => {
            closeDialog();
            handlers.open(item.key);
        });
        actions.append(meet);
    }
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'btn small primary';
    link.textContent = item.linkedTask ? 'Cambiar tarea' : 'Vincular o crear tarea';
    link.addEventListener('click', () => {
        closeDialog(false);
        handlers.link(item.key);
        queueMicrotask(() => document.querySelector<HTMLElement>(`[data-event-key="${item.key}"] .calendar-task-linker-inline`)?.focus());
    });
    actions.append(link);
    const closeDialog = (restoreFocus = true): void => {
        document.removeEventListener('keydown', trapDialogKeyboard, true);
        backdrop.remove();
        closeActiveCalendarEventDialog = null;
        if (restoreFocus) previouslyFocused?.focus();
    };
    const trapDialogKeyboard = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [close, ...Array.from(actions.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };
    close.addEventListener('click', () => closeDialog());
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeDialog(); });
    dialog.append(close, title, schedule, attendance, task, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    document.addEventListener('keydown', trapDialogKeyboard, true);
    closeActiveCalendarEventDialog = closeDialog;
    close.focus();
}

function renderCalendarWeek(items: CalendarAgendaItemV1[], handlers: CalendarAgendaHandlers, options: CalendarAgendaRenderOptions): HTMLElement {
    const layout = document.createElement('div');
    layout.className = 'calendar-week-layout';
    const scroller = document.createElement('div');
    scroller.className = 'calendar-week-scroll';
    scroller.setAttribute('aria-label', 'Semana de próximos eventos por horario');
    scroller.tabIndex = 0;
    const shell = document.createElement('div');
    shell.className = 'calendar-week-shell';
    const byDay = new Map<string, CalendarAgendaItemV1[]>();
    for (const item of items) {
        const day = calendarItemDayKey(item);
        byDay.set(day, [...(byDay.get(day) || []), item]);
    }

    const days = agendaWeekDays();
    const header = document.createElement('div');
    header.className = 'calendar-week-header';
    const corner = document.createElement('span');
    corner.className = 'calendar-week-corner';
    corner.textContent = 'Hora';
    header.append(corner);
    for (const day of days) {
        const heading = document.createElement('h4');
        heading.textContent = formatCalendarDayLabel(day);
        if (day === calendarLocalDayKey(new Date())) heading.dataset.today = 'true';
        header.append(heading);
    }

    const allDay = document.createElement('div');
    allDay.className = 'calendar-week-all-day';
    const allDayLabel = document.createElement('span');
    allDayLabel.textContent = 'Todo el día';
    allDay.append(allDayLabel);
    for (const day of days) {
        const cell = document.createElement('div');
        cell.className = 'calendar-week-all-day-cell';
        const allDayItems = (byDay.get(day) || []).filter((item) => item.allDay);
        for (const item of allDayItems) {
            const event = createCalendarEventRow(item, handlers, { ...options, compactWeek: true, inlinePanel: false });
            event.classList.add('calendar-week-all-day-event');
            cell.append(event);
        }
        allDay.append(cell);
    }

    const timeline = document.createElement('div');
    timeline.className = 'calendar-week-timeline';
    timeline.style.setProperty('--calendar-week-hours', String(CALENDAR_WEEK_END_HOUR - CALENDAR_WEEK_START_HOUR));
    timeline.style.setProperty('--calendar-hour-height', `${CALENDAR_WEEK_HOUR_HEIGHT}px`);
    const timeAxis = document.createElement('div');
    timeAxis.className = 'calendar-week-time-axis';
    for (let hour = CALENDAR_WEEK_START_HOUR; hour <= CALENDAR_WEEK_END_HOUR; hour += 1) {
        const label = document.createElement('span');
        label.style.top = `${(hour - CALENDAR_WEEK_START_HOUR) * CALENDAR_WEEK_HOUR_HEIGHT}px`;
        label.textContent = `${String(hour).padStart(2, '0')}:00`;
        timeAxis.append(label);
    }
    timeline.append(timeAxis);
    for (const day of days) {
        const track = document.createElement('div');
        track.className = 'calendar-week-day-track';
        track.setAttribute('aria-label', formatCalendarDayLabel(day));
        for (const entry of layoutCalendarWeekEvents((byDay.get(day) || []).filter((candidate) => !candidate.allDay))) {
            const { item, position, column, columns } = entry;
            const event = createCalendarEventRow(item, handlers, { ...options, compactWeek: true, inlinePanel: false });
            event.classList.add('calendar-week-event');
            event.style.top = `${position.top}px`;
            event.style.height = `${position.height}px`;
            event.style.setProperty('--calendar-event-column', String(column));
            event.style.setProperty('--calendar-event-columns', String(columns));
            track.append(event);
        }
        timeline.append(track);
    }

    shell.append(header, allDay, timeline);
    scroller.append(shell);
    layout.append(scroller);
    const activeItem = items.find((item) => item.key === options.activeEventKey);
    if (activeItem) layout.append(createCalendarInlinePanel(activeItem, handlers, options));
    return layout;
}

function calendarLocalDayKey(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function calendarWeekEventPosition(item: CalendarAgendaItemV1): { top: number; height: number } | null {
    const start = new Date(item.start);
    const end = new Date(item.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
    const windowMinutes = (CALENDAR_WEEK_END_HOUR - CALENDAR_WEEK_START_HOUR) * 60;
    const startMinutes = start.getHours() * 60 + start.getMinutes() - CALENDAR_WEEK_START_HOUR * 60;
    const durationMinutes = Math.max(15, (end.getTime() - start.getTime()) / 60_000);
    if (startMinutes >= windowMinutes || startMinutes + durationMinutes <= 0) return null;
    const visibleStart = Math.max(0, Math.min(windowMinutes, startMinutes));
    const visibleEnd = Math.max(visibleStart + 15, Math.min(windowMinutes, startMinutes + durationMinutes));
    const pixelsPerMinute = CALENDAR_WEEK_HOUR_HEIGHT / 60;
    const titleHeight = Math.min(88, 10 + Math.ceil(item.title.length / 20) * 13);
    return {
        top: visibleStart * pixelsPerMinute,
        height: Math.max(28, titleHeight, (visibleEnd - visibleStart) * pixelsPerMinute),
    };
}

interface CalendarWeekLayoutEntry {
    item: CalendarAgendaItemV1;
    position: { top: number; height: number };
    column: number;
    columns: number;
}

function layoutCalendarWeekEvents(items: CalendarAgendaItemV1[]): CalendarWeekLayoutEntry[] {
    const positioned = items.flatMap((item) => {
        const position = calendarWeekEventPosition(item);
        const start = position?.top;
        const end = position ? position.top + position.height : null;
        return position && start !== undefined && end !== null ? [{ item, position, start, end }] : [];
    }).sort((a, b) => a.start - b.start || b.end - a.end);
    const result: CalendarWeekLayoutEntry[] = [];
    let group: typeof positioned = [];
    let groupEnd = -Infinity;
    const flush = (): void => {
        if (group.length === 0) return;
        const laneEnds: number[] = [];
        const assigned = group.map((entry) => {
            let column = laneEnds.findIndex((end) => end <= entry.start);
            if (column === -1) column = laneEnds.length;
            laneEnds[column] = entry.end;
            return { ...entry, column };
        });
        const columns = Math.max(1, laneEnds.length);
        result.push(...assigned.map(({ item, position, column }) => ({ item, position, column, columns })));
        group = [];
        groupEnd = -Infinity;
    };
    for (const entry of positioned) {
        if (group.length > 0 && entry.start >= groupEnd) flush();
        group.push(entry);
        groupEnd = Math.max(groupEnd, entry.end);
    }
    flush();
    return result;
}

export function renderCalendarAgenda(
    rawView: unknown,
    handlers: CalendarAgendaHandlers = { open: () => undefined, link: () => undefined },
    options: CalendarAgendaRenderOptions = {},
): CalendarAgendaViewV1 {
    const view = normalizeCalendarView(rawView);
    const state = document.getElementById('calendarAgendaState');
    const title = document.getElementById('calendarAgendaStateTitle');
    const detail = document.getElementById('calendarAgendaStateDetail');
    const list = document.getElementById('calendarAgendaList');
    const connectionConnect = document.getElementById('connectGoogleCalendarConnectionPreview') as HTMLButtonElement | null;
    const connectionStatus = document.getElementById('googleDisabledStatus');
    const agendaConnectionLink = document.getElementById('calendarConnectionLink') as HTMLAnchorElement | null;
    const refresh = document.getElementById('refreshGoogleCalendarAgenda') as HTMLButtonElement | null;
    const disconnect = document.getElementById('disconnectGoogleCalendar') as HTMLButtonElement | null;
    const copy = describeCalendarState(view);

    if (state) state.dataset.state = view.state;
    if (title) title.textContent = copy.title;
    if (detail) detail.textContent = describeCalendarSync(view);
    if (connectionConnect) {
        connectionConnect.disabled = !view.capabilityEnabled || !['disconnected', 'error', 'reconnect-required'].includes(view.state);
        connectionConnect.setAttribute('aria-disabled', String(connectionConnect.disabled));
        connectionConnect.textContent = view.state === 'disconnected'
            ? 'Conectar Google Calendar'
            : ['error', 'reconnect-required'].includes(view.state)
                ? 'Reconectar Google Calendar'
                : 'Google Calendar conectado';
    }
    if (connectionStatus) {
        connectionStatus.textContent = describeCalendarSync(view);
    }
    const needsConnection = ['disconnected', 'reconnect-required'].includes(view.state);
    const connected = ['loading', 'ready', 'empty', 'error'].includes(view.state);
    if (agendaConnectionLink) {
        agendaConnectionLink.hidden = !view.capabilityEnabled || !needsConnection;
        agendaConnectionLink.textContent = view.state === 'reconnect-required' ? 'Reconectar Calendar' : 'Conectar Calendar';
    }
    if (refresh) {
        refresh.hidden = !view.capabilityEnabled || !connected;
        refresh.disabled = !['ready', 'empty', 'error'].includes(view.state);
    }
    if (disconnect) disconnect.disabled = !view.capabilityEnabled || ['disabled', 'disconnected'].includes(view.state);
    if (!list) return view;

    list.replaceChildren();
    if (!view.capabilityEnabled) return view;
    const visibleItems = options.showAllDay === true ? view.items : view.items.filter((item) => !item.allDay);
    const hiddenAllDayCount = view.items.length - visibleItems.length;
    if (hiddenAllDayCount > 0) {
        const note = document.createElement('li');
        note.className = 'calendar-agenda-note';
        note.textContent = `${hiddenAllDayCount} evento${hiddenAllDayCount === 1 ? '' : 's'} de todo el día oculto${hiddenAllDayCount === 1 ? '' : 's'}. Podés mostrarlos desde Conexión.`;
        list.append(note);
    }
    list.append(renderCalendarViewSelector(options.viewMode || 'agenda', handlers));
    if (options.viewStatus) {
        const saved = document.createElement('li');
        saved.className = 'calendar-view-status';
        saved.setAttribute('role', 'status');
        saved.textContent = options.viewStatus;
        list.append(saved);
    }
    if ((options.viewMode || 'agenda') === 'week') {
        const holder = document.createElement('li');
        holder.className = 'calendar-week-holder';
        holder.append(renderCalendarWeek(visibleItems, handlers, options));
        list.append(holder);
    } else {
        list.append(...renderCalendarRows(visibleItems, handlers, options));
    }
    return view;
}

function createCalendarInlinePanel(
    item: CalendarAgendaItemV1,
    handlers: CalendarAgendaHandlers,
    options: CalendarAgendaRenderOptions,
): HTMLElement {
    const panel = document.createElement('section');
    panel.className = 'calendar-task-linker calendar-task-linker-inline';
    panel.tabIndex = -1;
    panel.setAttribute('aria-label', `Vincular o crear tarea para ${item.title}`);

    const tabs = document.createElement('div');
    tabs.className = 'calendar-link-tabs';
    const searchTab = document.createElement('button');
    searchTab.type = 'button';
    searchTab.className = 'btn small';
    searchTab.textContent = 'Buscar existente';
    searchTab.setAttribute('aria-pressed', String((options.activeTab || 'search') === 'search'));
    searchTab.addEventListener('click', () => handlers.setTab?.(item.key, 'search'));
    const createTab = document.createElement('button');
    createTab.type = 'button';
    createTab.className = 'btn small';
    createTab.textContent = 'Crear tarea';
    createTab.setAttribute('aria-pressed', String(options.activeTab === 'create'));
    createTab.addEventListener('click', () => handlers.setTab?.(item.key, 'create'));
    tabs.append(searchTab, createTab);

    const scope = document.createElement('div');
    scope.className = 'calendar-link-scope';
    const occurrence = createScopeRadio(item.key, 'occurrence', options.activeScope || 'occurrence', 'Sólo esta reunión', handlers);
    scope.append(occurrence);
    if (item.seriesKey) scope.append(createScopeRadio(item.key, 'series', options.activeScope || 'occurrence', 'Esta y futuras', handlers));

    const status = document.createElement('p');
    status.className = 'field-help';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = options.panelStatus || 'Elegí buscar una tarea existente o crear una nueva.';

    const activeTab = options.activeTab || 'search';
    const searchBody = document.createElement('div');
    searchBody.className = 'calendar-link-tab-body';
    searchBody.hidden = activeTab !== 'search';
    const form = document.createElement('form');
    form.className = 'calendar-task-search-form';
    const label = document.createElement('label');
    label.textContent = 'Buscar tarea ClickUp';
    const row = document.createElement('div');
    row.className = 'calendar-task-search-row';
    const input = document.createElement('input');
    input.type = 'search';
    input.maxLength = 100;
    input.autocomplete = 'off';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn';
    submit.textContent = 'Buscar';
    row.append(input, submit);
    form.append(label, row);
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        handlers.search?.(item.key, input.value);
    });
    const results = document.createElement('div');
    results.className = 'search-results';
    for (const task of options.searchResults || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'task-search-result';
        button.setAttribute('aria-pressed', String(options.selectedTaskId === task.id));
        button.textContent = `${task.name} · ${task.id}`;
        button.addEventListener('click', () => handlers.selectTask?.(item.key, task));
        results.append(button);
    }
    const linkButton = document.createElement('button');
    linkButton.type = 'button';
    linkButton.className = 'btn primary';
    linkButton.textContent = 'Vincular tarea seleccionada';
    linkButton.disabled = !options.selectedTaskId;
    linkButton.addEventListener('click', () => handlers.saveLink?.(item.key));
    searchBody.append(form, results, linkButton);

    const createBody = document.createElement('div');
    createBody.className = 'calendar-link-tab-body';
    createBody.hidden = activeTab !== 'create';
    const summary = document.createElement('p');
    summary.className = 'calendar-create-summary';
    summary.textContent = options.taskTypeName
        ? `Se creará con título “${item.title}”, fecha del evento sin hora y tipo “${options.taskTypeName}”. Elegí una lista explícitamente; no se usa destino predeterminado silencioso.`
        : 'Elegí un tipo de tarea Meet en Conexión antes de crear.';
    const listLabel = document.createElement('label');
    listLabel.textContent = 'Lista ClickUp obligatoria';
    const listInput = document.createElement('input');
    listInput.type = 'search';
    listInput.autocomplete = 'off';
    listInput.placeholder = 'Buscar lista por espacio, carpeta o nombre…';
    listInput.value = options.createListQuery || '';
    listInput.addEventListener('input', () => handlers.searchCreateList?.(item.key, listInput.value));
    const listSelect = document.createElement('select');
    const lists = filterDestinationLists(options.createLists || [], listInput.value).slice(0, 80);
    listSelect.append(new Option(lists.length > 0 ? 'Elegí una lista…' : 'Sin listas cacheadas disponibles', ''));
    for (const list of lists) listSelect.append(new Option(list.path, list.id, false, options.selectedCreateListId === list.id));
    listSelect.value = options.selectedCreateListId || '';
    listSelect.disabled = lists.length === 0;
    listSelect.addEventListener('change', () => handlers.selectCreateList?.(item.key, listSelect.value));

    const parentForm = document.createElement('form');
    parentForm.className = 'calendar-task-search-form';
    const parentLabel = document.createElement('label');
    parentLabel.textContent = 'Tarea padre opcional';
    const parentRow = document.createElement('div');
    parentRow.className = 'calendar-task-search-row';
    const parentInput = document.createElement('input');
    parentInput.type = 'search';
    parentInput.maxLength = 100;
    parentInput.autocomplete = 'off';
    parentInput.placeholder = 'Buscar tarea padre…';
    parentInput.value = options.parentQuery || '';
    const parentSubmit = document.createElement('button');
    parentSubmit.type = 'submit';
    parentSubmit.className = 'btn';
    parentSubmit.textContent = 'Buscar padre';
    parentRow.append(parentInput, parentSubmit);
    parentForm.append(parentLabel, parentRow);
    parentForm.addEventListener('submit', (event) => {
        event.preventDefault();
        handlers.searchParent?.(item.key, parentInput.value);
    });
    const parentResults = document.createElement('div');
    parentResults.className = 'search-results';
    for (const task of options.parentResults || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'task-search-result';
        button.setAttribute('aria-pressed', String(options.selectedParentTaskId === task.id));
        button.textContent = `${task.name} · ${task.id}`;
        button.addEventListener('click', () => handlers.selectParent?.(item.key, task));
        parentResults.append(button);
    }
    const clearParent = document.createElement('button');
    clearParent.type = 'button';
    clearParent.className = 'btn small';
    clearParent.textContent = 'Sin padre';
    clearParent.disabled = !options.selectedParentTaskId;
    clearParent.addEventListener('click', () => handlers.selectParent?.(item.key, null));
    const connection = document.createElement('a');
    connection.href = '#conexion';
    connection.className = 'now-link';
    connection.textContent = 'Configurar tipo Meet en Conexión';
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'btn primary';
    create.textContent = 'Confirmar creación de tarea';
    create.disabled = !options.taskTypeName || !options.selectedCreateListId;
    create.addEventListener('click', () => handlers.create?.(item.key));
    createBody.append(summary, listLabel, listInput, listSelect, parentForm, parentResults, clearParent);
    if (!options.taskTypeName) createBody.append(connection);
    createBody.append(create);

    panel.append(tabs, scope, status, searchBody, createBody);
    return panel;
}

function createScopeRadio(
    eventKey: string,
    value: CalendarTaskLinkScope,
    active: CalendarTaskLinkScope,
    labelText: string,
    handlers: CalendarAgendaHandlers,
): HTMLElement {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `calendar-scope-${eventKey}`;
    input.value = value;
    input.checked = active === value;
    input.addEventListener('change', () => handlers.setScope?.(eventKey, value));
    label.append(input, document.createTextNode(` ${labelText}`));
    return label;
}

export async function initCalendarAgenda(port: CalendarAgendaPort = chromeCalendarAgendaPort): Promise<void> {
    const card = document.getElementById('calendarAgendaCard');
    const connectionConnect = document.getElementById('connectGoogleCalendarConnectionPreview') as HTMLButtonElement | null;
    const refresh = document.getElementById('refreshGoogleCalendarAgenda') as HTMLButtonElement | null;
    const disconnect = document.getElementById('disconnectGoogleCalendar') as HTMLButtonElement | null;
    if (!card || !connectionConnect || !refresh || !disconnect) return;

    let latestRawView: unknown = null;
    let activeEventKey = '';
    let activeScope: CalendarTaskLinkScope = 'occurrence';
    let activeTab: 'search' | 'create' = 'search';
    let selectedTask: SafeTaskSearchResult | null = null;
    let searchResults: SafeTaskSearchResult[] = [];
    let panelStatus = '';
    let selectedTaskType: CalendarTaskTypeSelectionV1 | null = null;
    let showAllDay = localPreferencePort.read(CALENDAR_SHOW_ALL_DAY_STORAGE_KEY) === 'true';
    let viewMode: CalendarAgendaDisplayMode = localPreferencePort.read(CALENDAR_AGENDA_VIEW_STORAGE_KEY) === 'week' ? 'week' : 'agenda';
    let destinationOptions: DestinationOptions = normalizeDestinationOptions(null);
    let createListQuery = '';
    let selectedCreateListId = '';
    let parentQuery = '';
    let parentResults: SafeTaskSearchResult[] = [];
    let selectedParentTask: SafeTaskSearchResult | null = null;
    let viewStatus = '';
    let busy = false;

    const setBusy = (value: boolean): void => {
        busy = value;
        card.setAttribute('aria-busy', String(value));
        if (value) {
            connectionConnect.disabled = true;
            refresh.disabled = true;
            disconnect.disabled = true;
        } else card.removeAttribute('aria-busy');
    };

    const render = (value: unknown): CalendarAgendaViewV1 => {
        latestRawView = value;
        return renderCalendarAgenda(value, {
        open: (eventKey) => { if (!busy) void port.openMeet(eventKey); },
        link: (eventKey) => {
            if (busy) return;
            activeEventKey = activeEventKey === eventKey ? '' : eventKey;
            activeScope = 'occurrence';
            activeTab = 'search';
            selectedTask = null;
            searchResults = [];
            createListQuery = '';
            selectedCreateListId = '';
            parentQuery = '';
            parentResults = [];
            selectedParentTask = null;
            panelStatus = 'Buscá y seleccioná una tarea para esta reunión.';
            render(latestRawView);
        },
        search: async (eventKey, query) => {
            const normalized = normalizeTaskSearchQuery(query);
            if (eventKey !== activeEventKey || normalized.length < 2 || busy) {
                panelStatus = 'Ingresá al menos dos caracteres.';
                render(latestRawView);
                return;
            }
            setBusy(true);
            selectedTask = null;
            searchResults = [];
            panelStatus = 'Buscando tareas…';
            render(latestRawView);
            try {
                searchResults = normalizeTaskSearchResponse(await port.searchTasks(normalized));
                panelStatus = searchResults.length > 0 ? 'Seleccioná una tarea.' : 'Sin resultados.';
            } catch { panelStatus = 'No se pudo buscar en ClickUp.'; }
            finally { setBusy(false); render(latestRawView); }
        },
        selectTask: (eventKey, task) => {
            if (eventKey !== activeEventKey) return;
            selectedTask = task;
            panelStatus = `Seleccionada: ${task.name}`;
            render(latestRawView);
        },
        saveLink: (eventKey) => {
            if (eventKey !== activeEventKey || !selectedTask || busy) return;
            const taskId = selectedTask.id;
            void run(() => port.linkTask(eventKey, taskId, activeScope));
            activeEventKey = '';
        },
        create: (eventKey) => {
            if (eventKey !== activeEventKey || !selectedTaskType || !selectedCreateListId || busy) return;
            const confirmed = window.confirm('Vas a crear una tarea en ClickUp desde este evento. ¿Continuar?');
            if (!confirmed) return;
            void run(async () => {
                const response = await port.createTask(eventKey, activeScope, selectedTaskType!.customItemId, selectedCreateListId, selectedParentTask?.id);
                const status = response && typeof response === 'object' && !Array.isArray(response)
                    ? (response as { calendarCreateStatus?: unknown }).calendarCreateStatus
                    : null;
                if (status && typeof status === 'object' && !Array.isArray(status)) {
                    const outcome = (status as { outcome?: unknown }).outcome;
                    panelStatus = outcome === 'partial'
                        ? 'Tarea creada y vinculada. El comentario con Meet falló; queda visible como estado parcial recuperable.'
                        : '✓ Tarea creada, vinculada y verificada.';
                }
                return response;
            });
        },
        searchCreateList: (eventKey, query) => {
            if (eventKey !== activeEventKey) return;
            createListQuery = query.slice(0, 160);
            selectedCreateListId = '';
            render(latestRawView);
        },
        selectCreateList: (eventKey, listId) => {
            if (eventKey !== activeEventKey) return;
            selectedCreateListId = listId;
            panelStatus = listId ? 'Lista seleccionada. El padre sigue siendo opcional.' : 'Elegí una lista ClickUp antes de crear.';
            render(latestRawView);
        },
        searchParent: async (eventKey, query) => {
            const normalized = normalizeTaskSearchQuery(query);
            if (eventKey !== activeEventKey || normalized.length < 2 || busy) {
                panelStatus = 'Ingresá al menos dos caracteres para buscar padre.';
                render(latestRawView);
                return;
            }
            setBusy(true);
            parentQuery = normalized;
            parentResults = [];
            selectedParentTask = null;
            panelStatus = 'Buscando tarea padre…';
            render(latestRawView);
            try {
                parentResults = normalizeTaskSearchResponse(await port.searchTasks(normalized));
                panelStatus = parentResults.length > 0 ? 'Seleccioná un padre o continuá sin padre.' : 'Sin resultados para padre.';
            } catch { panelStatus = 'No se pudo buscar la tarea padre.'; }
            finally { setBusy(false); render(latestRawView); }
        },
        selectParent: (eventKey, task) => {
            if (eventKey !== activeEventKey) return;
            selectedParentTask = task;
            panelStatus = task ? `Padre seleccionado: ${task.name}` : 'Se creará sin tarea padre.';
            render(latestRawView);
        },
        setScope: (eventKey, scope) => {
            if (eventKey !== activeEventKey) return;
            activeScope = scope;
            render(latestRawView);
        },
        setTab: (eventKey, tab) => {
            if (eventKey !== activeEventKey) return;
            activeTab = tab;
            panelStatus = tab === 'create' ? 'Revisá el resumen y confirmá explícitamente.' : 'Buscá y seleccioná una tarea para esta reunión.';
            render(latestRawView);
        },
        setView: (nextView) => {
            viewMode = nextView;
            localPreferencePort.write(CALENDAR_AGENDA_VIEW_STORAGE_KEY, nextView);
            viewStatus = `✓ Vista ${nextView === 'week' ? 'Semana' : 'Agenda'} guardada.`;
            render(latestRawView);
        },
    }, {
        showAllDay,
        viewMode,
        activeEventKey,
        activeScope,
        activeTab,
        searchResults,
        selectedTaskId: selectedTask?.id,
        panelStatus,
        taskTypeName: selectedTaskType?.name,
        createLists: destinationOptions.lists,
        createListQuery,
        selectedCreateListId,
        parentQuery,
        parentResults,
        selectedParentTaskId: selectedParentTask?.id,
        viewStatus,
    });
    };

    const run = async (operation: () => Promise<unknown>): Promise<void> => {
        if (busy) return;
        setBusy(true);
        try { render(await operation()); }
        catch { render({ state: 'error', capabilityEnabled: true, items: [] }); }
        finally { setBusy(false); }
    };

    connectionConnect.addEventListener('click', () => { void run(() => port.connect()); });
    refresh.addEventListener('click', () => { void run(() => port.refresh()); });
    disconnect.addEventListener('click', () => {
        activeEventKey = '';
        void run(() => port.disconnect());
    });

    await initCalendarConnectionSettings(port, (nextShowAllDay, nextTaskType) => {
        showAllDay = nextShowAllDay;
        selectedTaskType = nextTaskType;
        if (latestRawView) render(latestRawView);
    });
    try { destinationOptions = normalizeDestinationOptions(await port.getDestinationOptions()); }
    catch { destinationOptions = normalizeDestinationOptions(null); }
    await run(() => port.getAgenda());
}

function normalizeCustomTaskTypes(value: unknown): ClickUpCustomTaskType[] {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value as { custom_items?: unknown } : {};
    if (!Array.isArray(source.custom_items)) return [];
    const seen = new Set<number>();
    const types: ClickUpCustomTaskType[] = [];
    for (const raw of source.custom_items.slice(0, 200)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const item = raw as { id?: unknown; name?: unknown };
        if (!Number.isInteger(item.id) || Number(item.id) <= 0 || seen.has(Number(item.id))) continue;
        const name = typeof item.name === 'string' ? item.name.trim().slice(0, 160) : '';
        if (!name) continue;
        seen.add(Number(item.id));
        types.push({ id: Number(item.id), name });
    }
    return types;
}

function normalizeTaskTypeSelection(value: unknown): CalendarTaskTypeSelectionV1 | null {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value as { selection?: unknown } : {};
    const selection = source.selection && typeof source.selection === 'object' && !Array.isArray(source.selection)
        ? source.selection as { customItemId?: unknown; name?: unknown; updatedAt?: unknown }
        : null;
    if (!selection || !Number.isInteger(selection.customItemId) || Number(selection.customItemId) <= 0) return null;
    const name = typeof selection.name === 'string' ? selection.name.trim().slice(0, 160) : '';
    if (!name) return null;
    return { customItemId: Number(selection.customItemId), name, updatedAt: typeof selection.updatedAt === 'number' ? selection.updatedAt : Date.now() };
}

async function initCalendarConnectionSettings(
    port: CalendarAgendaPort,
    onChange: (showAllDay: boolean, selection: CalendarTaskTypeSelectionV1 | null) => void,
): Promise<void> {
    const toggle = document.getElementById('calendarShowAllDayToggle') as HTMLInputElement | null;
    const search = document.getElementById('calendarTaskTypeSearch') as HTMLInputElement | null;
    const select = document.getElementById('calendarTaskTypeSelect') as HTMLSelectElement | null;
    const status = document.getElementById('calendarTaskTypeStatus');
    let showAllDay = localPreferencePort.read(CALENDAR_SHOW_ALL_DAY_STORAGE_KEY) === 'true';
    let types: ClickUpCustomTaskType[] = [];
    let selection: CalendarTaskTypeSelectionV1 | null = null;

    const renderTypes = (): void => {
        if (!select) return;
        const query = (search?.value || '').trim().toLocaleLowerCase();
        const visible = types.filter((type) => type.name.toLocaleLowerCase().includes(query)).slice(0, 80);
        const placeholder = new Option(types.length > 0 ? 'Elegí un tipo…' : 'Sin tipos disponibles', '');
        const options = visible.map((type) => new Option(type.name, String(type.id), false, selection?.customItemId === type.id));
        select.replaceChildren(placeholder, ...options);
        select.disabled = types.length === 0;
        if (selection && types.some((type) => type.id === selection?.customItemId)) select.value = String(selection.customItemId);
    };

    if (toggle && toggle.dataset.calendarReady !== 'true') {
        toggle.dataset.calendarReady = 'true';
        toggle.checked = showAllDay;
        toggle.addEventListener('change', () => {
            showAllDay = toggle.checked;
            localPreferencePort.write(CALENDAR_SHOW_ALL_DAY_STORAGE_KEY, String(showAllDay));
            if (status) status.textContent = `✓ Guardado: eventos de todo el día ${showAllDay ? 'visibles' : 'ocultos'}.`;
            onChange(showAllDay, selection);
        });
    }

    search?.addEventListener('input', renderTypes);
    select?.addEventListener('change', async () => {
        const customItemId = Number(select.value);
        const chosen = types.find((type) => type.id === customItemId);
        if (!chosen) {
            selection = null;
            if (status) status.textContent = 'Seleccioná un tipo retornado por ClickUp.';
            onChange(showAllDay, selection);
            return;
        }
        try {
            selection = normalizeTaskTypeSelection(await port.saveTaskTypeConfig(chosen.id));
            if (status) status.textContent = selection ? `✓ Guardado: tipo ${selection.name}.` : 'No se pudo guardar el tipo.';
        } catch {
            if (status) status.textContent = 'No se pudo guardar el tipo.';
        }
        renderTypes();
        onChange(showAllDay, selection);
    });

    try {
        selection = normalizeTaskTypeSelection(await port.getTaskTypeConfig());
        types = normalizeCustomTaskTypes(await port.getCustomTaskTypes());
        if (selection && !types.some((type) => type.id === selection?.customItemId)) selection = null;
        if (status) status.textContent = selection
            ? `✓ Configuración activa: tipo ${selection.name}.`
            : types.length > 0
                ? 'No hay ningún tipo de tarea seleccionado. Elegí el tipo Meet para habilitar la creación.'
                : 'No hay tipos de tarea disponibles o falta conectar ClickUp.';
    } catch {
        if (status) status.textContent = 'No se pudieron consultar tipos de tarea.';
    }
    renderTypes();
    onChange(showAllDay, selection);
}

/* ------------------------------------------------------------------ *
 * Destino predeterminado (D2)
 *
 * Todo se resuelve con datos ya cacheados por el background. Esta vista
 * no consulta ClickUp ni escribe en el almacenamiento de la extensión:
 * pide y confirma a través de dos mensajes locales.
 * ------------------------------------------------------------------ */

export interface DestinationPort {
    getOptions(): Promise<unknown>;
    saveDestination(selection: DestinationSelection): Promise<unknown>;
}

const chromeDestinationPort: DestinationPort = {
    getOptions: () => chrome.runtime.sendMessage({ action: 'getDestinationOptions' }),
    saveDestination: (selection) => chrome.runtime.sendMessage({ action: 'setDefaultDestination', data: selection }),
};

function setDestinationState(state: string, title: string, detail: string): void {
    const container = document.getElementById('destinationState');
    const titleNode = document.getElementById('destinationStateTitle');
    const detailNode = document.getElementById('destinationStateDetail');
    if (!container || !titleNode || !detailNode) return;
    container.dataset.state = state;
    titleNode.textContent = title;
    detailNode.textContent = detail;
}

function fillSelect(select: HTMLSelectElement, entries: { id: string; label: string }[], selectedId?: string): void {
    select.replaceChildren();
    for (const entry of entries) {
        // new Option nunca interpreta el texto como marcado.
        const option = new Option(entry.label, entry.id, false, entry.id === selectedId);
        select.append(option);
    }
}

export function renderDestinationCurrent(current: DestinationSelection | null): void {
    const chip = document.getElementById('destinationCurrent');
    if (!chip) return;

    chip.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.setAttribute('aria-hidden', 'true');
    chip.append(dot, document.createTextNode(current ? (current.listName || current.listId) : 'Sin destino'));
    chip.className = current ? 'chip' : 'chip blocked';
}

export function renderDestination(options: DestinationOptions, now?: number): void {
    const teamSelect = document.getElementById('destinationTeam') as HTMLSelectElement | null;
    const listSelect = document.getElementById('destinationList') as HTMLSelectElement | null;
    const saveButton = document.getElementById('destinationSave') as HTMLButtonElement | null;
    const searchInput = document.getElementById('destinationListSearch') as HTMLInputElement | null;
    if (!teamSelect || !listSelect || !saveButton) return;

    const state = classifyDestinationState(options, now);
    const copy = describeDestinationState(state, options);
    setDestinationState(state, copy.title, copy.detail);
    renderDestinationCurrent(options.current);
    if (searchInput) searchInput.value = '';

    fillSelect(
        teamSelect,
        options.teams.map((team) => ({ id: team.id, label: team.name })),
        options.preferredTeamId ?? undefined,
    );
    fillSelect(
        listSelect,
        options.lists.map((list) => ({ id: list.id, label: list.path })),
        options.current?.listId,
    );

    const currentAvailable = options.current !== null
        && options.lists.some((list) => list.id === options.current?.listId);
    if (!currentAvailable) {
        const placeholder = new Option('Elegí una lista', '', true, true);
        placeholder.disabled = true;
        listSelect.prepend(placeholder);
    }

    // El workspace se muestra para dar contexto, pero cambiarlo exige
    // re-sincronizar la jerarquía: eso pertenece a la fase de sincronización.
    teamSelect.disabled = true;
    const selectable = options.lists.length > 0;
    if (searchInput) searchInput.disabled = !selectable;
    listSelect.disabled = !selectable;
    saveButton.disabled = true;
}

export function initDefaultDestination(port: DestinationPort = chromeDestinationPort): Promise<void> {
    const form = document.getElementById('destinationForm') as HTMLFormElement | null;
    const listSelect = document.getElementById('destinationList') as HTMLSelectElement | null;
    const searchInput = document.getElementById('destinationListSearch') as HTMLInputElement | null;
    const saveButton = document.getElementById('destinationSave') as HTMLButtonElement | null;
    if (!form || !listSelect || !saveButton || !searchInput) return Promise.resolve();

    let options: DestinationOptions = normalizeDestinationOptions(null);
    let saving = false;

    listSelect.addEventListener('change', () => {
        saveButton.disabled = !listSelect.value || listSelect.value === options.current?.listId;
    });

    searchInput.addEventListener('input', () => {
        const matches = filterDestinationLists(options.lists, searchInput.value);
        fillSelect(listSelect, matches.map((list) => ({ id: list.id, label: list.path })));
        const placeholderText = matches.length > 0
            ? `${matches.length} coincidencia${matches.length === 1 ? '' : 's'} · elegí una lista`
            : 'Sin coincidencias';
        const placeholder = new Option(placeholderText, '', true, true);
        placeholder.disabled = true;
        listSelect.prepend(placeholder);
        listSelect.disabled = options.lists.length === 0;
        saveButton.disabled = true;
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (saving) return;

        const chosen = options.lists.find((list) => list.id === listSelect.value);
        const selection = sanitizeDestinationSelection(chosen
            ? { listId: chosen.id, listName: chosen.name, path: chosen.path }
            : null);
        if (!selection) {
            setDestinationState('error', 'Selección inválida', 'Elegí una lista de la lista desplegable antes de guardar.');
            return;
        }

        saving = true;
        saveButton.disabled = true;
        listSelect.disabled = true;
        form.setAttribute('aria-busy', 'true');
        setDestinationState('loading', 'Guardando…', 'Confirmando el destino con el background de la extensión.');

        try {
            const response = await port.saveDestination(selection) as { ok?: boolean; current?: unknown } | null;
            // Read-back: se muestra lo que confirmó el background, no lo enviado.
            const persisted = sanitizeDestinationSelection(response?.current);
            if (response?.ok !== true || !persisted) {
                setDestinationState('error', 'No se pudo guardar', 'El destino no quedó confirmado. Revisá la selección e intentá de nuevo.');
                return;
            }
            options = { ...options, current: persisted };
            searchInput.value = '';
            renderDestination(options);
        } catch {
            setDestinationState('error', 'No se pudo guardar', 'La extensión no respondió. Intentá nuevamente en unos segundos.');
        } finally {
            saving = false;
            form.removeAttribute('aria-busy');
            saveButton.disabled = options.lists.length === 0
                || !listSelect.value
                || listSelect.value === options.current?.listId;
            listSelect.disabled = options.lists.length === 0;
        }
    });

    const refresh = async (): Promise<void> => {
        try {
            options = normalizeDestinationOptions(await port.getOptions());
        } catch {
            options = normalizeDestinationOptions(null);
        }
        renderDestination(options);
    };
    refreshDefaultDestination = refresh;
    return refresh();
}

type TaskSearchUiState = 'blocked' | 'idle' | 'loading' | 'ready' | 'empty' | 'error';

function setTaskSearchState(state: TaskSearchUiState, title: string, detail: string): void {
    const container = document.getElementById('taskSearchState');
    const titleNode = document.getElementById('taskSearchStateTitle');
    const detailNode = document.getElementById('taskSearchStateDetail');
    if (!container || !titleNode || !detailNode) return;
    container.dataset.state = state;
    titleNode.textContent = title;
    detailNode.textContent = detail;
}

export function renderTaskSearchResults(tasks: SafeTaskSearchResult[]): void {
    const results = document.getElementById('taskSearchResults');
    if (!results) return;
    results.replaceChildren();
    for (const task of tasks) {
        const item = document.createElement('li');
        item.className = 'task-search-result';
        const name = document.createElement('strong');
        name.textContent = task.name;
        const id = document.createElement('code');
        id.textContent = task.id;
        const status = document.createElement('span');
        status.textContent = task.status;
        item.append(name, id, status);
        results.append(item);
    }
}

export function initTaskSearch(port: TaskSearchPort = chromeTaskSearchPort, enabled = TASK_SEARCH_RUNTIME_ENABLED): void {
    const form = document.getElementById('taskSearchForm') as HTMLFormElement | null;
    const input = document.getElementById('appTaskSearch') as HTMLInputElement | null;
    const button = document.getElementById('appTaskSearchButton') as HTMLButtonElement | null;
    if (!form || !input || !button || !enabled) return;

    input.disabled = false;
    button.disabled = false;
    setTaskSearchState('idle', 'Lista para buscar', 'Ingresá al menos dos caracteres y confirmá la búsqueda.');
    let requestId = 0;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const query = normalizeTaskSearchQuery(input.value);
        if (query.length < 2) {
            renderTaskSearchResults([]);
            setTaskSearchState('idle', 'Búsqueda incompleta', 'Ingresá al menos dos caracteres.');
            return;
        }

        const currentRequest = ++requestId;
        input.disabled = true;
        button.disabled = true;
        form.setAttribute('aria-busy', 'true');
        renderTaskSearchResults([]);
        setTaskSearchState('loading', 'Buscando…', 'Consultando tareas mediante el background de la extensión.');
        try {
            const response = await port.searchTasks(query);
            if (isTaskSearchFailure(response)) throw new Error('TASK_SEARCH_FAILED');
            const tasks = normalizeTaskSearchResponse(response);
            if (currentRequest !== requestId) return;
            renderTaskSearchResults(tasks);
            if (tasks.length > 0) {
                setTaskSearchState('ready', `${tasks.length} resultado${tasks.length === 1 ? '' : 's'}`, 'Resultados limitados y normalizados para esta vista.');
            } else {
                setTaskSearchState('empty', 'Sin resultados', 'Probá con otro título, ID o URL de tarea.');
            }
        } catch {
            if (currentRequest !== requestId) return;
            setTaskSearchState('error', 'No se pudo buscar', 'Revisá la conexión de ClickUp o intentá nuevamente.');
        } finally {
            if (currentRequest === requestId) {
                input.disabled = false;
                button.disabled = false;
                form.removeAttribute('aria-busy');
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Calendar inicia primero para que un fallo ajeno en otro módulo visual no
    // deje su control en el estado estático desactivado.
    void initCalendarAgenda();
    initThemeSwitcher();
    initOwnerThemeUnlock();
    initAppNavigation();
    void initGmailIntegrationPreference();
    initDashboardCustomizer();
    initExecutionBoardControls();
    initBulkEditPreview();
    initTaskTimeSort();
    void initWorkSchedule();
    initDashboardRefresh();
    void initDashboardSummary();
    void initLocalConnections();
    void initDefaultDestination();
    initTaskSearch();
    initCausalRecorder(document);
});
