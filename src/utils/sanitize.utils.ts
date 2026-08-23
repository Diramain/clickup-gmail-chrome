/**
 * Sanitization Utilities
 * Treat Gmail/API content as untrusted. These helpers are dependency-free and
 * use the local DOM parser available in extension contexts/tests.
 */

export type SanitizedHTML = string & { readonly __sanitizedHtml: true };

const BLOCKED_ELEMENTS = [
    'script', 'iframe', 'object', 'embed', 'form', 'input', 'button',
    'svg', 'math', 'meta', 'base', 'link', 'style', 'noscript'
];

const SAFE_HTML_ATTRIBUTES = new Set([
    'alt', 'align', 'colspan', 'dir', 'height', 'href', 'lang', 'rowspan',
    'src', 'start', 'style', 'title', 'valign', 'value', 'width',
]);

const CLICKUP_HOSTS = new Set(['app.clickup.com', 'api.clickup.com']);
const SAFE_IMAGE_DATA_URL = /^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i;

export function sanitizeGmailHtml(html: string): SanitizedHTML {
    if (!html) return '' as SanitizedHTML;

    const template = document.createElement('template');
    template.innerHTML = html;

    template.content.querySelectorAll(BLOCKED_ELEMENTS.join(',')).forEach(el => el.remove());

    template.content.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            const value = attr.value || '';

            if (!SAFE_HTML_ATTRIBUTES.has(name)) {
                el.removeAttribute(attr.name);
                return;
            }

            if (name === 'style') {
                const safeStyle = sanitizeCss(value);
                if (safeStyle) el.setAttribute('style', safeStyle);
                else el.removeAttribute('style');
                return;
            }

            if (name === 'href') {
                if (el.tagName.toLowerCase() === 'a' && isSafeEmailLink(value)) {
                    el.setAttribute('target', '_blank');
                    el.setAttribute('rel', 'noopener noreferrer nofollow');
                } else {
                    el.removeAttribute(attr.name);
                }
                return;
            }

            if (name === 'src') {
                if (el.tagName.toLowerCase() === 'img') {
                    if (SAFE_IMAGE_DATA_URL.test(value)) {
                        el.setAttribute('src', value.replace(/\s+/g, ''));
                    } else {
                        el.removeAttribute('src');
                    }
                } else {
                    el.removeAttribute(attr.name);
                }
            }
        });
    });

    return template.innerHTML as SanitizedHTML;
}

export function sanitizeHTML(html: string): string {
    return sanitizeGmailHtml(html);
}

export function wrapSanitizedEmailHtml(html: string, isSanitized: boolean): SanitizedHTML {
    const safeBody = isSanitized ? html : escapeHTML(html || '');
    return (`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><title>Copia sanitizada del email</title></head><body><p style="font:13px sans-serif;color:#555;border:1px solid #ddd;padding:8px;">Copia sanitizada de Gmail. Se eliminaron contenido remoto y elementos activos.</p>${safeBody}</body></html>`) as SanitizedHTML;
}

export function sanitizeCss(css: string): string {
    if (!css) return '';
    if (/url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i.test(css)) return '';
    return css
        .split(';')
        .map(rule => rule.trim())
        .filter(rule => rule && !/[<>]/.test(rule))
        .join('; ');
}

export function isSafeExternalUrl(rawUrl: string, allowedHosts: Set<string> = CLICKUP_HOSTS): boolean {
    if (!rawUrl) return false;
    try {
        const url = new URL(rawUrl, globalThis.location?.origin || 'https://mail.google.com');
        if (url.protocol !== 'https:') return false;
        return allowedHosts.has(url.hostname);
    } catch {
        return false;
    }
}

export function isSafeEmailLink(rawUrl: string): boolean {
    if (!rawUrl) return false;
    try {
        const url = new URL(rawUrl, globalThis.location?.origin || 'https://mail.google.com');
        return url.protocol === 'https:' || url.protocol === 'mailto:';
    } catch {
        return false;
    }
}

export function isSafeEditorLink(rawUrl: string, allowMailto = true): boolean {
    if (!rawUrl) return false;
    try {
        const url = new URL(rawUrl, globalThis.location?.origin || 'https://mail.google.com');
        return url.protocol === 'https:' || (allowMailto && url.protocol === 'mailto:');
    } catch {
        return false;
    }
}

export function safeClickUpUrl(rawUrl: string): string {
    return isSafeExternalUrl(rawUrl, new Set(['app.clickup.com'])) ? rawUrl : 'https://app.clickup.com/';
}

export function safeAvatarUrl(rawUrl: string | null | undefined): string | null {
    if (!rawUrl) return null;
    if (SAFE_IMAGE_DATA_URL.test(rawUrl)) return rawUrl.replace(/\s+/g, '');
    return isSafeExternalUrl(rawUrl, new Set(['app.clickup.com', 'attachments.clickup.com'])) ? rawUrl : null;
}

export function safeColor(color: string | null | undefined, fallback = '#7B68EE'): string {
    if (!color) return fallback;
    return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : fallback;
}

export function setTextContent(element: HTMLElement, text: string): void {
    element.textContent = text ?? '';
}

export function createTextElement(
    tag: keyof HTMLElementTagNameMap,
    text: string,
    className?: string
): HTMLElement {
    const el = document.createElement(tag);
    el.textContent = text ?? '';
    if (className) el.className = className;
    return el;
}

export function escapeHTML(str: string): string {
    if (!str) return '';
    const escapeMap: Record<string, string> = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    };
    return str.replace(/[&<>"']/g, char => escapeMap[char] || char);
}
