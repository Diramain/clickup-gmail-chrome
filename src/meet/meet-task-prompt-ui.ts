import {
    extractMeetTaskIdCandidates,
    sanitizeMeetSearchSeed,
    sanitizeMeetTaskSuggestions,
    type MeetTaskSuggestion,
} from './meet-task-prompt';

type SendMeetMessage = <T>(message: unknown) => Promise<T>;
const MEET_SEARCH_BATCH_LIMIT = 10;

interface PromptUi {
    host: HTMLElement;
    search: HTMLInputElement;
    results: HTMLElement;
    status: HTMLElement;
    assign: HTMLButtonElement;
    dismiss: HTMLButtonElement;
    remember: HTMLInputElement;
}

export class MeetTaskPromptController {
    private ui: PromptUi | null = null;
    private roomKey = '';
    private selectedTask: MeetTaskSuggestion | null = null;
    private searchRevision = 0;
    private searchTimer: number | null = null;
    private seededRoomKey = '';

    constructor(
        private readonly documentRoot: Document,
        private readonly sendMessage: SendMeetMessage,
    ) {}

    async sync(roomKey: string): Promise<void> {
        const state = await this.sendMessage<{ visible?: boolean }>({ action: 'getMeetTaskPromptState' }).catch(() => ({ visible: false }));
        if (!state.visible) {
            this.remove();
            return;
        }
        this.ensurePrompt(roomKey);
        if (this.seededRoomKey !== roomKey) {
            this.seededRoomKey = roomKey;
            await this.seedSuggestions();
        }
    }

    remove(): void {
        if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
        this.searchTimer = null;
        this.searchRevision += 1;
        this.ui?.host.remove();
        this.ui = null;
        this.roomKey = '';
        this.selectedTask = null;
        this.seededRoomKey = '';
    }

    private ensurePrompt(roomKey: string): void {
        if (this.ui?.host.isConnected && this.roomKey === roomKey) return;
        this.remove();
        this.roomKey = roomKey;

        const host = this.documentRoot.createElement('div');
        host.id = 'cgc-meet-task-prompt';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = this.documentRoot.createElement('style');
        style.textContent = PROMPT_STYLES;
        const panel = this.documentRoot.createElement('section');
        panel.className = 'panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-labelledby', 'cgc-meet-prompt-title');

        const eyebrow = textElement(this.documentRoot, 'p', 'eyebrow', 'CLICKUP · GOOGLE MEET');
        const title = textElement(this.documentRoot, 'h2', '', '¿Qué tarea corresponde a esta reunión?');
        title.id = 'cgc-meet-prompt-title';
        const hint = textElement(this.documentRoot, 'p', 'hint', 'Elegí una tarea para iniciar el tracking o descartá este aviso.');
        const label = textElement(this.documentRoot, 'label', '', 'Buscar tarea');
        label.htmlFor = 'cgc-meet-task-search';
        const search = this.documentRoot.createElement('input');
        search.id = 'cgc-meet-task-search';
        search.type = 'search';
        search.maxLength = 100;
        search.autocomplete = 'off';
        search.placeholder = 'ID o nombre de la tarea';
        const results = this.documentRoot.createElement('div');
        results.className = 'results';
        results.setAttribute('role', 'listbox');
        results.setAttribute('aria-label', 'Tareas encontradas');
        const rememberRow = this.documentRoot.createElement('label');
        rememberRow.className = 'remember';
        const remember = this.documentRoot.createElement('input');
        remember.type = 'checkbox';
        const rememberText = this.documentRoot.createTextNode(' Recordar para esta sala');
        rememberRow.append(remember, rememberText);
        const status = textElement(this.documentRoot, 'p', 'status', 'El buscador está listo.');
        status.setAttribute('aria-live', 'polite');
        const actions = this.documentRoot.createElement('div');
        actions.className = 'actions';
        const dismiss = buttonElement(this.documentRoot, 'secondary', 'Descartar');
        const assign = buttonElement(this.documentRoot, 'primary', 'Vincular e iniciar');
        assign.disabled = true;
        actions.append(dismiss, assign);
        panel.append(eyebrow, title, hint, label, search, results, rememberRow, status, actions);
        shadow.append(style, panel);
        (this.documentRoot.body || this.documentRoot.documentElement).append(host);
        this.ui = { host, search, results, status, assign, dismiss, remember };

