export type ClickUpConnectionState =
    | 'unconfigured'
    | 'configured'
    | 'connected-local'
    | 'reauth-required'
    | 'unavailable';

export interface LocalClickUpStatus {
    configured: boolean;
    credentialPresent: boolean;
    requiresReauth: boolean;
}

export interface ClickUpConnectionView {
    state: ClickUpConnectionState;
    label: string;
    detail: string;
}

const VIEWS: Record<ClickUpConnectionState, Omit<ClickUpConnectionView, 'state'>> = {
    unconfigured: {
        label: 'No configurado',
        detail: 'Completá la configuración de ClickUp desde el popup clásico.',
    },
    configured: {
        label: 'Configurado, sin conexión',
        detail: 'La configuración local existe, pero no hay una credencial activa.',
    },
    'connected-local': {
        label: 'Conexión local detectada',
        detail: 'Hay una credencial cifrada. Esta vista no realizó ninguna validación por red.',
    },
    'reauth-required': {
        label: 'Requiere reconexión',
        detail: 'La sesión local fue marcada para reconectar desde el popup clásico.',
    },
    unavailable: {
        label: 'Estado no disponible',
        detail: 'No se pudo leer el estado local. El popup clásico permanece disponible.',
    },
};

function isLocalClickUpStatus(value: unknown): value is LocalClickUpStatus {
    if (!value || typeof value !== 'object') return false;
    const status = value as Record<string, unknown>;
    return typeof status.configured === 'boolean'
        && typeof status.credentialPresent === 'boolean'
        && typeof status.requiresReauth === 'boolean';
}

export function classifyLocalClickUpStatus(value: unknown): ClickUpConnectionView {
    let state: ClickUpConnectionState;
    if (!isLocalClickUpStatus(value)) state = 'unavailable';
    else if (value.requiresReauth) state = 'reauth-required';
    else if (value.credentialPresent) state = 'connected-local';
    else if (value.configured) state = 'configured';
    else state = 'unconfigured';
    return { state, ...VIEWS[state] };
}
