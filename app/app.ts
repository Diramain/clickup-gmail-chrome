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

const ROUTES = Object.freeze(['inicio', 'gmail', 'tiempo', 'meet', 'sync', 'conexion', 'datos']);
type AppRoute = typeof ROUTES[number];
let refreshDefaultDestination: (() => Promise<void>) | null = null;

const ROUTE_TITLES: Record<AppRoute, string> = {
    inicio: 'Inicio',
    gmail: 'Gmail → ClickUp',
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

/* ------------------------------------------------------------------ *
 * Preferencias locales
 *
 * Se usa `localStorage` detrás de un puerto inyectable. No se usa el
 * almacenamiento de la extensión: esta vista no debe tener autoridad
 * sobre datos que pertenecen al background.
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
export type TaskTimeSort = 'duration' | 'recent';

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
export function resolveInitialTheme(stored: unknown, prefersDark = false, ownerUnlocked = false): ResolvedTheme {
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
    { id: 'gmail', label: 'Actividad desde Gmail', note: 'Llega con la fase de Gmail → ClickUp.', available: false, inPmPreset: false },
    { id: 'focus', label: 'Calidad del foco', note: 'Llega con la fase de jornada y tiempo.', available: false, inPmPreset: false },
    { id: 'execution', label: 'Ejecución de tareas', note: 'Llega con la fase de Gmail → ClickUp.', available: false, inPmPreset: false },
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
    initThemeSwitcher();
    initOwnerThemeUnlock();
    initAppNavigation();
    initDashboardCustomizer();
    initExecutionBoardControls();
    initBulkEditPreview();
    initTaskTimeSort();
    initDashboardRefresh();
    void initDashboardSummary();
    void initLocalConnections();
    void initDefaultDestination();
    initTaskSearch();
    initCausalRecorder(document);
});
