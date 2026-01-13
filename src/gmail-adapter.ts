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
    userEmail: string;
}

interface SubjectContainer {
    span: Element | null;
    cell: Element | null;
}

interface IGmailAdapter {
    SELECTORS: GmailSelectors;
    getEmailBodyElement(): Element | null;
    getAllEmailBodies(): NodeListOf<Element>;
    getEmailBodyHtml(): string;
    getSenderEmail(): string;
    getSubject(): string;
    getThreadId(): string;
    getMessageContainer(bodyElement: Element): Element | null;
    getInboxRows(): NodeListOf<Element>;
    getRowLegacyThreadId(row: Element): string | null;
    getSubjectContainer(row: Element): SubjectContainer;
    getAttachmentUrls(): { url: string; filename: string; mimeType: string }[];
    getUserEmail(): string;
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
        attachments: '.ii.gt [download_url], .a3s.aiL [download_url]',

        // User email (for data payload)
        userEmail: '[data-inboxsdk-user-email-address], [data-email]'
    },

    /**
     * Get email body element
     */
    getEmailBodyElement(): Element | null {
        return document.querySelector(this.SELECTORS.emailBody);
    },

    /**
     * Get all email body elements (for multi-message threads)
     */
    getAllEmailBodies(): NodeListOf<Element> {
        return document.querySelectorAll(this.SELECTORS.emailBody);
    },

    /**
     * Get email body HTML content
     */
    getEmailBodyHtml(): string {
        const el = this.getEmailBodyElement();
        return el ? el.innerHTML : '';
    },

    /**
     * Get sender email address
     */
    getSenderEmail(): string {
        const el = document.querySelector(this.SELECTORS.senderWithEmail);
        return el ? el.getAttribute('email') || '' : '';
    },

    /**
     * Get email subject
     */
    getSubject(): string {
        const el = document.querySelector(this.SELECTORS.subjectHeader);
        return el ? el.textContent?.trim() || 'Email Task' : 'Email Task';
    },

    /**
     * Get thread ID - prefers stable legacy/perm IDs
     */
    getThreadId(): string {
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

        // 4. Last resort - generate temporary ID
        return 'email_' + Date.now();
    },

    /**
     * Get message container for an email body
     */
    getMessageContainer(bodyElement: Element): Element | null {
        return bodyElement.closest('.gs') ||
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
    getAttachmentUrls(): { url: string; filename: string; mimeType: string }[] {
        const attachments: { url: string; filename: string; mimeType: string }[] = [];
        const elements = document.querySelectorAll(this.SELECTORS.attachments);
        elements.forEach(el => {
            const downloadUrl = el.getAttribute('download_url');
            if (downloadUrl) {
                // Parse Gmail's download_url format: "mimeType:filename:actualUrl"
                const parts = downloadUrl.split(':');
                if (parts.length >= 3) {
                    const mimeType = parts[0];
                    const filename = parts[1];
                    const url = parts.slice(2).join(':'); // URL may contain ':'
                    attachments.push({ url, filename, mimeType });
                }
            }
        });
        return attachments;
    },

    /**
     * Get current user's email address
     */
    getUserEmail(): string {
        const el = document.querySelector(this.SELECTORS.userEmail);
        if (!el) return '';
        return el.getAttribute('data-inboxsdk-user-email-address') ||
            el.getAttribute('data-email') || '';
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
export type { IGmailAdapter, GmailSelectors, SubjectContainer };

// Make available globally for content scripts
(window as any).GmailAdapter = GmailAdapter;
