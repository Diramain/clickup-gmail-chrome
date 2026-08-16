export interface DigestProvider {
    sha256Hex(input: string): Promise<string>;
}

export const webCryptoDigestProvider: DigestProvider = {
    async sha256Hex(input: string): Promise<string> {
        if (!globalThis.crypto?.subtle) throw new Error('WEB_CRYPTO_UNAVAILABLE');
        const bytes = new TextEncoder().encode(input);
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    },
};

export function normalizeUuidV4(value: string): string {
    const normalized = value.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
        throw new Error('INVALID_UUID_V4');
    }
    return normalized;
}

export function createCalendarEventId(cgcLinkId: string): string {
    const uuid = normalizeUuidV4(cgcLinkId).replace(/-/g, '');
    return `cgc${uuid}`;
}

export function isValidCalendarEventId(value: unknown): value is string {
    return typeof value === 'string' && /^cgc[0-9a-f]{32}$/.test(value);
}

export async function createConferenceRequestId(cgcLinkId: string, digest: DigestProvider = webCryptoDigestProvider): Promise<string> {
    normalizeUuidV4(cgcLinkId);
    return (await digest.sha256Hex(`cgc-conference-v1:${cgcLinkId}`)).slice(0, 64);
}

export async function createOccurrenceLinkId(input: {
    cgcSeriesLinkId: string;
    recurringEventId: string;
    originalStartTime: string;
}, digest: DigestProvider = webCryptoDigestProvider): Promise<string> {
    normalizeUuidV4(input.cgcSeriesLinkId);
    if (!isBoundedOpaqueId(input.recurringEventId) || !isIsoLike(input.originalStartTime)) throw new Error('INVALID_OCCURRENCE_IDENTITY');
    return `occ_${(await digest.sha256Hex(`cgc-occurrence-v1:${input.cgcSeriesLinkId}:${input.recurringEventId}:${input.originalStartTime}`)).slice(0, 48)}`;
}

function isBoundedOpaqueId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s/?#]/.test(value);
}

function isIsoLike(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}
