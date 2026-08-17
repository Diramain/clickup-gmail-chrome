import { classifyLocalClickUpStatus, type ClickUpConnectionView } from '../src/connections-state';
import { normalizeTaskSearchQuery, normalizeTaskSearchResponse, type SafeTaskSearchResult } from '../src/task-search-view';

const ROUTES = Object.freeze(['inicio', 'tareas', 'seguimiento', 'reuniones', 'conexiones', 'configuracion']);
type AppRoute = typeof ROUTES[number];

const ROUTE_TITLES: Record<AppRoute, string> = {
    inicio: 'Inicio',
    tareas: 'Tareas',
    seguimiento: 'Seguimiento',
    reuniones: 'Reuniones',
    conexiones: 'Conexiones',
    configuracion: 'Configuración',
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
    initAppNavigation();
    void initLocalConnections();
    initTaskSearch();
});
