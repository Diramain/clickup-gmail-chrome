import { openOrFocusAppTab } from '../src/app-tab';
import { toTimeEntryTimestamp } from '../src/time-entry-history';
import type { TimeEntry } from '../src/types/clickup';
import type { ClickUpAuthMethod } from '../src/clickup-auth';
import { bindLanguageSelectors, initLocalization, t } from '../src/i18n';

interface ExtensionStatus { authenticated?: boolean; configured?: boolean; requiresReauth?: boolean; authMethod?: ClickUpAuthMethod }
interface LastTrackedTask { id: string; name: string; teamId: string }
interface MeetPriorityStatus {
    enabled: boolean;
    status: 'idle' | 'awaiting-task' | 'tracking' | 'paused' | 'ignored';
    conflict?: boolean;
    taskId?: string;
    previousTaskId?: string;
    title?: string;
}
interface SearchTask { id: string; name: string }
interface MeetCreationContext {
    destination?: { listId?: string; path?: string; listName?: string } | null;
    taskType?: { customItemId?: number; name?: string } | null;
}

const THEME_STORAGE_KEY = 'cgc-app-theme-v1';

function sendMessage<T>(message: unknown): Promise<T> {
    return chrome.runtime.sendMessage(message) as Promise<T>;
}

export function resolveMinimalTheme(value: unknown): 'paper' | 'clickup' | 'spiritfox' {
    if (typeof value !== 'string') return 'paper';
    const theme = value.trim().toLowerCase();
    return theme === 'clickup' || theme === 'spiritfox' ? theme : 'paper';
}

export function sanitizeLastTrackedTask(value: unknown): LastTrackedTask | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const task = value as Record<string, unknown>;
    const id = typeof task.id === 'string' ? task.id.trim() : '';
    const teamId = typeof task.teamId === 'string' ? task.teamId.trim() : '';
    const name = typeof task.name === 'string' ? task.name.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !/^[A-Za-z0-9_-]{1,100}$/.test(teamId) || !name || name.length > 500) return null;
    return { id, teamId, name };
}

