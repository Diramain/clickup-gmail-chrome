export type UiLanguage = 'es' | 'en';

export const UI_LANGUAGE_STORAGE_KEY = 'taskbridgeUiLanguageV1';

const es = {
    'language.label': 'Idioma',
    'language.spanish': 'Español',
    'language.english': 'English',
    'auth.required': 'Conexión requerida',
    'auth.setupTitle': 'Conectá ClickUp desde esta pestaña.',
    'auth.setupDetail': 'La configuración completa ya no vive en el popup.',
    'auth.quick': 'Conexión rápida',
    'auth.tokenDetail': 'Usá tu token personal de ClickUp. Se valida antes de guardarse y queda cifrado sólo en este perfil del navegador.',
    'auth.tokenLabel': 'Token personal de ClickUp',
    'auth.connect': 'Conectar con token personal',
    'auth.credentialNote': 'No se guarda mientras escribís, nunca vuelve a mostrarse y no se incluye en exports ni diagnósticos.',
    'auth.openTokens': 'Abrir Tokens de API en ClickUp',
    'auth.connected': 'ClickUp conectado',
    'auth.disconnected': 'Sin conexión',
    'auth.unavailable': 'No disponible',
    'auth.validating': 'Validando…',
    'auth.validatingDetail': 'Validando el token con ClickUp…',
    'auth.invalidToken': 'Pegá un token personal válido que empiece con pk_.',
    'auth.reconnect': 'El token dejó de ser válido. Pegá un token personal nuevo para reconectar.',
    'auth.connectionUnavailable': 'ClickUp no está disponible para validar el token. Reintentá más tarde.',
    'calendar.title': 'Google Calendar',
    'calendar.development': 'En desarrollo',
    'calendar.developmentDetail': 'Google Calendar está en desarrollo y todavía no está disponible.',
    'calendar.button': 'Próximamente',
    'calendar.optional': 'Integración futura',
    'calendar.readOnly': 'Próximos eventos del calendario principal en modo lectura.',
    'minimal.quickAccess': 'Acceso rápido',
    'minimal.loading': 'Leyendo…',
    'minimal.timer': 'TEMPORIZADOR',
    'minimal.noTimer': 'Sin temporizador activo',
    'minimal.stopped': 'Detenido',
    'minimal.noPrevious': 'Todavía no hay una tarea anterior para retomar.',
    'minimal.autoTracking': 'SEGUIMIENTO AUTOMÁTICO',
    'minimal.quickPreferences': 'Preferencias rápidas',
    'minimal.autoStart': 'Iniciar al enfocar',
    'minimal.autoStop': 'Detener al cambiar/cerrar',
    'minimal.openApp': 'Abrir app completa',
    'minimal.inProgress': 'En curso',
    'minimal.lastTask': 'Última tarea: {name}',
    'minimal.activeTimer': 'Temporizador activo',
    'minimal.trackingSaved': 'Preferencia de seguimiento guardada.',
    'minimal.trackingSaveFailed': 'No se pudo guardar la preferencia.',
    'minimal.configureClickUp': 'Configurá ClickUp desde la app completa.',
    'minimal.replaceToken': 'Reemplazá el token personal desde la app completa.',
    'minimal.workspaceRequired': 'Elegí un workspace desde la app completa antes de iniciar un timer.',
    'meet.linkCurrent': 'Vincular reunión en curso',
    'meet.checking': 'Consultando sesión Meet…',
    'meet.existingTask': 'Tarea para esta Meet',
    'meet.searchTask': 'Buscar por nombre o ID…',
    'meet.remember': 'Recordar para esta sala',
    'meet.linkAndTrack': 'Vincular e iniciar tracking',
    'meet.orCreate': 'o crear una tarea nueva',
    'meet.titleLabel': 'Título',
    'meet.titlePlaceholder': 'Nombre de la Meet',
    'meet.asSubtask': 'Crear como subtarea',
    'meet.parentTask': 'Tarea padre',
    'meet.searchParent': 'Buscar tarea padre…',
    'meet.loadingConfig': 'Leyendo destino y tipo configurados…',
    'meet.createAndTrack': 'Crear, vincular e iniciar tracking',
    'meet.changeTask': 'Cambiar tarea vinculada',
    'meet.privacy': 'Sólo usa la señal local y el título visible de una Meet confirmada. No lee audio, video, chat, captions ni participantes.',
    'meet.disabled': 'Prioridad Meet desactivada.',
    'meet.idle': 'No hay una Meet activa confirmada.',
    'meet.choose': 'Meet activa: elegí o creá una tarea para iniciar tracking.',
    'meet.conflict': 'Hay varias salas; usá la Meet enfocada.',
    'meet.tracking': 'Meet priorizada · tarea {task}',
    'meet.paused': 'Meet pausada · tarea {task}',
    'meet.ignored': 'Esta Meet fue ignorada.',
    'meet.searching': 'Buscando…',
    'meet.noTasks': 'No se encontraron tareas.',
    'meet.searchFailed': 'No se pudo buscar.',
    'meet.destinationType': 'Destino: {destination} · Tipo: {type}',
    'meet.configurationRequired': 'Configurá un destino y un tipo de tarea para reuniones desde la app completa.',
    'meet.configurationFailed': 'No se pudo leer la configuración de creación.',
    'meet.searchingParent': 'Buscando tarea padre…',
    'meet.noParents': 'No se encontraron tareas padre.',
    'meet.parentSearchFailed': 'No se pudo buscar la tarea padre.',
    'meet.creating': 'Creando y vinculando la tarea de Meet…',
    'meet.created': 'Tarea creada, Meet vinculada y tracking iniciado.',
    'meet.createdMappingFailed': 'Tarea creada y tracking iniciado; no se pudo recordar la sala.',
    'meet.createFailed': 'No se pudo crear la tarea. Revisá destino, tipo y sesión Meet.',
    'route.home': 'Inicio',
    'route.gmail': 'Integración con Gmail',
    'route.time': 'Jornada y tiempo',
    'route.meet': 'Calendar y Meet',
    'route.sync': 'Sincronización',
    'route.connection': 'Conexión',
    'route.data': 'Datos y diagnóstico',
} as const;

