export type SyncProgressScope = 'hierarchy' | 'email';
export type SyncProgressPhase = 'starting' | 'fetching' | 'processing' | 'complete' | 'error';

export interface SyncProgressMessage {
    action: 'syncProgress';
    scope: SyncProgressScope;
    phase: SyncProgressPhase;
    current?: number;
    total?: number;
    processed?: number;
    found?: number;
    listCount?: number;
}

const ALLOWED_KEYS = new Set([
    'action',
    'scope',
    'phase',
    'current',
    'total',
    'processed',
    'found',
    'listCount',
]);

const MAX_SAFE_COUNTER = 1_000_000;

function isSafeCounter(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SAFE_COUNTER;
}

export function isSyncProgressMessage(value: unknown): value is SyncProgressMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const message = value as Record<string, unknown>;
    if (Object.keys(message).some(key => !ALLOWED_KEYS.has(key))) return false;
    if (message.action !== 'syncProgress') return false;
    if (message.scope !== 'hierarchy' && message.scope !== 'email') return false;
    if (!['starting', 'fetching', 'processing', 'complete', 'error'].includes(String(message.phase))) return false;

    return ['current', 'total', 'processed', 'found', 'listCount']
        .every(key => message[key] === undefined || isSafeCounter(message[key]));
}

function fraction(current?: number, total?: number): string {
    return current !== undefined && total !== undefined ? `${current}/${total}` : '';
}

export function formatSyncProgress(message: SyncProgressMessage): string {
    if (message.scope === 'hierarchy') {
        switch (message.phase) {
            case 'starting':
                return 'Iniciando sincronización de espacios y listas…';
            case 'fetching':
                return `${message.total ?? 0} espacios encontrados; preparando listas…`;
            case 'processing':
                return `Espacio ${fraction(message.current, message.total)} · ${message.listCount ?? 0} listas encontradas`;
            case 'complete':
                return `Sincronización terminada · ${message.listCount ?? 0} listas`;
            case 'error':
                return 'La sincronización de listas no pudo completarse';
        }
    }

    switch (message.phase) {
        case 'starting':
            return 'Iniciando sincronización de tareas de email…';
        case 'fetching':
            return `Página ${message.current ?? 0} consultada · ${message.processed ?? 0} tareas recibidas`;
        case 'processing':
            return `${fraction(message.current, message.total)} tareas revisadas · ${message.found ?? 0} vinculadas`;
        case 'complete':
            return `Sincronización terminada · ${message.found ?? 0} tareas vinculadas`;
        case 'error':
            return 'La sincronización de tareas no pudo completarse';
    }
}
