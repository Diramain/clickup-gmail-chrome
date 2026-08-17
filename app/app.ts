import { classifyLocalClickUpStatus, type ClickUpConnectionView } from '../src/connections-state';
import { normalizeTaskSearchQuery, normalizeTaskSearchResponse, type SafeTaskSearchResult } from '../src/task-search-view';
import {
    classifyDestinationState,
    describeDestinationState,
    normalizeDestinationOptions,
    sanitizeDestinationSelection,
    type DestinationOptions,
    type DestinationSelection,
} from '../src/destination-config';

const ROUTES = Object.freeze(['inicio', 'gmail', 'tiempo', 'meet', 'sync', 'conexion', 'datos']);
type AppRoute = typeof ROUTES[number];

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

/* ------------------------------------------------------------------ *
 * Temas
 * ------------------------------------------------------------------ */

const THEMES = Object.freeze(['paper', 'clickup', 'spiritfox']);
export type AppTheme = typeof THEMES[number];

const DEFAULT_THEME: AppTheme = 'paper';
const OWNER_THEME: AppTheme = 'spiritfox';

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
    const prefersDark = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches;

    applyTheme(resolveInitialTheme(port.read(THEME_STORAGE_KEY), prefersDark, ownerUnlocked));

    if (ownerUnlocked) {
        document.querySelectorAll<HTMLElement>('.owner-theme-option').forEach((button) => {
            button.hidden = false;
        });
    }

    document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((button) => {
        button.addEventListener('click', () => {
            const choice = sanitizeThemeChoice(button.dataset.themeChoice);
            if (choice === OWNER_THEME && !ownerUnlocked) return;
            port.write(THEME_STORAGE_KEY, choice);
            applyTheme({ theme: choice, source: 'stored' });
        });
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
    if (!teamSelect || !listSelect || !saveButton) return;

    const state = classifyDestinationState(options, now);
    const copy = describeDestinationState(state, options);
    setDestinationState(state, copy.title, copy.detail);
    renderDestinationCurrent(options.current);

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

    // El workspace se muestra para dar contexto, pero cambiarlo exige
    // re-sincronizar la jerarquía: eso pertenece a la fase de sincronización.
    teamSelect.disabled = true;
    const selectable = options.lists.length > 0;
    listSelect.disabled = !selectable;
    saveButton.disabled = !selectable;
}

export function initDefaultDestination(port: DestinationPort = chromeDestinationPort): Promise<void> {
    const form = document.getElementById('destinationForm') as HTMLFormElement | null;
    const listSelect = document.getElementById('destinationList') as HTMLSelectElement | null;
    const saveButton = document.getElementById('destinationSave') as HTMLButtonElement | null;
    if (!form || !listSelect || !saveButton) return Promise.resolve();

    let options: DestinationOptions = normalizeDestinationOptions(null);
    let saving = false;

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
            renderDestination(options);
        } catch {
            setDestinationState('error', 'No se pudo guardar', 'La extensión no respondió. Intentá nuevamente en unos segundos.');
        } finally {
            saving = false;
            form.removeAttribute('aria-busy');
            saveButton.disabled = options.lists.length === 0;
            listSelect.disabled = options.lists.length === 0;
        }
    });

    return (async () => {
        try {
            options = normalizeDestinationOptions(await port.getOptions());
        } catch {
            options = normalizeDestinationOptions(null);
        }
        renderDestination(options);
    })();
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
            const tasks = normalizeTaskSearchResponse(await port.searchTasks(query));
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
    initAppNavigation();
    initDashboardCustomizer();
    void initLocalConnections();
    void initDefaultDestination();
    initTaskSearch();
});