export function formatElapsed(start: number): string {
    const elapsed = Math.max(0, Date.now() - start);
    const hours = Math.floor(elapsed / 3_600_000);
    const minutes = Math.floor((elapsed % 3_600_000) / 60_000);
    const seconds = Math.floor((elapsed % 60_000) / 1_000);
    const centiseconds = Math.floor((elapsed % 1_000) / 10);
    return [hours, minutes, seconds, centiseconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function applyPopupTheme(): void {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(THEME_STORAGE_KEY); } catch { /* paper es fallback seguro */ }
    document.documentElement.dataset.theme = resolveMinimalTheme(stored);
}

export async function initMinimalPopup(): Promise<void> {
    await initLocalization();
    bindLanguageSelectors();
    applyPopupTheme();
    window.addEventListener('storage', (event) => { if (event.key === THEME_STORAGE_KEY) applyPopupTheme(); });

    const connection = document.getElementById('miniConnection');
    const title = document.getElementById('miniTimerTitle');
    const display = document.getElementById('miniTimerDisplay');
    const timerState = document.getElementById('miniTimerState');
    const lastTaskLabel = document.getElementById('miniLastTask');
    const state = document.getElementById('miniState');
    const play = document.getElementById('miniPlayTimer') as HTMLButtonElement | null;
    const stop = document.getElementById('miniStopTimer') as HTMLButtonElement | null;
    const open = document.getElementById('miniOpenApp') as HTMLButtonElement | null;
    const autoStart = document.getElementById('miniAutoStart') as HTMLInputElement | null;
    const autoStop = document.getElementById('miniAutoStop') as HTMLInputElement | null;
    if (!connection || !title || !display || !timerState || !lastTaskLabel || !state || !play || !stop || !open || !autoStart || !autoStop) return;

    let preferredTeamId = '';
    let lastTrackedTask: LastTrackedTask | null = null;
    let timerInterval: number | null = null;
    const clearTimerInterval = (): void => {
        if (timerInterval !== null) window.clearInterval(timerInterval);
        timerInterval = null;
    };

    const renderTimer = async (): Promise<void> => {
        clearTimerInterval();
        const timer = preferredTeamId ? await sendMessage<TimeEntry | null>({ action: 'getRunningTimer', data: { teamId: preferredTeamId } }) : null;
        const rawStart = timer?.start || (timer as (TimeEntry & { at?: string }) | null)?.at;
        const running = Boolean(timer && rawStart);
        play.disabled = running || !lastTrackedTask;
        stop.disabled = !running;
        timerState.textContent = running ? t('minimal.inProgress') : t('minimal.stopped');
        timerState.dataset.running = String(running);
        lastTaskLabel.textContent = lastTrackedTask ? t('minimal.lastTask', { name: lastTrackedTask.name }) : t('minimal.noPrevious');
        if (!timer || !rawStart) {
            title.textContent = t('minimal.noTimer');
            display.textContent = '00:00:00:00';
            return;
        }
        const taskId = String(timer.task?.id || '').trim();
        const taskName = String(timer.task?.name || taskId || t('minimal.activeTimer')).slice(0, 500);
        title.textContent = taskName;
        if (/^[A-Za-z0-9_-]{1,100}$/.test(taskId) && preferredTeamId) {
            lastTrackedTask = { id: taskId, name: taskName, teamId: preferredTeamId };
            await chrome.storage.local.set({ lastTrackedTaskV1: lastTrackedTask });
            lastTaskLabel.textContent = t('minimal.lastTask', { name: taskName });
        }
        const start = toTimeEntryTimestamp(rawStart);
        const tick = (): void => { display.textContent = formatElapsed(start); };
        tick();
        timerInterval = window.setInterval(tick, 50);
    };

    try {
        const preferences = await chrome.storage.local.get(['autoStartTimer', 'autoStopTimer', 'lastTrackedTaskV1']);
        autoStart.checked = preferences.autoStartTimer === true;
        autoStop.checked = preferences.autoStopTimer === true;
        lastTrackedTask = sanitizeLastTrackedTask(preferences.lastTrackedTaskV1);
        const bindPreference = (input: HTMLInputElement, key: 'autoStartTimer' | 'autoStopTimer'): void => {
            input.addEventListener('change', () => {
                const requested = input.checked;
                input.disabled = true;
                void chrome.storage.local.set({ [key]: requested }).then(() => {
                    state.textContent = t('minimal.trackingSaved');
                }).catch(() => {
                    input.checked = !requested;
                    state.textContent = t('minimal.trackingSaveFailed');
                }).finally(() => { input.disabled = false; });
            });
        };
        bindPreference(autoStart, 'autoStartTimer');
        bindPreference(autoStop, 'autoStopTimer');
    } catch {
        autoStart.disabled = true;
        autoStop.disabled = true;
        state.textContent = 'No se pudieron leer las preferencias de seguimiento.';
    }

    open.addEventListener('click', async () => {
        open.disabled = true;
        try { await openOrFocusAppTab(); window.close(); }
        catch { state.textContent = 'No se pudo abrir la app completa.'; open.disabled = false; }
    });

    play.addEventListener('click', async () => {
        if (!lastTrackedTask) return;
        play.disabled = true;
        state.textContent = 'Iniciando última tarea…';
        try {
            await sendMessage({ action: 'startTimer', data: { teamId: lastTrackedTask.teamId, taskId: lastTrackedTask.id } });
            state.textContent = 'Temporizador iniciado.';
            await renderTimer();
        } catch { state.textContent = 'No se pudo iniciar el temporizador.'; play.disabled = false; }
    });

    stop.addEventListener('click', async () => {
        if (!preferredTeamId) return;
        stop.disabled = true;
        state.textContent = 'Deteniendo temporizador…';
        try {
            await sendMessage({ action: 'stopTimer', data: { teamId: preferredTeamId } });
            state.textContent = 'Temporizador detenido.';
            await renderTimer();
        } catch { state.textContent = 'No se pudo detener el temporizador.'; stop.disabled = false; }
    });

    let authenticated = false;
    try {
        const status = await sendMessage<ExtensionStatus>({ action: 'getStatus' });
        authenticated = status.authenticated === true;
        connection.textContent = status.authenticated ? t('auth.connected') : t('auth.disconnected');
        connection.dataset.state = status.authenticated ? 'connected' : 'blocked';
        if (!status.authenticated) {
            state.textContent = status.requiresReauth
                ? t('minimal.replaceToken')
                : t('minimal.configureClickUp');
            play.disabled = true;
            stop.disabled = true;
        }
    } catch {
        connection.textContent = t('auth.unavailable');
        connection.dataset.state = 'blocked';
        state.textContent = 'No se pudo leer el estado local de la extensión.';
    }
    if (!authenticated) {
        const meetPriority = document.getElementById('miniMeetPriority') as HTMLInputElement | null;
        const meetStatus = document.getElementById('miniMeetStatus');
        if (meetPriority) meetPriority.disabled = true;
        if (meetStatus) meetStatus.textContent = 'Conectá ClickUp para vincular una Meet.';
        return;
    }

    try {
        const preferred = await sendMessage<{ teamId?: string }>({ action: 'getPreferredTeam' });
        preferredTeamId = typeof preferred.teamId === 'string' ? preferred.teamId : '';
    } catch {
        preferredTeamId = '';
    }
    initQuickMeet(preferredTeamId, renderTimer, state);
    if (!preferredTeamId) {
        state.textContent = t('minimal.workspaceRequired');
    } else {
        try { await renderTimer(); }
        catch { state.textContent = 'Meet está disponible, pero no se pudo consultar el temporizador.'; }
    }
    window.addEventListener('pagehide', clearTimerInterval, { once: true });
}

function initQuickMeet(teamId: string, refreshTimer: () => Promise<void>, globalState: HTMLElement): void {
    const priority = document.getElementById('miniMeetPriority') as HTMLInputElement | null;
    const statusNode = document.getElementById('miniMeetStatus');
    const chooser = document.getElementById('miniMeetChooser');
    const search = document.getElementById('miniMeetTaskSearch') as HTMLInputElement | null;
    const results = document.getElementById('miniMeetTaskResults');
    const remember = document.getElementById('miniMeetRemember') as HTMLInputElement | null;
    const assign = document.getElementById('miniMeetAssign') as HTMLButtonElement | null;
    const change = document.getElementById('miniMeetChangeTask') as HTMLButtonElement | null;
    const createTitle = document.getElementById('miniMeetTaskTitle') as HTMLInputElement | null;
    const hasParent = document.getElementById('miniMeetHasParent') as HTMLInputElement | null;
    const parentFields = document.getElementById('miniMeetParentFields');
    const parentSearch = document.getElementById('miniMeetParentSearch') as HTMLInputElement | null;
    const parentResults = document.getElementById('miniMeetParentResults');
    const createContext = document.getElementById('miniMeetCreateContext');
    const createTask = document.getElementById('miniMeetCreateTask') as HTMLButtonElement | null;
    if (!priority || !statusNode || !chooser || !search || !results || !remember || !assign || !change
        || !createTitle || !hasParent || !parentFields || !parentSearch || !parentResults || !createContext || !createTask) return;
    let selectedTask: SearchTask | null = null;
    let selectedParent: SearchTask | null = null;
    let searchRevision = 0;
    let searchTimer: number | null = null;
    let parentSearchRevision = 0;
    let parentSearchTimer: number | null = null;
    let forceChooser = false;
    let createContextReady = false;
    let lastPrefilledTitle = '';

    const updateCreateButton = (): void => {
        createTask.disabled = !createContextReady
            || createTitle.value.trim().length === 0
            || (hasParent.checked && !selectedParent);
    };

    const loadCreationContext = async (): Promise<void> => {
        try {
            const [destination, type] = await Promise.all([
                sendMessage<{ current?: MeetCreationContext['destination'] }>({ action: 'getDestinationOptions' }),
                sendMessage<{ selection?: MeetCreationContext['taskType'] }>({ action: 'getCalendarTaskTypeConfig' }),
            ]);
            const current = destination.current;
            const selection = type.selection;
            createContextReady = !!current?.listId && Number.isInteger(selection?.customItemId) && !!selection?.name;
            createContext.textContent = t('meet.configurationRequired');
            if (createContextReady) {
                createContext.textContent = t('meet.destinationType', {
                    destination: current?.path || current?.listName || 'lista configurada',
                    type: selection?.name || '',
                });
            }
        } catch {
            createContextReady = false;
            createContext.textContent = t('meet.configurationFailed');
        }
        updateCreateButton();
    };

    const renderMeet = async (): Promise<void> => {
        try {
            const meet = await sendMessage<MeetPriorityStatus>({ action: 'getMeetPriorityStatus' });
            priority.checked = meet.enabled === true;
            const pending = meet.status === 'awaiting-task';
            const active = meet.status === 'tracking' || meet.status === 'paused';
            chooser.hidden = !(meet.enabled && (pending || forceChooser));
            change.hidden = !active;
            const incomingTitle = typeof meet.title === 'string' ? meet.title.trim().slice(0, 160) : '';
            if (incomingTitle && (!createTitle.value.trim() || createTitle.value === lastPrefilledTitle)) {
                createTitle.value = incomingTitle;
                lastPrefilledTitle = incomingTitle;
                updateCreateButton();
            }
            if (!meet.enabled) statusNode.textContent = t('meet.disabled');
            else if (meet.status === 'idle') statusNode.textContent = t('meet.idle');
            else if (pending) statusNode.textContent = meet.conflict ? t('meet.conflict') : t('meet.choose');
            else if (meet.status === 'tracking') statusNode.textContent = t('meet.tracking', { task: meet.taskId || 'linked' });
            else if (meet.status === 'paused') statusNode.textContent = t('meet.paused', { task: meet.taskId || 'linked' });
            else statusNode.textContent = t('meet.ignored');
        } catch {
            statusNode.textContent = 'No se pudo consultar la sesión Meet.';
            chooser.hidden = true;
        }
    };

    priority.addEventListener('change', async () => {
        const enabled = priority.checked;
        priority.disabled = true;
        try {
            await sendMessage({ action: 'setMeetPriorityEnabled', data: { enabled } });
            globalState.textContent = enabled ? 'Prioridad Meet activada.' : 'Prioridad Meet desactivada.';
            await renderMeet();
        } catch {
            priority.checked = !enabled;
            globalState.textContent = 'No se pudo cambiar la prioridad Meet.';
        } finally { priority.disabled = false; }
    });

    search.addEventListener('input', () => {
        selectedTask = null;
        assign.disabled = true;
        const query = search.value.trim();
        const revision = ++searchRevision;
        if (searchTimer !== null) window.clearTimeout(searchTimer);
        results.replaceChildren();
        if (query.length < 2) return;
        const loading = document.createElement('p');
        loading.className = 'subtle';
        loading.textContent = t('meet.searching');
        results.append(loading);
        searchTimer = window.setTimeout(async () => {
            try {
                const response = await sendMessage<{ tasks?: Array<{ id?: unknown; name?: unknown }> }>({ action: 'searchTasks', data: { query } });
                if (revision !== searchRevision) return;
                results.replaceChildren();
                const tasks = Array.isArray(response.tasks) ? response.tasks.slice(0, 5) : [];
                for (const raw of tasks) {
                    const id = typeof raw.id === 'string' ? raw.id.slice(0, 100) : '';
                    const name = typeof raw.name === 'string' ? raw.name.slice(0, 500) : '';
                    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !name) continue;
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'mini-task-result';
                    const taskName = document.createElement('strong');
                    taskName.textContent = name;
                    const taskId = document.createElement('small');
                    taskId.textContent = id;
                    button.append(taskName, taskId);
                    button.addEventListener('click', () => {
                        selectedTask = { id, name };
                        search.value = name;
                        results.replaceChildren();
                        assign.disabled = false;
                    });
                    results.append(button);
                }
                if (!results.hasChildNodes()) {
                    const empty = document.createElement('p');
                    empty.className = 'subtle';
                    empty.textContent = t('meet.noTasks');
                    results.append(empty);
                }
            } catch {
                if (revision !== searchRevision) return;
                results.replaceChildren();
                const error = document.createElement('p');
                error.className = 'subtle';
                error.textContent = t('meet.searchFailed');
                results.append(error);
            }
        }, 250);
    });

    createTitle.addEventListener('input', updateCreateButton);
    hasParent.addEventListener('change', () => {
        parentFields.hidden = !hasParent.checked;
        if (!hasParent.checked) {
            selectedParent = null;
            parentSearch.value = '';
            parentResults.replaceChildren();
        }
        updateCreateButton();
        if (hasParent.checked) parentSearch.focus();
    });

    parentSearch.addEventListener('input', () => {
        selectedParent = null;
        updateCreateButton();
        const query = parentSearch.value.trim();
        const revision = ++parentSearchRevision;
        if (parentSearchTimer !== null) window.clearTimeout(parentSearchTimer);
        parentResults.replaceChildren();
        if (query.length < 2) return;
        const loading = document.createElement('p');
        loading.className = 'subtle';
        loading.textContent = t('meet.searchingParent');
        parentResults.append(loading);
        parentSearchTimer = window.setTimeout(async () => {
            try {
                const response = await sendMessage<{ tasks?: Array<{ id?: unknown; name?: unknown }> }>({ action: 'searchTasks', data: { query } });
                if (revision !== parentSearchRevision) return;
                parentResults.replaceChildren();
                const tasks = Array.isArray(response.tasks) ? response.tasks.slice(0, 5) : [];
                for (const raw of tasks) {
                    const id = typeof raw.id === 'string' ? raw.id.slice(0, 100) : '';
                    const name = typeof raw.name === 'string' ? raw.name.slice(0, 500) : '';
                    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !name) continue;
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'mini-task-result';
                    const taskName = document.createElement('strong');
                    taskName.textContent = name;
                    const taskId = document.createElement('small');
                    taskId.textContent = id;
                    button.append(taskName, taskId);
                    button.addEventListener('click', () => {
                        selectedParent = { id, name };
                        parentSearch.value = name;
                        parentResults.replaceChildren();
                        updateCreateButton();
                    });
                    parentResults.append(button);
                }
                if (!parentResults.hasChildNodes()) {
                    const empty = document.createElement('p');
                    empty.className = 'subtle';
                    empty.textContent = t('meet.noParents');
                    parentResults.append(empty);
                }
            } catch {
                if (revision !== parentSearchRevision) return;
                parentResults.replaceChildren();
                const error = document.createElement('p');
                error.className = 'subtle';
                error.textContent = t('meet.parentSearchFailed');
                parentResults.append(error);
            }
        }, 250);
    });

    change.addEventListener('click', () => { forceChooser = true; chooser.hidden = false; search.focus(); });
    assign.addEventListener('click', async () => {
        if (!selectedTask) return;
        if (!teamId) {
            globalState.textContent = 'Elegí un workspace desde la app completa antes de vincular la Meet.';
            return;
        }
        assign.disabled = true;
        globalState.textContent = 'Vinculando Meet e iniciando tracking…';
        try {
            await sendMessage({ action: 'assignMeetTask', data: { taskId: selectedTask.id, teamId, remember: remember.checked } });
            globalState.textContent = 'Meet vinculada y tracking iniciado.';
            forceChooser = false;
            selectedTask = null;
            search.value = '';
            results.replaceChildren();
            await Promise.all([renderMeet(), refreshTimer()]);
        } catch {
            globalState.textContent = 'No se pudo vincular: verificá que la Meet siga activa.';
            assign.disabled = false;
        }
    });

    createTask.addEventListener('click', async () => {
        const title = createTitle.value.trim();
        if (!title || !createContextReady || (hasParent.checked && !selectedParent)) return;
        createTask.disabled = true;
        globalState.textContent = t('meet.creating');
        try {
            const response = await sendMessage<{ task?: SearchTask; mappingSaved?: boolean }>({
                action: 'createMeetTask',
                data: {
                    title,
                    remember: remember.checked,
                    ...(hasParent.checked && selectedParent ? { parentTaskId: selectedParent.id } : {}),
                },
            });
            globalState.textContent = response.mappingSaved === false && remember.checked
                ? t('meet.createdMappingFailed')
                : t('meet.created');
            forceChooser = false;
            selectedParent = null;
            hasParent.checked = false;
            parentFields.hidden = true;
            parentSearch.value = '';
            parentResults.replaceChildren();
            await Promise.all([renderMeet(), refreshTimer()]);
        } catch {
            globalState.textContent = t('meet.createFailed');
            updateCreateButton();
        }
    });

    void loadCreationContext();
    void renderMeet();
    document.addEventListener('taskbridge-language-changed', () => {
        void Promise.all([loadCreationContext(), renderMeet()]);
    });
    const poll = window.setInterval(() => { void renderMeet(); }, 2_000);
    window.addEventListener('pagehide', () => window.clearInterval(poll), { once: true });
}

document.addEventListener('DOMContentLoaded', () => { void initMinimalPopup(); });
