export const GMAIL_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const GMAIL_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const GMAIL_ATTACHMENT_MAX_COUNT = 20;
export const GMAIL_INLINE_IMAGE_MIME_TYPE = 'image/*';

const GENERIC_BINARY_MIME = 'application/octet-stream';
const ALLOWED_MIME_TYPES_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = Object.freeze({
    png: ['image/png', GENERIC_BINARY_MIME],
    jpg: ['image/jpeg', GENERIC_BINARY_MIME],
    jpeg: ['image/jpeg', GENERIC_BINARY_MIME],
    gif: ['image/gif', GENERIC_BINARY_MIME],
    webp: ['image/webp', GENERIC_BINARY_MIME],
    pdf: ['application/pdf', GENERIC_BINARY_MIME],
    doc: ['application/msword', GENERIC_BINARY_MIME],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', GENERIC_BINARY_MIME],
    xls: ['application/vnd.ms-excel', GENERIC_BINARY_MIME],
    xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', GENERIC_BINARY_MIME],
    ppt: ['application/vnd.ms-powerpoint', GENERIC_BINARY_MIME],
    pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', GENERIC_BINARY_MIME],
    txt: ['text/plain', GENERIC_BINARY_MIME],
    csv: ['text/csv', 'application/csv', GENERIC_BINARY_MIME],
    zip: ['application/zip', 'application/x-zip-compressed', GENERIC_BINARY_MIME],
    rar: ['application/vnd.rar', 'application/x-rar-compressed', GENERIC_BINARY_MIME],
});

export interface GmailAttachmentMetadata {
    url: string;
    filename: string;
    mimeType: string;
    inline?: true;
}

export function isAllowedGmailInlineImageCandidate(value: unknown): value is GmailAttachmentMetadata & { inline: true } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Partial<GmailAttachmentMetadata>;
    return candidate.inline === true
        && candidate.mimeType === GMAIL_INLINE_IMAGE_MIME_TYPE
        && typeof candidate.filename === 'string'
        && /^imagen-en-el-cuerpo-[1-9][0-9]*$/.test(candidate.filename)
        && isAllowedGmailAttachmentUrl(candidate.url);
}

export function getGmailImageExtension(mimeType: string): string | null {
    const normalized = mimeType.trim().toLowerCase();
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/jpeg') return 'jpg';
    if (normalized === 'image/gif') return 'gif';
    if (normalized === 'image/webp') return 'webp';
    return null;
}

export interface GmailAttachmentUploadPayload {
    taskId: string;
    filename: string;
    mimeType: string;
    byteLength: number;
    base64: string;
}

export function isAllowedGmailAttachmentType(filename: unknown, mimeType: unknown): boolean {
    const extension = getAllowedExtension(filename);
    if (!extension || typeof mimeType !== 'string') return false;
    return ALLOWED_MIME_TYPES_BY_EXTENSION[extension].includes(mimeType.trim().toLowerCase());
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

export function isAllowedGmailAttachmentResponseUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && (url.hostname === 'mail.google.com'
                || url.hostname === 'mail-attachment.googleusercontent.com'
                || /^ci[0-9]+\.googleusercontent\.com$/.test(url.hostname))
            && url.port === ''
            && url.username === ''
            && url.password === '';
    } catch {
        return false;
    }
}

export function isAllowedGmailAttachmentResponseSource(url: unknown, responseType: unknown): boolean {
    if (typeof url === 'string' && url.length > 0) return isAllowedGmailAttachmentResponseUrl(url);
    return url === '' && (responseType === 'basic' || responseType === 'default');
}

export function sanitizeGmailAttachmentFilename(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const filename = value.trim();
    if (!filename || filename.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(filename) || /\.svgz?$/i.test(filename)) return null;
    return filename;
}

export function isValidGmailAttachmentUploadPayload(value: unknown): value is GmailAttachmentUploadPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const payload = value as Partial<GmailAttachmentUploadPayload>;
    if (!isBoundedTaskId(payload.taskId)) return false;
    if (!sanitizeGmailAttachmentFilename(payload.filename)) return false;
    if (!isAllowedGmailAttachmentType(payload.filename, payload.mimeType)) return false;
    if (!Number.isInteger(payload.byteLength) || Number(payload.byteLength) <= 0 || Number(payload.byteLength) > GMAIL_ATTACHMENT_MAX_FILE_BYTES) return false;
    if (typeof payload.base64 !== 'string' || payload.base64.length === 0) return false;
    if (payload.base64.length > Math.ceil(GMAIL_ATTACHMENT_MAX_FILE_BYTES / 3) * 4 + 4) return false;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.base64)) return false;
    return decodedBase64Length(payload.base64) === payload.byteLength;
}

export function decodeAndValidateGmailAttachment(payload: GmailAttachmentUploadPayload): Uint8Array | null {
    if (!isValidGmailAttachmentUploadPayload(payload)) return null;
    try {
        const binary = atob(payload.base64);
        if (binary.length !== payload.byteLength) return null;
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return hasExpectedFileSignature(bytes, payload.filename) ? bytes : null;
    } catch {
        return null;
    }
}

export function hasExpectedFileSignature(bytes: Uint8Array, filename: string): boolean {
    const extension = getAllowedExtension(filename);
    if (!extension) return false;
    if (extension === 'png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (extension === 'jpg' || extension === 'jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]);
    if (extension === 'gif') {
        return startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
            || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    }
    if (extension === 'webp') {
        return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
            && bytes.length >= 12
            && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]);
    }
    if (extension === 'pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    if (extension === 'doc' || extension === 'xls' || extension === 'ppt') {
        return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    }
    if (['docx', 'xlsx', 'pptx', 'zip'].includes(extension)) return hasZipSignature(bytes);
    if (extension === 'rar') {
        return startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
            || startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    }
    return isValidUtf8Text(bytes);
}

function decodedBase64Length(value: string): number {
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return (value.length / 4) * 3 - padding;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function hasZipSignature(bytes: Uint8Array): boolean {
    return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
        || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
        || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);
}

function isValidUtf8Text(bytes: Uint8Array): boolean {
    if (bytes.some(byte => byte === 0)) return false;
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return true;
    } catch {
        return false;
    }
}

function getAllowedExtension(filename: unknown): string | null {
    const sanitized = sanitizeGmailAttachmentFilename(filename);
    if (!sanitized) return null;
    const match = sanitized.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match && ALLOWED_MIME_TYPES_BY_EXTENSION[match[1]] ? match[1] : null;
}

function isBoundedTaskId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}