export type TranslationKey = keyof typeof es;

const en: Record<TranslationKey, string> = {
    'language.label': 'Language',
    'language.spanish': 'Español',
    'language.english': 'English',
    'auth.required': 'Connection required',
    'auth.setupTitle': 'Connect ClickUp from this tab.',
    'auth.setupDetail': 'Full setup is no longer handled in the popup.',
    'auth.quick': 'Quick connection',
    'auth.tokenDetail': 'Use your ClickUp personal token. It is validated before storage and encrypted only in this browser profile.',
    'auth.tokenLabel': 'ClickUp personal token',
    'auth.connect': 'Connect with personal token',
    'auth.credentialNote': 'It is not stored while you type, is never displayed again, and is excluded from exports and diagnostics.',
    'auth.openTokens': 'Open API Tokens in ClickUp',
    'auth.connected': 'ClickUp connected',
    'auth.disconnected': 'Not connected',
    'auth.unavailable': 'Unavailable',
    'auth.validating': 'Validating…',
    'auth.validatingDetail': 'Validating the token with ClickUp…',
    'auth.invalidToken': 'Paste a valid personal token beginning with pk_.',
    'auth.reconnect': 'The token is no longer valid. Paste a new personal token to reconnect.',
    'auth.connectionUnavailable': 'ClickUp is unavailable for token validation. Try again later.',
    'calendar.title': 'Google Calendar',
    'calendar.development': 'In development',
    'calendar.developmentDetail': 'Google Calendar is in development and is not available yet.',
    'calendar.button': 'Coming soon',
    'calendar.optional': 'Future integration',
    'calendar.readOnly': 'Read-only upcoming events from the primary calendar.',
    'minimal.quickAccess': 'Quick access',
    'minimal.loading': 'Loading…',
    'minimal.timer': 'TIMER',
    'minimal.noTimer': 'No active timer',
    'minimal.stopped': 'Stopped',
    'minimal.noPrevious': 'There is no previous task to resume yet.',
    'minimal.autoTracking': 'AUTOMATIC TRACKING',
    'minimal.quickPreferences': 'Quick preferences',
    'minimal.autoStart': 'Start on focus',
    'minimal.autoStop': 'Stop on switch/close',
    'minimal.openApp': 'Open full app',
    'minimal.inProgress': 'Running',
    'minimal.lastTask': 'Last task: {name}',
    'minimal.activeTimer': 'Active timer',
    'minimal.trackingSaved': 'Tracking preference saved.',
    'minimal.trackingSaveFailed': 'The preference could not be saved.',
    'minimal.configureClickUp': 'Configure ClickUp from the full app.',
    'minimal.replaceToken': 'Replace the personal token from the full app.',
    'minimal.workspaceRequired': 'Choose a workspace from the full app before starting a timer.',
    'meet.linkCurrent': 'Link current meeting',
    'meet.checking': 'Checking Meet session…',
    'meet.existingTask': 'Task for this Meet',
    'meet.searchTask': 'Search by name or ID…',
    'meet.remember': 'Remember for this room',
    'meet.linkAndTrack': 'Link and start tracking',
    'meet.orCreate': 'or create a new task',
    'meet.titleLabel': 'Title',
    'meet.titlePlaceholder': 'Meet name',
    'meet.asSubtask': 'Create as subtask',
    'meet.parentTask': 'Parent task',
    'meet.searchParent': 'Search parent task…',
    'meet.loadingConfig': 'Loading configured destination and task type…',
    'meet.createAndTrack': 'Create, link, and start tracking',
    'meet.changeTask': 'Change linked task',
    'meet.privacy': 'Uses only the local signal and visible title of a confirmed Meet. It does not read audio, video, chat, captions, or participants.',
    'meet.disabled': 'Meet priority is disabled.',
    'meet.idle': 'There is no confirmed active Meet.',
    'meet.choose': 'Active Meet: choose or create a task to start tracking.',
    'meet.conflict': 'Multiple rooms are open; use the focused Meet.',
    'meet.tracking': 'Meet prioritized · task {task}',
    'meet.paused': 'Meet paused · task {task}',
    'meet.ignored': 'This Meet was ignored.',
    'meet.searching': 'Searching…',
    'meet.noTasks': 'No tasks found.',
    'meet.searchFailed': 'Search failed.',
    'meet.destinationType': 'Destination: {destination} · Type: {type}',
    'meet.configurationRequired': 'Configure a destination and meeting task type from the full app.',
    'meet.configurationFailed': 'The creation settings could not be loaded.',
    'meet.searchingParent': 'Searching parent task…',
    'meet.noParents': 'No parent tasks found.',
    'meet.parentSearchFailed': 'The parent task search failed.',
    'meet.creating': 'Creating and linking the Meet task…',
    'meet.created': 'Task created, Meet linked, and tracking started.',
    'meet.createdMappingFailed': 'Task created and tracking started; the room could not be remembered.',
    'meet.createFailed': 'The task could not be created. Check the destination, type, and Meet session.',
    'route.home': 'Home',
    'route.gmail': 'Gmail integration',
    'route.time': 'Workday and time',
    'route.meet': 'Calendar and Meet',
    'route.sync': 'Synchronization',
    'route.connection': 'Connection',
    'route.data': 'Data and diagnostics',
};

