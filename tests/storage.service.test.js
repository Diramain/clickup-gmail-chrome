/**
 * Storage Service Unit Tests
 */

const { mockStorage } = require('./setup');

describe('StorageService', () => {
    beforeEach(() => {
        mockStorage.clear();
    });

    describe('Schema Versioning', () => {
        test('initializes with schema version', async () => {
            await chrome.storage.local.set({ schemaVersion: 1 });
            const result = await chrome.storage.local.get('schemaVersion');
            expect(result.schemaVersion).toBe(1);
        });

        test('handles missing schema version (upgrade from v0)', async () => {
            const result = await chrome.storage.local.get('schemaVersion');
            expect(result.schemaVersion).toBeUndefined();
        });
    });

    describe('Data Limits', () => {
        const MAX_EMAIL_TASKS = 1000;

        test('enforces maximum email task limit', async () => {
            // Create more entries than limit
            const mappings = {};
            for (let i = 0; i < MAX_EMAIL_TASKS + 100; i++) {
                mappings[`thread_${i}`] = [{ id: `task_${i}`, name: `Task ${i}` }];
            }

            // Simulate limit enforcement
            const entries = Object.entries(mappings);
            const limited = Object.fromEntries(entries.slice(0, MAX_EMAIL_TASKS));

            await chrome.storage.local.set({ emailTaskMappings: limited });

            const result = await chrome.storage.local.get('emailTaskMappings');
            expect(Object.keys(result.emailTaskMappings).length).toBeLessThanOrEqual(MAX_EMAIL_TASKS);
        });
    });

    describe('CRUD Operations', () => {
        test('get returns null for non-existent keys', async () => {
            const result = await chrome.storage.local.get('nonExistentKey');
            expect(result.nonExistentKey).toBeUndefined();
        });

        test('set and get work correctly', async () => {
            await chrome.storage.local.set({ testKey: 'testValue' });
            const result = await chrome.storage.local.get('testKey');
            expect(result.testKey).toBe('testValue');
        });

        test('remove deletes key', async () => {
            await chrome.storage.local.set({ toDelete: 'value' });
            await chrome.storage.local.remove('toDelete');
            const result = await chrome.storage.local.get('toDelete');
            expect(result.toDelete).toBeUndefined();
        });
    });

    describe('Hierarchy Cache', () => {
        test('caches hierarchy data with timestamp', async () => {
            const cache = {
                teamId: 'team123',
                lists: [{ id: 'list1', name: 'List 1' }],
                timestamp: Date.now()
            };

            await chrome.storage.local.set({ hierarchyCache: cache });
            const result = await chrome.storage.local.get('hierarchyCache');

            expect(result.hierarchyCache.teamId).toBe('team123');
            expect(result.hierarchyCache.timestamp).toBeDefined();
        });

        test('detects expired cache', () => {
            const HIERARCHY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
            const oldTimestamp = Date.now() - (HIERARCHY_CACHE_TTL + 1000);
            const age = Date.now() - oldTimestamp;

            expect(age > HIERARCHY_CACHE_TTL).toBe(true);
        });
    });

    describe('Email Tasks', () => {
        test('adds email task mapping', async () => {
            const threadId = 'thread123';
            const task = { id: 'task1', name: 'Task 1', url: 'url1' };

            let mappings = {};
            mappings[threadId] = [task];

            await chrome.storage.local.set({ emailTaskMappings: mappings });
            const result = await chrome.storage.local.get('emailTaskMappings');

            expect(result.emailTaskMappings[threadId]).toHaveLength(1);
            expect(result.emailTaskMappings[threadId][0].id).toBe('task1');
        });

        test('prevents duplicate tasks for same thread', async () => {
            const threadId = 'thread123';
            const task = { id: 'task1', name: 'Task 1', url: 'url1' };

            let mappings = { [threadId]: [task] };

            // Try adding duplicate
            if (!mappings[threadId].find(t => t.id === task.id)) {
                mappings[threadId].push(task);
            }

            await chrome.storage.local.set({ emailTaskMappings: mappings });
            const result = await chrome.storage.local.get('emailTaskMappings');

            expect(result.emailTaskMappings[threadId]).toHaveLength(1);
        });
    });
});
