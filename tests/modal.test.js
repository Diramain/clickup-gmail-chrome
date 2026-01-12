/**
 * Modal Unit Tests
 * Tests for TaskModal component
 */

const { mockStorage } = require('./setup');

// ============================================================================
// Modal helper functions extracted for testing
// ============================================================================

function parseTime(timeStr) {
    if (!timeStr) return null;

    let totalMs = 0;
    const hours = timeStr.match(/(\d+)\s*h/i);
    const minutes = timeStr.match(/(\d+)\s*m/i);

    if (hours) totalMs += parseInt(hours[1]) * 60 * 60 * 1000;
    if (minutes) totalMs += parseInt(minutes[1]) * 60 * 1000;

    // Default: if just a number without h/m, treat as HOURS
    if (!hours && !minutes) {
        const num = parseFloat(timeStr);
        if (!isNaN(num)) totalMs = num * 60 * 60 * 1000;
    }

    return totalMs > 0 ? totalMs : null;
}

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return String(text).replace(/[&<>"']/g, char => map[char]);
}

function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return escapeHtml(text).replace(regex, '<strong>$1</strong>');
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTaskId(input) {
    if (!input) return null;

    // Handle ClickUp URLs
    const urlMatch = input.match(/clickup\.com\/t\/([a-zA-Z0-9]+)/);
    if (urlMatch) return urlMatch[1];

    // Handle task ID format
    if (/^[a-zA-Z0-9]{6,12}$/.test(input.trim())) {
        return input.trim();
    }

    // Handle #taskid format
    const hashMatch = input.match(/^#([a-zA-Z0-9]+)$/);
    if (hashMatch) return hashMatch[1];

    return null;
}

function htmlToMarkdown(html) {
    // Simple HTML to markdown conversion for testing
    let text = html;

    // Bold
    text = text.replace(/<strong>([^<]*)<\/strong>/gi, '**$1**');
    text = text.replace(/<b>([^<]*)<\/b>/gi, '**$1**');

    // Italic
    text = text.replace(/<em>([^<]*)<\/em>/gi, '_$1_');
    text = text.replace(/<i>([^<]*)<\/i>/gi, '_$1_');

    // Strikethrough
    text = text.replace(/<del>([^<]*)<\/del>/gi, '~~$1~~');
    text = text.replace(/<s>([^<]*)<\/s>/gi, '~~$1~~');

    // Code
    text = text.replace(/<code>([^<]*)<\/code>/gi, '`$1`');

    // Remove remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    return text.trim();
}

// Priority mapping
const PRIORITIES = {
    1: { name: 'Urgent', color: '#e53935' },
    2: { name: 'High', color: '#ff9800' },
    3: { name: 'Normal', color: '#ffeb3b' },
    4: { name: 'Low', color: '#2196f3' }
};

// ============================================================================
// Tests
// ============================================================================

describe('Modal - parseTime', () => {
    test('parses hours only', () => {
        expect(parseTime('2h')).toBe(2 * 60 * 60 * 1000);
        expect(parseTime('5H')).toBe(5 * 60 * 60 * 1000);
    });

    test('parses minutes only', () => {
        expect(parseTime('30m')).toBe(30 * 60 * 1000);
        expect(parseTime('45M')).toBe(45 * 60 * 1000);
    });

    test('parses combined hours and minutes', () => {
        expect(parseTime('2h 30m')).toBe(2.5 * 60 * 60 * 1000);
        expect(parseTime('1h15m')).toBe(1.25 * 60 * 60 * 1000);
    });

    test('treats bare number as hours', () => {
        expect(parseTime('2')).toBe(2 * 60 * 60 * 1000);
        expect(parseTime('0.5')).toBe(0.5 * 60 * 60 * 1000);
    });

    test('returns null for empty/invalid input', () => {
        expect(parseTime('')).toBeNull();
        expect(parseTime(null)).toBeNull();
        expect(parseTime(undefined)).toBeNull();
        expect(parseTime('abc')).toBeNull();
    });
});

describe('Modal - escapeHtml', () => {
    test('escapes HTML special characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    test('escapes ampersand', () => {
        expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    test('escapes single quotes', () => {
        expect(escapeHtml("It's fine")).toBe("It&#39;s fine");
    });

    test('handles empty/null input', () => {
        expect(escapeHtml('')).toBe('');
        expect(escapeHtml(null)).toBe('');
    });
});

describe('Modal - highlightMatch', () => {
    test('wraps matching text in strong tags', () => {
        expect(highlightMatch('Hello World', 'World')).toBe('Hello <strong>World</strong>');
    });

    test('is case insensitive', () => {
        expect(highlightMatch('Hello WORLD', 'world')).toBe('Hello <strong>WORLD</strong>');
    });

    test('highlights multiple occurrences', () => {
        expect(highlightMatch('foo bar foo', 'foo')).toBe('<strong>foo</strong> bar <strong>foo</strong>');
    });

    test('escapes HTML in text', () => {
        expect(highlightMatch('<div>', 'div')).toBe('&lt;<strong>div</strong>&gt;');
    });

    test('returns escaped text when query is empty', () => {
        expect(highlightMatch('Hello', '')).toBe('Hello');
    });
});

describe('Modal - extractTaskId', () => {
    test('extracts ID from ClickUp URL', () => {
        expect(extractTaskId('https://app.clickup.com/t/86aebxw4v')).toBe('86aebxw4v');
    });

    test('extracts ID from URL with path', () => {
        expect(extractTaskId('https://app.clickup.com/t/task123/view')).toBe('task123');
    });

    test('returns alphanumeric ID as-is', () => {
        expect(extractTaskId('86aebxw4v')).toBe('86aebxw4v');
        expect(extractTaskId('abc123xyz')).toBe('abc123xyz');
    });

    test('extracts ID from # format', () => {
        expect(extractTaskId('#task123')).toBe('task123');
    });

    test('returns null for text search', () => {
        expect(extractTaskId('fix the bug')).toBeNull();
        expect(extractTaskId('short')).toBeNull();
    });

    test('returns null for empty input', () => {
        expect(extractTaskId('')).toBeNull();
        expect(extractTaskId(null)).toBeNull();
    });
});

describe('Modal - htmlToMarkdown', () => {
    test('converts bold tags', () => {
        expect(htmlToMarkdown('<strong>bold</strong>')).toBe('**bold**');
        expect(htmlToMarkdown('<b>bold</b>')).toBe('**bold**');
    });

    test('converts italic tags', () => {
        expect(htmlToMarkdown('<em>italic</em>')).toBe('_italic_');
        expect(htmlToMarkdown('<i>italic</i>')).toBe('_italic_');
    });

    test('converts strikethrough tags', () => {
        expect(htmlToMarkdown('<del>deleted</del>')).toBe('~~deleted~~');
        expect(htmlToMarkdown('<s>striked</s>')).toBe('~~striked~~');
    });

    test('converts code tags', () => {
        expect(htmlToMarkdown('<code>const x = 1</code>')).toBe('`const x = 1`');
    });

    test('strips remaining HTML', () => {
        expect(htmlToMarkdown('<div>Hello</div>')).toBe('Hello');
    });

    test('handles combined formatting', () => {
        expect(htmlToMarkdown('<strong>bold</strong> and <em>italic</em>')).toBe('**bold** and _italic_');
    });
});

describe('Modal - Priority Mapping', () => {
    test('has all priority levels defined', () => {
        expect(PRIORITIES[1].name).toBe('Urgent');
        expect(PRIORITIES[2].name).toBe('High');
        expect(PRIORITIES[3].name).toBe('Normal');
        expect(PRIORITIES[4].name).toBe('Low');
    });

    test('has colors for all priorities', () => {
        Object.values(PRIORITIES).forEach(p => {
            expect(p.color).toMatch(/^#[a-f0-9]{6}$/i);
        });
    });
});

describe('Modal - Task Creation Flow', () => {
    beforeEach(() => {
        mockStorage.clear();
    });

    test('validates required fields', () => {
        const validateTaskData = (data) => {
            const errors = [];
            if (!data.name?.trim()) errors.push('Task name is required');
            if (!data.listId) errors.push('List is required');
            return errors;
        };

        expect(validateTaskData({})).toContain('Task name is required');
        expect(validateTaskData({ name: '', listId: '123' })).toContain('Task name is required');
        expect(validateTaskData({ name: 'Task', listId: null })).toContain('List is required');
        expect(validateTaskData({ name: 'Task', listId: '123' })).toHaveLength(0);
    });

    test('formats task data correctly', () => {
        const formatTaskData = (data) => ({
            name: data.name,
            markdown_description: data.description || '',
            assignees: data.assignees || [],
            priority: data.priority || undefined,
            start_date: data.startDate ? new Date(data.startDate).getTime() : undefined,
            due_date: data.dueDate ? new Date(data.dueDate).getTime() : undefined
        });

        const result = formatTaskData({
            name: 'My Task',
            description: 'Description here',
            priority: 2,
            dueDate: '2026-01-15'
        });

        expect(result.name).toBe('My Task');
        expect(result.markdown_description).toBe('Description here');
        expect(result.priority).toBe(2);
        expect(result.due_date).toBeGreaterThan(0);
    });
});

describe('Modal - Assignee Selection', () => {
    test('filters members by query', () => {
        const members = [
            { id: 1, username: 'john_doe', email: 'john@example.com' },
            { id: 2, username: 'jane_smith', email: 'jane@example.com' },
            { id: 3, username: 'bob_wilson', email: 'bob@company.org' }
        ];

        const filterMembers = (query) =>
            members.filter(m =>
                m.username.toLowerCase().includes(query.toLowerCase()) ||
                m.email.toLowerCase().includes(query.toLowerCase())
            );

        expect(filterMembers('john')).toHaveLength(1);
        expect(filterMembers('example')).toHaveLength(2);
        expect(filterMembers('xyz')).toHaveLength(0);
    });

    test('handles nested user objects', () => {
        const member = { user: { id: 1, username: 'test', email: 'test@test.com' } };
        const user = member.user || member;

        expect(user.username).toBe('test');
        expect(user.email).toBe('test@test.com');
    });
});
