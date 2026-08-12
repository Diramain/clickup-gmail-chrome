export const SAFE_EXPORT_SCHEMA_VERSION = 2;
export const SAFE_BACKUP_RECENT_MS = 15 * 60 * 1000;
export const LAST_SAFE_BACKUP_KEY = 'lastSafeBackupAt';

export interface SafeExportInput {
    emailTaskMappings?: Record<string, unknown>;
    emailTaskMappingsV2?: Record<string, unknown>;
    preferredTeamId?: string;
    threadIdField?: string;
    useCustomFieldForThreadId?: boolean;
    autoStartTimer?: boolean;
    autoStopTimer?: boolean;
}

export interface SafeExportPayload {
    schemaVersion: 2;
    extensionVersion: string;
    exportDate: string;
    counts: {
        emailTaskMappings: number;
        emailTaskMappingsV2: number;
        settings: number;
    };
    data: {
        emailTaskMappings: Record<string, unknown>;
        emailTaskMappingsV2: Record<string, unknown>;
        settings: Record<string, string | boolean>;
    };
    checksumSha256: string | null;
}

const SETTING_KEYS: Array<keyof SafeExportInput> = [
    'preferredTeamId',
    'threadIdField',
    'useCustomFieldForThreadId',
    'autoStartTimer',
    'autoStopTimer',
];

const MAPPING_KEYS = new Set([
    'id',
    'name',
    'url',
    'status',
    'createdAt',
    'updatedAt',
    'lastValidatedAt',
    'linkStatus',
    'linkSource',
    'customFieldId',
    'failureCount',
]);

export async function createSafeExportPayload(
    input: SafeExportInput,
    extensionVersion: string,
    exportDate = new Date().toISOString(),
    checksumFn: (text: string) => Promise<string | null> = sha256HexIfAvailable,
): Promise<SafeExportPayload> {
    const emailTaskMappings = sanitizeMappings(input.emailTaskMappings);
    const emailTaskMappingsV2 = sanitizeMappings(input.emailTaskMappingsV2);
    const settings = buildSafeSettings(input);
    const withoutChecksum = {
        schemaVersion: SAFE_EXPORT_SCHEMA_VERSION as 2,
        extensionVersion,
        exportDate,
        counts: {
            emailTaskMappings: Object.keys(emailTaskMappings).length,
            emailTaskMappingsV2: Object.keys(emailTaskMappingsV2).length,
            settings: Object.keys(settings).length,
        },
        data: {
            emailTaskMappings,
            emailTaskMappingsV2,
            settings,
        },
    };

    return {
        ...withoutChecksum,
        checksumSha256: await checksumFn(stableStringify(withoutChecksum)),
    };
}

export function canClearLocalData(lastSafeBackupAt: unknown, now = Date.now(), confirmation = ''): { ok: boolean; code: string } {
    const backupTime = typeof lastSafeBackupAt === 'number' ? lastSafeBackupAt : Number(lastSafeBackupAt);
    if (!Number.isFinite(backupTime) || now - backupTime > SAFE_BACKUP_RECENT_MS) {
        return { ok: false, code: 'BACKUP_REQUIRED' };
    }
    if (confirmation !== 'BORRAR DATOS' && confirmation !== 'CLEAR DATA') {
        return { ok: false, code: 'CONFIRMATION_REQUIRED' };
    }
    return { ok: true, code: 'OK' };
}

export async function sha256HexIfAvailable(text: string): Promise<string | null> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const data = new TextEncoder().encode(text);
    const digest = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function stableStringify(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

function buildSafeSettings(input: SafeExportInput): Record<string, string | boolean> {
    const settings: Record<string, string | boolean> = {};
    for (const key of SETTING_KEYS) {
        const value = input[key];
        if (typeof value === 'string' && value.length > 0 && value.length <= 300) settings[key] = value;
        if (typeof value === 'boolean') settings[key] = value;
    }
    return settings;
}

function sanitizeMappings(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const safe: Record<string, unknown> = {};
    for (const [threadId, mappings] of Object.entries(value as Record<string, unknown>)) {
        if (typeof threadId !== 'string' || threadId.length === 0 || threadId.length > 200) continue;
        if (!Array.isArray(mappings)) continue;
        safe[threadId] = mappings.slice(0, 100).map((mapping) => sanitizeMapping(mapping)).filter(Boolean);
    }
    return safe;
}

function sanitizeMapping(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const safe: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (!MAPPING_KEYS.has(key)) continue;
        if (typeof nested === 'string') safe[key] = nested.slice(0, 1000);
        if (typeof nested === 'number' && Number.isFinite(nested)) safe[key] = nested;
    }
    return Object.keys(safe).length > 0 ? safe : null;
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>).sort().reduce((acc, key) => {
            acc[key] = sortValue((value as Record<string, unknown>)[key]);
            return acc;
        }, {} as Record<string, unknown>);
    }
    return value;
}
