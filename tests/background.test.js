/**
 * Background.js Unit Tests
 * Tests for ClickUp Gmail Chrome Extension background service worker
 */

const { mockStorage, mockRuntime } = require('./setup');
const fs = require('fs');
const path = require('path');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('message failures identify only the validated action in production logs', () => {
    const background = source('background.ts');
    expect(background).toContain('MESSAGE_HANDLER_ERROR_${message.action}');
    expect(background).toContain('error: Logger.sanitizeError(error)');
});

// ============================================================================
// Helper functions to test (extracted logic)
// ============================================================================

/**
 * Parse time string (e.g., "2h 30m") to milliseconds
 * Mirrors parseTime() in modal.js
 */
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

/**
 * Extract task ID from ClickUp URL or return as-is
 * Mirrors extractTaskId() in modal.js
 */
function extractTaskId(input) {
    // Handle ClickUp URLs: https://app.clickup.com/t/86aebxw4v
    const urlMatch = input.match(/clickup\.com\/t\/([a-zA-Z0-9]+)/);
    if (urlMatch) {
        return urlMatch[1];
    }

    // Handle task ID format (alphanumeric, typically 8-10 chars)
    if (/^[a-zA-Z0-9]{6,12}$/.test(input.trim())) {
        return input.trim();
    }

    // Handle #taskid format
    const hashMatch = input.match(/^#([a-zA-Z0-9]+)$/);
    if (hashMatch) {
        return hashMatch[1];
    }

    return null;
}

/**
 * Sanitize filename for attachment
 */
function sanitizeFilename(subject) {
    return (subject || 'Email').replace(/[<>:"/\\|?*]/g, '').substring(0, 100) + '.html';
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, char => map[char]);
}

// ============================================================================
// Tests
// ============================================================================

describe('parseTime', () => {
    test('parses hours only', () => {
        expect(parseTime('2h')).toBe(2 * 60 * 60 * 1000);
        expect(parseTime('1H')).toBe(1 * 60 * 60 * 1000);
    });

    test('parses minutes only', () => {
        expect(parseTime('30m')).toBe(30 * 60 * 1000);
        expect(parseTime('45M')).toBe(45 * 60 * 1000);
    });

    test('parses hours and minutes', () => {
        expect(parseTime('2h 30m')).toBe(2.5 * 60 * 60 * 1000);
        expect(parseTime('1h 15m')).toBe(1.25 * 60 * 60 * 1000);
    });

    test('parses bare number as hours', () => {
        expect(parseTime('2')).toBe(2 * 60 * 60 * 1000);
        expect(parseTime('0.5')).toBe(0.5 * 60 * 60 * 1000);
    });

    test('returns null for empty or invalid input', () => {
        expect(parseTime('')).toBeNull();
        expect(parseTime(null)).toBeNull();
        expect(parseTime(undefined)).toBeNull();
        expect(parseTime('abc')).toBeNull();
    });
});

describe('extractTaskId', () => {
    test('extracts ID from ClickUp URL', () => {
        expect(extractTaskId('https://app.clickup.com/t/86aebxw4v')).toBe('86aebxw4v');
        expect(extractTaskId('https://app.clickup.com/t/abc123def')).toBe('abc123def');
    });

    test('returns valid task ID as-is', () => {
        expect(extractTaskId('86aebxw4v')).toBe('86aebxw4v');
        expect(extractTaskId('abc12345')).toBe('abc12345');
    });

    test('extracts ID from hash format', () => {
        expect(extractTaskId('#86aebxw4v')).toBe('86aebxw4v');
    });

    test('returns null for text searches', () => {
        expect(extractTaskId('some task name')).toBeNull();
        expect(extractTaskId('fix bug in login')).toBeNull();
    });
});

describe('sanitizeFilename', () => {
    test('removes invalid characters', () => {
        expect(sanitizeFilename('Test <Subject>')).toBe('Test Subject.html');
        expect(sanitizeFilename('RE: Urgent | Action')).toBe('RE Urgent  Action.html');
    });

    test('truncates long filenames', () => {
        const longSubject = 'A'.repeat(150);
        const result = sanitizeFilename(longSubject);
        expect(result.length).toBeLessThanOrEqual(105); // 100 + '.html'
    });

    test('handles empty input', () => {
        expect(sanitizeFilename('')).toBe('Email.html');
        expect(sanitizeFilename(null)).toBe('Email.html');
    });
});

describe('escapeHtml', () => {
    test('escapes HTML special characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    test('escapes ampersands', () => {
        expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    test('handles normal text', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });
});

describe('Chrome Storage Integration', () => {
    test('saves and retrieves data correctly', async () => {
        await chrome.storage.local.set({ testKey: 'testValue' });
        const result = await chrome.storage.local.get('testKey');
        expect(result.testKey).toBe('testValue');
    });

    test('handles multiple keys', async () => {
        await chrome.storage.local.set({
            key1: 'value1',
            key2: 'value2'
        });
        const result = await chrome.storage.local.get(['key1', 'key2']);
        expect(result.key1).toBe('value1');
        expect(result.key2).toBe('value2');
    });

    test('removes data correctly', async () => {
        await chrome.storage.local.set({ toRemove: 'value' });
        await chrome.storage.local.remove('toRemove');
        const result = await chrome.storage.local.get('toRemove');
        expect(result.toRemove).toBeUndefined();
    });
});

describe('Background-owned local data clear', () => {
    test('popup delegates clear to background and background serializes mapping clear', () => {
        const popup = source('popup/popup.ts');
        const background = source('background.ts');

        expect(popup).toMatch(/sendMessage\(\{ action: 'clearLocalData' \}\)/);
        expect(popup).not.toMatch(/chrome\.storage\.local\.remove\(\[\s*['"]emailTaskMappings/);
        expect(background).toMatch(/case 'clearLocalData'/);
        expect(background).toMatch(/async function clearLocalData/);
        expect(background).toMatch(/const next = mappingWriteQueue\.then\(async \(\) => \{/);
        expect(background).toMatch(/await chrome\.storage\.local\.remove\(\[/);
        expect(background).toMatch(/await chrome\.storage\.local\.set\(\{\s*\[STORAGE_KEYS\.EMAIL_TASK_MAPPINGS_V2\]: \{\}/);
        expect(background).toMatch(/const schemaVersion = resolveSchemaVersion\(store\.schemaVersion\)/);
        expect(background).toMatch(/taskSearchCaches\.clear\(\)/);
        expect(background).toMatch(/dashboardSnapshotCache\.clear\(\)/);
        expect(background).not.toMatch(/lastEmailSync:\s*undefined|lastEmailSyncCount:\s*undefined/);
    });

    test('mapping writer reads and preserves future schemaVersion', () => {
        const background = source('background.ts');

        expect(background).toMatch(/chrome\.storage\.local\.get\(\[STORAGE_KEYS\.EMAIL_TASK_MAPPINGS, STORAGE_KEYS\.EMAIL_TASK_MAPPINGS_V2, 'schemaVersion'\]\)/);
        expect(background).toMatch(/function safeSchemaVersion\(value: unknown\): number/);
        expect(background).toMatch(/Number\.isFinite\(version\) && version >= 0 \? Math\.floor\(version\) : 0/);
        expect(background).toMatch(/function resolveSchemaVersion\(stored: unknown, extra: unknown = 0\): number/);
        const safe = (value) => {
            const version = Number(value);
            return Number.isFinite(version) && version >= 0 ? Math.floor(version) : 0;
        };
        const resolve = (stored, extra = 0) => Math.max(safe(stored), 2, safe(extra));
        expect(resolve(7)).toBe(7);
        expect(resolve('bad', Number.NaN)).toBe(2);
        expect(resolve(Infinity, 9)).toBe(9);
    });

    test('serialized clear final state removes V1 and caches while preserving future schema version', async () => {
        const state = {
            emailTaskMappings: { thread1: [{ id: 'legacy' }] },
            emailTaskMappingsV2: { thread1: [{ id: 'v2' }] },
            schemaVersion: 7,
            lastEmailSync: 1,
            lastEmailSyncCount: 2,
            hierarchyCache: { team: {} },
            hierarchyPreloadStatus: { team: {} },
            cachedTeams: { teams: [] },
            cachedUser: { user: {} },
        };
        const order = [];
        const storage = {
            async get(key) {
                order.push(`get:${Array.isArray(key) ? key.join(',') : key}`);
                return typeof key === 'string' ? { [key]: state[key] } : state;
            },
            async remove(keys) {
                order.push(`remove:${keys.join(',')}`);
                keys.forEach(key => delete state[key]);
            },
            async set(items) {
                order.push(`set:${Object.keys(items).join(',')}`);
                Object.assign(state, items);
            },
        };

        const store = await storage.get('schemaVersion');
        await storage.remove(['emailTaskMappings', 'emailTaskMappingsV2', 'lastEmailSync', 'lastEmailSyncCount', 'hierarchyCache', 'hierarchyPreloadStatus', 'cachedTeams', 'cachedUser']);
        await storage.set({ emailTaskMappingsV2: {}, schemaVersion: Math.max(Number(store.schemaVersion || 0), 2) });

        expect(order).toEqual([
            'get:schemaVersion',
            'remove:emailTaskMappings,emailTaskMappingsV2,lastEmailSync,lastEmailSyncCount,hierarchyCache,hierarchyPreloadStatus,cachedTeams,cachedUser',
            'set:emailTaskMappingsV2,schemaVersion',
        ]);
        expect(state.emailTaskMappings).toBeUndefined();
        expect(state.emailTaskMappingsV2).toEqual({});
        expect(state.schemaVersion).toBe(7);
        expect(state.hierarchyCache).toBeUndefined();
        expect(state.lastEmailSync).toBeUndefined();
    });

    test('syncEmailTasks no longer accepts emailData branch or destructive single-email sync', () => {
        const background = source('background.ts');

        expect(background).toMatch(/case 'syncEmailTasks'/);
        expect(background).not.toMatch(/data\.emailData[\s\S]{0,120}syncSingleEmailTask/);
        expect(background).not.toMatch(/mappings\[emailData\.threadId\]\s*=\s*tasks\.map/);
    });

    test('findLinkedTasks is local and visible-only, attach rejects unsanitized HTML before ensureAPI', () => {
        const background = source('background.ts');

        expect(background).toMatch(/async function findLinkedTasks/);
        expect(background).toMatch(/toVisibleLinkedTasks\(mappings\[threadId\] \|\| \[\]\)\.map/);
        expect(background).toMatch(/if \(data\.emailData\?\.html && data\.emailData\.htmlSanitized !== true\)[\s\S]{0,160}throw new Error\('El HTML del email debe estar sanitizado antes de adjuntarlo\.'\);[\s\S]{0,40}await ensureAPI\(\)/);
    });
});

describe('Email Task Mapping', () => {
    const STORAGE_KEY = 'emailTaskMappings';

    async function saveEmailTaskMapping(threadId, task) {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        const mappings = data[STORAGE_KEY] || {};

        if (!mappings[threadId]) {
            mappings[threadId] = [];
        }

        if (!mappings[threadId].find(t => t.id === task.id)) {
            mappings[threadId].push({
                id: task.id,
                name: task.name,
                url: task.url
            });
        }

        await chrome.storage.local.set({ [STORAGE_KEY]: mappings });
    }

    test('saves new task mapping', async () => {
        const threadId = '19b95d11476b81db';
        const task = {
            id: '86aebxw4v',
            name: 'Test Task',
            url: 'https://app.clickup.com/t/86aebxw4v'
        };

        await saveEmailTaskMapping(threadId, task);

        const result = await chrome.storage.local.get(STORAGE_KEY);
        expect(result[STORAGE_KEY][threadId]).toHaveLength(1);
        expect(result[STORAGE_KEY][threadId][0].id).toBe('86aebxw4v');
    });

    test('prevents duplicate task mappings', async () => {
        const threadId = '19b95d11476b81db';
        const task = {
            id: '86aebxw4v',
            name: 'Test Task',
            url: 'https://app.clickup.com/t/86aebxw4v'
        };

        await saveEmailTaskMapping(threadId, task);
        await saveEmailTaskMapping(threadId, task); // Duplicate

        const result = await chrome.storage.local.get(STORAGE_KEY);
        expect(result[STORAGE_KEY][threadId]).toHaveLength(1);
    });

    test('allows multiple tasks per thread', async () => {
        const threadId = '19b95d11476b81db';
        const task1 = { id: 'task1', name: 'Task 1', url: 'url1' };
        const task2 = { id: 'task2', name: 'Task 2', url: 'url2' };

        await saveEmailTaskMapping(threadId, task1);
        await saveEmailTaskMapping(threadId, task2);

        const result = await chrome.storage.local.get(STORAGE_KEY);
        expect(result[STORAGE_KEY][threadId]).toHaveLength(2);
    });
});

describe('API Response Handling', () => {
    test('handles successful API response', async () => {
        const mockTask = {
            id: '86aebxw4v',
            name: 'Test Task',
            url: 'https://app.clickup.com/t/86aebxw4v'
        };

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockTask)
        });

        const response = await fetch('https://api.clickup.com/api/v2/task/86aebxw4v');
        const data = await response.json();

        expect(data.id).toBe('86aebxw4v');
    });

    test('handles 401 Unauthorized', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ err: 'Unauthorized' })
        });

        const response = await fetch('https://api.clickup.com/api/v2/task/123');

        expect(response.ok).toBe(false);
        expect(response.status).toBe(401);
    });

    test('handles 404 Not Found', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: () => Promise.resolve({ err: 'Task not found' })
        });

        const response = await fetch('https://api.clickup.com/api/v2/task/invalid');

        expect(response.ok).toBe(false);
        expect(response.status).toBe(404);
    });
});