        search.addEventListener('input', () => this.scheduleSearch());
        assign.addEventListener('click', () => { void this.assignSelectedTask(); });
        dismiss.addEventListener('click', () => { void this.dismissPrompt(); });
        window.setTimeout(() => search.focus(), 0);
    }

    private async seedSuggestions(): Promise<void> {
        if (!this.ui) return;
        const seed = sanitizeMeetSearchSeed(this.documentRoot.title);
        this.ui.search.value = seed;
        const revision = ++this.searchRevision;
        this.setStatus('Buscando una coincidencia…');
        for (const candidate of extractMeetTaskIdCandidates(seed)) {
            const tasks = await this.fetchSuggestions(candidate, revision);
            if (tasks.length > 0) {
                this.renderSuggestions(tasks, true);
                return;
            }
        }
        if (seed.length >= 2) {
            const tasks = await this.fetchSuggestions(seed, revision);
            this.renderSuggestions(tasks, tasks.length > 0);
            return;
        }
        this.renderSuggestions([], false);
    }

    private scheduleSearch(): void {
        if (!this.ui) return;
        this.selectedTask = null;
        this.ui.assign.disabled = true;
        const query = this.ui.search.value.trim();
        const revision = ++this.searchRevision;
        if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
        this.ui.results.replaceChildren();
        if (query.length < 2) {
            this.setStatus('Escribí al menos dos caracteres.');
            return;
        }
        this.setStatus('Buscando…');
        this.searchTimer = window.setTimeout(async () => {
            const tasks = await this.fetchSuggestions(query, revision);
            if (revision === this.searchRevision) this.renderSuggestions(tasks, false);
        }, 250);
    }

    private async fetchSuggestions(query: string, revision: number): Promise<MeetTaskSuggestion[]> {
        if (!this.roomKey || revision !== this.searchRevision) return [];
        try {
            for (let batch = 0; batch < MEET_SEARCH_BATCH_LIMIT; batch += 1) {
                const response = await this.sendMessage<{ tasks?: unknown; hasMore?: unknown }>({
                    action: 'suggestMeetTasks',
                    data: { roomKey: this.roomKey, query: query.slice(0, 100) },
                });
                if (revision !== this.searchRevision) return [];
                const tasks = sanitizeMeetTaskSuggestions(response.tasks);
                if (tasks.length > 0 || response.hasMore !== true) return tasks;
                this.setStatus('Buscando en más tareas…');
            }
            return [];
        } catch {
            if (revision === this.searchRevision) this.setStatus('No se pudo buscar. Podés volver a intentarlo.');
            return [];
        }
    }

    private renderSuggestions(tasks: MeetTaskSuggestion[], recommendFirst: boolean): void {
        if (!this.ui) return;
        this.ui.results.replaceChildren();
        this.selectedTask = recommendFirst ? tasks[0] || null : null;
        this.ui.assign.disabled = !this.selectedTask;
        if (tasks.length === 0) {
            this.setStatus('No encontramos una coincidencia. El buscador mantiene el foco.');
            return;
        }
        tasks.forEach((task, index) => {
            const button = buttonElement(this.documentRoot, `result${recommendFirst && index === 0 ? ' recommended selected' : ''}`, '');
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', String(recommendFirst && index === 0));
            const name = textElement(this.documentRoot, 'strong', '', task.name);
            const meta = textElement(this.documentRoot, 'small', '', `${task.id}${recommendFirst && index === 0 ? ' · Recomendada' : ''}`);
            button.append(name, meta);
            button.addEventListener('click', () => {
                this.selectedTask = task;
                this.ui!.assign.disabled = false;
                for (const option of this.ui!.results.querySelectorAll('[role="option"]')) {
                    option.setAttribute('aria-selected', String(option === button));
                    option.classList.toggle('selected', option === button);
                }
                this.setStatus(`Seleccionada: ${task.name}`);
            });
            this.ui!.results.append(button);
        });
        this.setStatus(recommendFirst ? 'Revisá la recomendación o seguí buscando.' : 'Elegí una tarea de los resultados.');
        this.ui.search.focus();
    }

    private async assignSelectedTask(): Promise<void> {
        if (!this.ui || !this.selectedTask || !this.roomKey) return;
        this.setBusy(true, 'Vinculando e iniciando tracking…');
        try {
            await this.sendMessage({
                action: 'assignMeetPromptTask',
                data: { roomKey: this.roomKey, taskId: this.selectedTask.id, remember: this.ui.remember.checked },
            });
            this.remove();
        } catch {
            this.setBusy(false, 'No se pudo vincular. Verificá que la Meet siga activa.');
        }
    }

    private async dismissPrompt(): Promise<void> {
        if (!this.ui || !this.roomKey) return;
        this.setBusy(true, 'Descartando aviso…');
        try {
            await this.sendMessage({ action: 'dismissMeetPrompt', data: { roomKey: this.roomKey } });
            this.remove();
        } catch {
            this.setBusy(false, 'No se pudo descartar. Verificá que la Meet siga activa.');
        }
    }

    private setBusy(busy: boolean, message: string): void {
        if (!this.ui) return;
        this.ui.search.disabled = busy;
        this.ui.remember.disabled = busy;
        this.ui.dismiss.disabled = busy;
        this.ui.assign.disabled = busy || !this.selectedTask;
        this.setStatus(message);
    }

    private setStatus(message: string): void {
        if (this.ui) this.ui.status.textContent = message;
    }
}

