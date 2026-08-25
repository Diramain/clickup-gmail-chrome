/**
 * Gmail DOM Adapter
 * Centralizes all Gmail DOM selectors and queries
 * 
 * When Gmail changes its DOM structure, only update selectors here.
 */

interface GmailSelectors {
    emailBody: string;
    emailBodyContainer: string;
    senderWithEmail: string;
    subjectHeader: string;
    legacyThreadId: string;
    threadPermId: string;
    threadId: string;
    messageId: string;
    legacyMessageId: string;
    inboxRow: string;
    subjectSpan: string;
    subjectCell: string;
    mainView: string;
    attachments: string;
}

interface SubjectContainer {
    span: Element | null;
    cell: Element | null;
}

interface GmailAttachmentInfo {
    url: string;
    filename: string;
    mimeType: string;
    inline?: true;
}

interface IGmailAdapter {
    SELECTORS: GmailSelectors;
    getEmailBodyElement(): Element | null;
    getAllEmailBodies(): Element[];
    getEmailBodyHtml(bodyElement?: Element | null): string;
    getSenderEmail(scope?: Element | null): string;
    getSubject(): string;
    getThreadId(): string | null;
    getMessageContainer(bodyElement: Element): Element | null;
    getInboxRows(): NodeListOf<Element>;
    getRowLegacyThreadId(row: Element): string | null;
    getSubjectContainer(row: Element): SubjectContainer;
    getAttachmentUrls(scope?: Element | null, bodyElement?: Element | null): GmailAttachmentInfo[];
    getInlineImageUrls(bodyElement: Element): GmailAttachmentInfo[];
    isViewingEmail(): boolean;
    isViewingInbox(): boolean;
}