const catalogs: Record<UiLanguage, Record<TranslationKey, string>> = { es, en };
let activeLanguage: UiLanguage = 'es';

export function normalizeUiLanguage(value: unknown): UiLanguage {
    return value === 'en' ? 'en' : 'es';
}

export function getActiveLanguage(): UiLanguage {
    return activeLanguage;
}

export function setActiveLanguage(value: unknown): UiLanguage {
    activeLanguage = normalizeUiLanguage(value);
    return activeLanguage;
}

export function t(key: TranslationKey, variables: Record<string, string | number> = {}): string {
    return Object.entries(variables).reduce(
        (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
        catalogs[activeLanguage][key],
    );
}

export function translateDocument(root: Document = document): void {
    root.documentElement.lang = activeLanguage;
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
        const key = element.dataset.i18n as TranslationKey;
        if (catalogs[activeLanguage][key]) element.textContent = t(key);
    });
    for (const [attribute, datasetKey] of [
        ['placeholder', 'i18nPlaceholder'],
        ['title', 'i18nTitle'],
        ['aria-label', 'i18nAriaLabel'],
    ] as const) {
        root.querySelectorAll<HTMLElement>(`[data-${datasetKey.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`).forEach((element) => {
            const key = element.dataset[datasetKey] as TranslationKey;
            if (catalogs[activeLanguage][key]) element.setAttribute(attribute, t(key));
        });
    }
}

export async function initLocalization(root: Document = document): Promise<UiLanguage> {
    try {
        const result = await chrome.runtime.sendMessage({ action: 'getUiLanguage' }) as { language?: unknown };
        setActiveLanguage(result?.language);
    } catch {
        setActiveLanguage('es');
    }
    translateDocument(root);
    return activeLanguage;
}

export function bindLanguageSelectors(root: Document = document): void {
    const selectors = Array.from(root.querySelectorAll<HTMLSelectElement>('[data-language-selector]'));
    const sync = (): void => selectors.forEach((selector) => { selector.value = activeLanguage; });
    sync();
    for (const selector of selectors) {
        selector.addEventListener('change', async () => {
            const previous = activeLanguage;
            const requested = normalizeUiLanguage(selector.value);
            selector.disabled = true;
            try {
                const result = await chrome.runtime.sendMessage({ action: 'setUiLanguage', data: { language: requested } }) as { language?: unknown };
                setActiveLanguage(result?.language);
                translateDocument(root);
                sync();
                root.dispatchEvent(new CustomEvent('taskbridge-language-changed', { detail: { language: activeLanguage } }));
            } catch {
                setActiveLanguage(previous);
                sync();
            } finally {
                selector.disabled = false;
            }
        });
    }
}
