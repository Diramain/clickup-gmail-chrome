/**
 * HTML Sanitization Utilities
 * Prevents XSS attacks by sanitizing dynamic HTML content
 */

/**
 * Sanitizes HTML by removing potentially dangerous elements and attributes
 * @param html - The HTML string to sanitize
 * @returns Sanitized HTML string
 */
export function sanitizeHTML(html: string): string {
    if (!html) return '';

    const template = document.createElement('template');
    template.innerHTML = html.trim();

    // Remove dangerous elements
    const dangerousElements = template.content.querySelectorAll(
        'script, iframe, object, embed, form, input, button, style, link, meta, base, noscript'
    );
    dangerousElements.forEach(el => el.remove());

    // Remove dangerous attributes from all elements
    const allElements = template.content.querySelectorAll('*');
    allElements.forEach(el => {
        // Remove event handlers (onclick, onerror, etc.)
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('on') ||
                attr.name === 'href' && attr.value.toLowerCase().startsWith('javascript:') ||
                attr.name === 'src' && attr.value.toLowerCase().startsWith('javascript:') ||
                attr.name === 'action' ||
                attr.name === 'formaction') {
                el.removeAttribute(attr.name);
            }
        });
    });

    return template.innerHTML;
}

/**
 * Safely sets text content, escaping any HTML
 * This is the preferred method for dynamic text that shouldn't contain HTML
 * @param element - The element to set text on
 * @param text - The text to set
 */
export function setTextContent(element: HTMLElement, text: string): void {
    element.textContent = text ?? '';
}

/**
 * Creates an element with text content (no HTML)
 * @param tag - The tag name
 * @param text - The text content
 * @param className - Optional class name
 */
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

/**
 * Escapes HTML special characters in a string
 * Use for inserting user content into HTML strings
 * @param str - The string to escape
 */
export function escapeHTML(str: string): string {
    if (!str) return '';

    const escapeMap: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    return str.replace(/[&<>"']/g, char => escapeMap[char] || char);
}