function textElement<K extends keyof HTMLElementTagNameMap>(documentRoot: Document, tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
    const element = documentRoot.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

function buttonElement(documentRoot: Document, className: string, text: string): HTMLButtonElement {
    const button = documentRoot.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    return button;
}

const PROMPT_STYLES = `
    :host { all: initial; position: fixed; top: 18px; right: 18px; z-index: 2147483647; color-scheme: light; }
    * { box-sizing: border-box; }
    .panel { width: min(380px, calc(100vw - 36px)); max-height: calc(100vh - 36px); overflow: auto; padding: 20px; border: 1px solid #d8dce8; border-top: 3px solid #0091ff; border-radius: 16px; background: #fff; color: #171721; box-shadow: 0 18px 54px rgba(23, 23, 33, .22); font: 14px/1.45 Inter, Arial, sans-serif; }
    .eyebrow { margin: 0 0 6px; color: #6647f0; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
    h2 { margin: 0; font-size: 18px; line-height: 1.25; }
    .hint { margin: 8px 0 16px; color: #626779; }
    label:not(.remember) { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 700; }
    input[type="search"] { width: 100%; height: 42px; padding: 0 12px; border: 1px solid #aeb5c8; border-radius: 10px; color: #171721; background: #fff; font: inherit; outline: none; }
    input[type="search"]:focus { border-color: #0091ff; box-shadow: 0 0 0 3px rgba(0,145,255,.18); }
    .results { display: grid; gap: 6px; margin-top: 8px; }
    button { font: inherit; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .55; }
    .result { display: grid; width: 100%; padding: 9px 10px; border: 1px solid #e1e4ec; border-radius: 9px; background: #fff; color: #171721; text-align: left; }
    .result:hover, .result:focus, .result.selected { border-color: #6647f0; background: #f5f2ff; outline: none; }
    .result small { margin-top: 2px; color: #626779; }
    .remember { display: flex; align-items: center; gap: 5px; margin-top: 12px; color: #3f4351; font-size: 12px; }
    .status { min-height: 20px; margin: 10px 0; color: #626779; font-size: 12px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    .actions button { min-height: 38px; padding: 8px 12px; border-radius: 9px; font-weight: 700; }
    .secondary { border: 1px solid #c9cedb; background: #fff; color: #343846; }
    .primary { border: 1px solid #6647f0; background: #6647f0; color: #fff; }
    @media (max-width: 520px) { :host { top: 10px; right: 10px; left: 10px; } .panel { width: 100%; max-height: calc(100vh - 20px); } }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;
