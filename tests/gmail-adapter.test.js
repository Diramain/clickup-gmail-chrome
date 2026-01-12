/**
 * GmailAdapter Unit Tests
 * Tests for Gmail DOM abstraction layer
 */

// Mock document for DOM testing
const mockDocument = {
    querySelector: jest.fn(),
    querySelectorAll: jest.fn()
};

// GmailAdapter functions extracted for testing
const GmailAdapter = {
    SELECTORS: {
        THREAD_ID: 'h2[data-thread-perm-id], [data-thread-perm-id], [data-legacy-thread-id]',
        SUBJECT: 'h2[data-thread-perm-id], .hP, [role="heading"][aria-level="2"]',
        SENDER_EMAIL: '.gD[email], [email]',
        EMAIL_BODY: '.a3s.aiL, .ii.gt',
        EMAIL_CONTAINER: '.gs, .h7',
    },

    getThreadIdFromElement(element) {
        if (!element) return null;

        // Try different attributes
        const permId = element.getAttribute('data-thread-perm-id');
        if (permId) return permId;

        const legacyId = element.getAttribute('data-legacy-thread-id');
        if (legacyId) return legacyId;

        return null;
    },

    normalizeThreadId(rawId) {
        if (!rawId) return 'email_unknown';

        // Remove URL encoding and special characters
        let normalized = rawId;

        // If it's a Gmail internal format (#msg-f:123), extract the number
        if (normalized.includes('#msg-f:')) {
            const match = normalized.match(/#msg-f:(\d+)/);
            if (match) normalized = match[1];
        }

        // If it starts with 'thread-', extract ID
        if (normalized.startsWith('thread-')) {
            normalized = normalized.replace('thread-', '');
        }

        return `email_${normalized}`;
    },

    extractEmailFromString(str) {
        if (!str) return '';
        const match = str.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        return match ? match[0] : '';
    },

    sanitizeHtml(html) {
        if (!html) return '';

        // Remove script tags
        let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

        // Remove event handlers
        sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');

        return sanitized;
    }
};

// ============================================================================
// Tests
// ============================================================================

describe('GmailAdapter', () => {
    describe('getThreadIdFromElement', () => {
        test('returns thread ID from data-thread-perm-id', () => {
            const element = {
                getAttribute: jest.fn((attr) =>
                    attr === 'data-thread-perm-id' ? '19b95d11476b81db' : null
                )
            };
            expect(GmailAdapter.getThreadIdFromElement(element)).toBe('19b95d11476b81db');
        });

        test('returns legacy thread ID as fallback', () => {
            const element = {
                getAttribute: jest.fn((attr) =>
                    attr === 'data-legacy-thread-id' ? 'legacy123' : null
                )
            };
            expect(GmailAdapter.getThreadIdFromElement(element)).toBe('legacy123');
        });

        test('returns null for element without ID', () => {
            const element = {
                getAttribute: jest.fn(() => null)
            };
            expect(GmailAdapter.getThreadIdFromElement(element)).toBeNull();
        });

        test('returns null for null element', () => {
            expect(GmailAdapter.getThreadIdFromElement(null)).toBeNull();
        });
    });

    describe('normalizeThreadId', () => {
        test('prefixes ID with email_', () => {
            expect(GmailAdapter.normalizeThreadId('19b95d11476b81db')).toBe('email_19b95d11476b81db');
        });

        test('extracts ID from #msg-f: format', () => {
            expect(GmailAdapter.normalizeThreadId('#msg-f:1234567890')).toBe('email_1234567890');
        });

        test('removes thread- prefix', () => {
            expect(GmailAdapter.normalizeThreadId('thread-abc123')).toBe('email_abc123');
        });

        test('returns email_unknown for null', () => {
            expect(GmailAdapter.normalizeThreadId(null)).toBe('email_unknown');
        });

        test('returns email_unknown for empty string', () => {
            expect(GmailAdapter.normalizeThreadId('')).toBe('email_unknown');
        });
    });

    describe('extractEmailFromString', () => {
        test('extracts email from plain string', () => {
            expect(GmailAdapter.extractEmailFromString('user@example.com')).toBe('user@example.com');
        });

        test('extracts email from string with other text', () => {
            expect(GmailAdapter.extractEmailFromString('John Doe <john.doe@company.org>')).toBe('john.doe@company.org');
        });

        test('handles complex email addresses', () => {
            expect(GmailAdapter.extractEmailFromString('Contact test.user+tag@sub.domain.co.uk here')).toBe('test.user+tag@sub.domain.co.uk');
        });

        test('returns empty string for no email', () => {
            expect(GmailAdapter.extractEmailFromString('No email here')).toBe('');
        });

        test('returns empty string for null input', () => {
            expect(GmailAdapter.extractEmailFromString(null)).toBe('');
        });
    });

    describe('sanitizeHtml', () => {
        test('removes script tags', () => {
            const html = '<div>Hello</div><script>alert("xss")</script>';
            expect(GmailAdapter.sanitizeHtml(html)).toBe('<div>Hello</div>');
        });

        test('removes event handlers', () => {
            const html = '<div onclick="alert(1)" onmouseover="hack()">Content</div>';
            const result = GmailAdapter.sanitizeHtml(html);
            expect(result).not.toContain('onclick');
            expect(result).not.toContain('onmouseover');
        });

        test('preserves safe HTML', () => {
            const html = '<div class="safe"><p>Hello World</p></div>';
            expect(GmailAdapter.sanitizeHtml(html)).toBe(html);
        });

        test('returns empty string for null', () => {
            expect(GmailAdapter.sanitizeHtml(null)).toBe('');
        });
    });

    describe('SELECTORS', () => {
        test('has required selectors defined', () => {
            expect(GmailAdapter.SELECTORS.THREAD_ID).toBeDefined();
            expect(GmailAdapter.SELECTORS.SUBJECT).toBeDefined();
            expect(GmailAdapter.SELECTORS.SENDER_EMAIL).toBeDefined();
            expect(GmailAdapter.SELECTORS.EMAIL_BODY).toBeDefined();
        });
    });
});
