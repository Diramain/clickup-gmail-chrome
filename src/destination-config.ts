/**
 * CGC-UX-V2-D2 — Destino predeterminado de workspace y lista.
 *
 * Funciones puras compartidas por la app en pestaña y el background. No tocan
 * DOM, almacenamiento ni red: sólo normalizan y clasifican. Los límites de
 * longitud replican los del saneamiento del background para que ambos lados
 * rechacen exactamente lo mismo.
 */

export const MAX_LIST_ID = 100;
export const MAX_LIST_NAME = 500;
export const MAX_LIST_PATH = 1000;

/** 24 horas, la misma ventana que usa el caché de jerarquía del background. */
export const DESTINATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface DestinationTeam {
    id: string;
    name: string;
}

export interface DestinationList {
    id: string;
    name: string;
    path: string;
}

export interface DestinationSelection {
    listId: string;
    listName?: string;
    path?: string;
}

export interface DestinationOptions {
    teams: DestinationTeam[];
    preferredTeamId: string | null;
    lists: DestinationList[];
    current: DestinationSelection | null;
    cachedAt: number | null;
}

export type DestinationState = 'blocked' | 'empty' | 'idle' | 'ready' | 'stale';

function shortString(value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > max) return undefined;
    return trimmed;
}

export function sanitizeDestinationSelection(value: unknown): DestinationSelection | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const candidate = value as Record<string, unknown>;
    const listId = shortString(candidate.listId, MAX_LIST_ID);
    if (!listId) return null;

    const selection: DestinationSelection = { listId };
    const listName = shortString(candidate.listName, MAX_LIST_NAME);
    if (listName) selection.listName = listName;
    const path = shortString(candidate.path, MAX_LIST_PATH);
    if (path) selection.path = path;

    return selection;
}

function normalizeTeams(value: unknown): DestinationTeam[] {
    if (!Array.isArray(value)) return [];

    const teams: DestinationTeam[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as Record<string, unknown>;
        const id = shortString(candidate.id, MAX_LIST_ID);
        const name = shortString(candidate.name, MAX_LIST_NAME);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        teams.push({ id, name });
    }
    return teams;
}

function normalizeLists(value: unknown): DestinationList[] {
    if (!Array.isArray(value)) return [];

    const lists: DestinationList[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as Record<string, unknown>;
        const id = shortString(candidate.id, MAX_LIST_ID);
        const name = shortString(candidate.name, MAX_LIST_NAME);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        lists.push({
            id,
            name,
            path: shortString(candidate.path, MAX_LIST_PATH) || name,
        });
    }
    return lists;
}

export function resolveAuthorizedDestination(
    requested: unknown,
    authorizedLists: unknown,
): DestinationSelection | null {
    const selection = sanitizeDestinationSelection(requested);
    if (!selection) return null;
    const authorized = normalizeLists(authorizedLists)
        .find((list) => list.id === selection.listId);
    if (!authorized) return null;
    return {
        listId: authorized.id,
        listName: authorized.name,
        path: authorized.path,
    };
}

export function filterDestinationLists(lists: DestinationList[], query: unknown): DestinationList[] {
    if (!Array.isArray(lists)) return [];
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return [...lists];
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    return lists.filter((list) => {
        const haystack = normalizeSearchText(`${list.path} ${list.name}`);
        return tokens.every((token) => haystack.includes(token));
    });
}

function normalizeSearchText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLocaleLowerCase('es');
}

export function normalizeDestinationOptions(raw: unknown): DestinationOptions {
    const source = (raw && typeof raw === 'object' && !Array.isArray(raw))
        ? raw as Record<string, unknown>
        : {};

    const cachedAt = typeof source.cachedAt === 'number' && Number.isFinite(source.cachedAt)
        ? source.cachedAt
        : null;

    return {
        teams: normalizeTeams(source.teams),
        preferredTeamId: shortString(source.preferredTeamId, MAX_LIST_ID) || null,
        lists: normalizeLists(source.lists),
        current: sanitizeDestinationSelection(source.current),
        cachedAt,
    };
}

/**
 * `now` se recibe por parámetro para que la clasificación sea determinista en
 * los tests y no dependa del reloj del proceso.
 */
export function classifyDestinationState(options: DestinationOptions, now: number = Date.now()): DestinationState {
    if (options.teams.length === 0 && options.lists.length === 0) return 'blocked';
    if (options.lists.length === 0) return 'empty';
    if (options.cachedAt !== null && now - options.cachedAt > DESTINATION_CACHE_TTL_MS) return 'stale';
    return options.current ? 'ready' : 'idle';
}

export interface DestinationCopy {
    title: string;
    detail: string;
}

export function describeDestinationState(state: DestinationState, options: DestinationOptions): DestinationCopy {
    switch (state) {
        case 'blocked':
            return {
                title: 'Falta sincronizar',
                detail: 'Todavía no hay espacios ni listas guardados en este navegador. Sincronizá desde Sincronización y volvé a esta pantalla.',
            };
        case 'empty':
            return {
                title: 'Sin listas disponibles',
                detail: 'El workspace en caché no tiene listas accesibles. Revisá permisos o sincronizá de nuevo desde Sincronización.',
            };
        case 'stale':
            return {
                title: 'Caché vencida',
                detail: 'Los datos locales tienen más de un día. Podés elegir igual, pero conviene sincronizar desde Sincronización para ver listas nuevas.',
            };
        case 'ready':
            return {
                title: 'Destino configurado',
                detail: options.current?.path
                    ? `Las tareas rápidas se crean en ${options.current.path}.`
                    : 'Las tareas rápidas usan la lista guardada.',
            };
        case 'idle':
        default:
            return {
                title: 'Elegí un destino',
                detail: 'Seleccioná la lista donde se crearán las tareas rápidas desde Gmail.',
            };
    }
}