const GmailAdapter: IGmailAdapter = {
    /**
     * Gmail DOM Selectors
     * Update these when Gmail changes its HTML structure
     */
    SELECTORS: {
        // Email content
        emailBody: '.a3s.aiL, .ii.gt',
        emailBodyContainer: '.gs, .h7',

        // Sender info
        senderWithEmail: '.gD[email]',

        // Subject
        subjectHeader: 'h2[data-thread-perm-id], .hP',

        // Thread IDs
        legacyThreadId: '[data-legacy-thread-id]',
        threadPermId: '[data-thread-perm-id]',
        threadId: '[data-thread-id]',
        messageId: '[data-message-id]',
        legacyMessageId: '[data-legacy-message-id]',

        // Inbox list
        inboxRow: 'tr.zA',
        subjectSpan: '.bqe, .bog span, .y6 span',
        subjectCell: 'td.xY, td.a4W',

        // Main view
        mainView: 'div[role="main"]',

        // Attachments
        attachments: '.ii.gt [download_url], .a3s.aiL [download_url]'
    },

    /**
     * Get email body element
     */
    getEmailBodyElement(): Element | null {
        return this.getAllEmailBodies()[0] || null;
    },

    /**
     * Get all email body elements (for multi-message threads)
     */
    getAllEmailBodies(): Element[] {
        const primary = Array.from(document.querySelectorAll('.a3s.aiL'))
            .filter((el) => el.isConnected);
        const fallback = Array.from(document.querySelectorAll('.ii.gt'))
            .filter((el) => el.isConnected)
            .filter((el) => !el.querySelector('.a3s.aiL'))
            .filter((el) => !primary.some((body) => el.contains(body) || body.contains(el)));

        return [...primary, ...fallback].filter((el, index, all) => all.indexOf(el) === index);
    },

    /**
     * Get email body HTML content
     */
    getEmailBodyHtml(bodyElement?: Element | null): string {
        const el = bodyElement || this.getEmailBodyElement();
        return el ? el.innerHTML : '';
    },

    /**
     * Get sender email address
     */
    getSenderEmail(scope?: Element | null): string {
        const el = scope
            ? scope.querySelector(this.SELECTORS.senderWithEmail)
            : document.querySelector(this.SELECTORS.senderWithEmail);
        return el ? el.getAttribute('email') || '' : '';
    },

    /**
     * Get email subject
     */
    getSubject(): string {
        const el = document.querySelector(this.SELECTORS.subjectHeader);
        return el ? el.textContent?.trim() || 'Tarea desde email' : 'Tarea desde email';
    },

    /**
     * Get thread ID - prefers stable legacy/perm IDs
     */
    getThreadId(): string | null {
        // Strategy: Use legacy hex ID for consistent task matching

        // 1. Try URL hash first (most reliable)
        const hash = window.location.hash;
        const urlMatch = hash.match(/\/([a-f0-9]{16,})$/);
        if (urlMatch) {
            return urlMatch[1];
        }

        // 2. Look for legacy ID in main view (avoid hidden elements)
        const mainView = document.querySelector(this.SELECTORS.mainView);
        const legacyEl = mainView
            ? mainView.querySelector(this.SELECTORS.legacyThreadId)
            : document.querySelector(this.SELECTORS.legacyThreadId);

        if (legacyEl) {
            const id = legacyEl.getAttribute('data-legacy-thread-id');
            if (id) return id;
        }

        // 3. Fallback to other thread attributes
        const threadElement = document.querySelector(
            `${this.SELECTORS.threadPermId}, ${this.SELECTORS.threadId}`
        );
        if (threadElement) {
            const id = threadElement.getAttribute('data-thread-perm-id') ||
                threadElement.getAttribute('data-thread-id');
            if (id) return id;
        }

        return null;
    },

    /**
     * Get message container for an email body
     */
    getMessageContainer(bodyElement: Element): Element | null {
        return bodyElement.closest('.adn') ||
            bodyElement.closest('.gs') ||
            bodyElement.closest('.h7') ||
            bodyElement.parentElement;
    },

    /**
     * Get all inbox row elements
     */
    getInboxRows(): NodeListOf<Element> {
        return document.querySelectorAll(this.SELECTORS.inboxRow);
    },

    /**
     * Get legacy thread ID from an inbox row
     */
    getRowLegacyThreadId(row: Element): string | null {
        const el = row.querySelector(this.SELECTORS.legacyThreadId);
        return el ? el.getAttribute('data-legacy-thread-id') : null;
    },

    /**
     * Get subject container for badge insertion
     */
    getSubjectContainer(row: Element): SubjectContainer {
        return {
            span: row.querySelector(this.SELECTORS.subjectSpan),
            cell: row.querySelector(this.SELECTORS.subjectCell)
        };
    },

    /**
     * Get attachments info from email
     * Gmail download_url format: "mimeType:filename:actualUrl"
     */
    getAttachmentUrls(scope?: Element | null, bodyElement?: Element | null): { url: string; filename: string; mimeType: string }[] {
        const attachments: { url: string; filename: string; mimeType: string }[] = [];
        const attachmentSelector = '[download_url], a[href*="view=att"]';
        const scopedElements = Array.from((scope || document).querySelectorAll(attachmentSelector));
        const bodies = bodyElement ? this.getAllEmailBodies() : [];
        const assignedElements = bodyElement ? Array.from(document.querySelectorAll(attachmentSelector)).filter(element => {
            const precedingBodies = bodies.filter(body =>
                Boolean(body.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
            );
            return precedingBodies[precedingBodies.length - 1] === bodyElement;
        }) : [];
        const elements = [...new Set([...scopedElements, ...assignedElements])];
        elements.forEach(el => {
            const downloadUrl = el.getAttribute('download_url');
            if (downloadUrl) {
                // Parse Gmail's download_url format: "mimeType:filename:actualUrl"
                const firstSeparator = downloadUrl.indexOf(':');
                const secondSeparator = downloadUrl.indexOf(':', firstSeparator + 1);
                if (firstSeparator > 0 && secondSeparator > firstSeparator + 1) {
                    const mimeType = downloadUrl.slice(0, firstSeparator).trim().toLowerCase();
                    const filename = downloadUrl.slice(firstSeparator + 1, secondSeparator).trim();
                    const rawUrl = downloadUrl.slice(secondSeparator + 1);
                    let url = rawUrl;
                    try { url = new URL(rawUrl, window.location.origin).href; } catch { /* rejected by the caller */ }
                    attachments.push({ url, filename, mimeType });
                }
            } else if (el.matches('a[href*="view=att"]') && !el.closest('[download_url]')) {
                const rawUrl = el.getAttribute('href');
                const filename = el.closest('.aZo')?.querySelector('.aV3')?.textContent?.trim();
                if (rawUrl && filename) {
                    let url = rawUrl;
                    try { url = new URL(rawUrl, window.location.origin).href; } catch { /* rejected by the caller */ }
                    attachments.push({ url, filename, mimeType: 'application/octet-stream' });
                }
            }
        });
        return attachments.filter((attachment, index, all) => all.findIndex(candidate =>
            candidate.url === attachment.url && candidate.filename === attachment.filename
        ) === index);
    },

    getInlineImageUrls(bodyElement: Element): GmailAttachmentInfo[] {
        const seen = new Set<string>();
        const images: GmailAttachmentInfo[] = [];
        bodyElement.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
            const width = Number(image.getAttribute('width'));
            const height = Number(image.getAttribute('height'));
            if (width > 0 && width <= 2 && height > 0 && height <= 2) return;
            try {
                const url = new URL(image.getAttribute('src') || '', window.location.origin);
                if (url.protocol !== 'https:' || url.hostname !== 'mail.google.com' || url.port || url.username || url.password || seen.has(url.href)) return;
                seen.add(url.href);
                images.push({
                    url: url.href,
                    filename: `imagen-en-el-cuerpo-${images.length + 1}`,
                    mimeType: 'image/*',
                    inline: true,
                });
            } catch {
                // Ignore malformed and non-HTTP image sources.
            }
        });
        return images;
    },

    /**
     * Check if currently viewing an email (vs inbox list)
     */
    isViewingEmail(): boolean {
        return !!document.querySelector(this.SELECTORS.emailBody);
    },

    /**
     * Check if currently viewing inbox list
     */
    isViewingInbox(): boolean {
        return document.querySelectorAll(this.SELECTORS.inboxRow).length > 0;
    }
};

// Export for module usage
export { GmailAdapter };
export type { GmailAttachmentInfo, IGmailAdapter, GmailSelectors, SubjectContainer };

// Make available globally for content scripts
(window as any).GmailAdapter = GmailAdapter;
