export const GMAIL_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const GMAIL_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const GMAIL_ATTACHMENT_MAX_COUNT = 20;
export const GMAIL_IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const);

export type GmailImageMimeType = typeof GMAIL_IMAGE_MIME_TYPES[number];

export interface GmailAttachmentMetadata {
    url: string;
    filename: string;
    mimeType: string;
}

export interface GmailImageUploadPayload {
    taskId: string;
    filename: string;
    mimeType: GmailImageMimeType;
    byteLength: number;
    base64: string;
}

export function isAllowedGmailImageMimeType(value: unknown): value is GmailImageMimeType {
    return typeof value === 'string' && (GMAIL_IMAGE_MIME_TYPES as readonly string[]).includes(value.toLowerCase());
}

export function isAllowedGmailAttachmentUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.hostname === 'mail.google.com'
            && url.port === ''
            && url.username === ''
            && url.password === '';
    } catch {
        return false;
    }
}

export function sanitizeGmailAttachmentFilename(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const filename = value.trim();
    if (!filename || filename.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(filename) || /\.svgz?$/i.test(filename)) return null;
    return filename;
}

export function isValidGmailImageUploadPayload(value: unknown): value is GmailImageUploadPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const payload = value as Partial<GmailImageUploadPayload>;
    if (!isBoundedTaskId(payload.taskId)) return false;
    if (!sanitizeGmailAttachmentFilename(payload.filename)) return false;
    if (!isAllowedGmailImageMimeType(payload.mimeType)) return false;
    if (!Number.isInteger(payload.byteLength) || Number(payload.byteLength) <= 0 || Number(payload.byteLength) > GMAIL_ATTACHMENT_MAX_FILE_BYTES) return false;
    if (typeof payload.base64 !== 'string' || payload.base64.length === 0) return false;
    if (payload.base64.length > Math.ceil(GMAIL_ATTACHMENT_MAX_FILE_BYTES / 3) * 4 + 4) return false;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.base64)) return false;
    return decodedBase64Length(payload.base64) === payload.byteLength;
}

export function decodeAndValidateGmailImage(payload: GmailImageUploadPayload): Uint8Array | null {
    if (!isValidGmailImageUploadPayload(payload)) return null;
    try {
        const binary = atob(payload.base64);
        if (binary.length !== payload.byteLength) return null;
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return hasExpectedImageSignature(bytes, payload.mimeType) ? bytes : null;
    } catch {
        return null;
    }
}

export function hasExpectedImageSignature(bytes: Uint8Array, mimeType: GmailImageMimeType): boolean {
    if (mimeType === 'image/png') {
        return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    if (mimeType === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]);
    if (mimeType === 'image/gif') {
        return startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
            || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    }
    return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
        && bytes.length >= 12
        && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]);
}

function decodedBase64Length(value: string): number {
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return (value.length / 4) * 3 - padding;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function isBoundedTaskId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}
