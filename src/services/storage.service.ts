/**
 * Storage Service
 * Centralized storage abstraction with schema versioning, data limits, and TTL
 */

import type {
    CachedListItem,
    EmailTaskMapping
} from '../types/clickup';
import {
    EMAIL_TASK_MAPPINGS_V2_KEY,
    LINK_SCHEMA_VERSION,
    type EmailTaskMappingsV1,
    type EmailTaskMappingsV2,
    isConfirmedThreadId,
    migrateMappingsV1ToV2,
    readMappingsWithFallback,
} from '../link-hardening';

// ============================================================================
// Schema Version
// ============================================================================

const SCHEMA_VERSION = 2;

// ============================================================================
// Storage Keys
// ============================================================================

export const STORAGE_KEYS = {
    // Schema
    SCHEMA_VERSION: 'schemaVersion',

    // Auth
    TOKEN: 'clickupToken',
    REFRESH_TOKEN: 'clickupRefreshToken',
    ENCRYPTION_KEY: 'encryptionKey',

    // Cache
    TEAMS: 'cachedTeams',
    USER: 'cachedUser',
    HIERARCHY_CACHE: 'hierarchyCache',

    // Settings
    DEFAULT_LIST: 'defaultList',
    AUTO_START_TIMER: 'autoStartTimer',
    AUTO_STOP_TIMER: 'autoStopTimer',

    // Data
    EMAIL_TASKS: 'emailTaskMappings',
    EMAIL_TASKS_V2: EMAIL_TASK_MAPPINGS_V2_KEY,
    EMAIL_TASKS_SYNC: 'emailTasksSync',

} as const;

// ============================================================================
// Limits and TTL
// ============================================================================

export const DATA_LIMITS = {
    /** Maximum number of email-task mappings to store */
    MAX_EMAIL_TASKS: 1000,

    /** Hierarchy cache TTL in milliseconds */
    HIERARCHY_CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours

    /** Teams cache TTL in milliseconds */
    TEAMS_CACHE_TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ============================================================================
// Types
// ============================================================================

interface HierarchyCache {
    teamId: string;
    lists: CachedListItem[];
    spaces: any[];
    members: any[];
    timestamp: number;
}

// ============================================================================
// Storage Service Class
// ============================================================================

class StorageService {
    private storage = chrome.storage.local;
    private emailTaskWriteQueue: Promise<void> = Promise.resolve();

    // ------------------------------------------------------------------------
    // Schema Management
    // ------------------------------------------------------------------------

    /**
     * Initialize storage and run migrations if needed
     */
    async initialize(): Promise<void> {
        const version = await this.get<number>(STORAGE_KEYS.SCHEMA_VERSION) || 0;

        if (version < SCHEMA_VERSION) {
            await this.migrate(version, SCHEMA_VERSION);
            await this.set(STORAGE_KEYS.SCHEMA_VERSION, SCHEMA_VERSION);
        }

        // Link cleanup is intentionally non-destructive in schema V2.
        await this.cleanupOldData();
    }

    /**
     * Run migrations between schema versions
     */
    private async migrate(fromVersion: number, toVersion: number): Promise<void> {
        console.log('[Storage] MIGRATION_START');

        // Version 0 -> 1: Initial schema, no migration needed
        if (fromVersion === 0 && toVersion >= 1) {
            // Just set the version, data is already in correct format
        }

        if (fromVersion < LINK_SCHEMA_VERSION && toVersion >= LINK_SCHEMA_VERSION) {
            await this.migrateEmailTasksV2Shadow();
        }
    }

    async migrateEmailTasksV2Shadow(): Promise<EmailTaskMappingsV2> {
        const data = await this.storage.get([STORAGE_KEYS.EMAIL_TASKS, STORAGE_KEYS.EMAIL_TASKS_V2]);
        const v1 = (data[STORAGE_KEYS.EMAIL_TASKS] || {}) as EmailTaskMappingsV1;
        const currentV2 = (data[STORAGE_KEYS.EMAIL_TASKS_V2] || {}) as EmailTaskMappingsV2;
        const migrated = migrateMappingsV1ToV2(v1, currentV2);
        await this.set(STORAGE_KEYS.EMAIL_TASKS_V2, migrated);
        return migrated;
    }

    // ------------------------------------------------------------------------
    // Core CRUD Operations
    // ------------------------------------------------------------------------

    /**
     * Get a value from storage
     */
    async get<T>(key: string): Promise<T | null> {
        const result = await this.storage.get(key);
        return result[key] ?? null;
    }

    /**
     * Set a value in storage
     */
    async set<T>(key: string, value: T): Promise<void> {
        await this.storage.set({ [key]: value });
    }

    /**
     * Remove a value from storage
     */
    async remove(key: string): Promise<void> {
        await this.storage.remove(key);
    }

    /**
     * Get multiple values from storage
     */
    async getMultiple<T extends Record<string, any>>(keys: string[]): Promise<Partial<T>> {
        return await this.storage.get(keys) as Partial<T>;
    }

    /**
     * Set multiple values in storage
     */
    async setMultiple(data: Record<string, any>): Promise<void> {
        await this.storage.set(data);
    }

    // ------------------------------------------------------------------------
    // Cache Methods (with TTL check)
    // ------------------------------------------------------------------------

    async getHierarchyCache(): Promise<HierarchyCache | null> {
        const cache = await this.get<HierarchyCache>(STORAGE_KEYS.HIERARCHY_CACHE);

        if (cache && cache.timestamp) {
            const age = Date.now() - cache.timestamp;
            if (age > DATA_LIMITS.HIERARCHY_CACHE_TTL) {
                console.log('[Storage] Hierarchy cache expired');
                return null; // Expired
            }
        }

        return cache;
    }

    async setHierarchyCache(cache: Omit<HierarchyCache, 'timestamp'>): Promise<void> {
        await this.set(STORAGE_KEYS.HIERARCHY_CACHE, {
            ...cache,
            timestamp: Date.now()
        });
    }

    // ------------------------------------------------------------------------
    // Email Tasks (with limits)
    // ------------------------------------------------------------------------

    async getEmailTasks(): Promise<Record<string, EmailTaskMapping[]>> {
        const data = await this.storage.get([STORAGE_KEYS.EMAIL_TASKS, STORAGE_KEYS.EMAIL_TASKS_V2]);
        return readMappingsWithFallback(
            data[STORAGE_KEYS.EMAIL_TASKS_V2] || {},
            data[STORAGE_KEYS.EMAIL_TASKS] || {}
        );
    }

    async setEmailTasks(tasks: Record<string, EmailTaskMapping[]>): Promise<void> {
        // Enforce limit
        const entries = Object.entries(tasks);

        if (entries.length > DATA_LIMITS.MAX_EMAIL_TASKS) {
            console.warn(`[Storage] Email task mappings exceed soft limit (${entries.length}/${DATA_LIMITS.MAX_EMAIL_TASKS}); write is report-only, no truncation applied`);
        }

        await this.set(STORAGE_KEYS.EMAIL_TASKS_V2, tasks);
    }

    async updateEmailTasks(mutator: (tasks: EmailTaskMappingsV2) => EmailTaskMappingsV2 | void): Promise<EmailTaskMappingsV2> {
        let updated: EmailTaskMappingsV2 = {};
        const next = this.emailTaskWriteQueue.then(async () => {
            const data = await this.storage.get([STORAGE_KEYS.EMAIL_TASKS, STORAGE_KEYS.EMAIL_TASKS_V2]);
            const current = readMappingsWithFallback(
                data[STORAGE_KEYS.EMAIL_TASKS_V2] || {},
                data[STORAGE_KEYS.EMAIL_TASKS] || {}
            );
            const result = mutator(current);
            updated = result || current;
            await this.setEmailTasks(updated);
        });

        this.emailTaskWriteQueue = next.catch(() => undefined);
        await next;
        return updated;
    }

    async addEmailTask(threadId: string, task: EmailTaskMapping): Promise<void> {
        if (!isConfirmedThreadId(threadId)) return;

        await this.updateEmailTasks((tasks) => {
            if (!tasks[threadId]) {
                tasks[threadId] = [];
            }

            if (!tasks[threadId].find(t => t.id === task.id)) {
                tasks[threadId].push({
                    ...task,
                    linkStatus: 'unverified',
                    linkSource: 'unknown',
                    createdAt: task.createdAt || Date.now(),
                    updatedAt: Date.now(),
                    failureCount: 0,
                });
            }
        });
    }

    // ------------------------------------------------------------------------
    // Cleanup Methods
    // ------------------------------------------------------------------------

    /**
     * Report mapping volume only. No automatic mapping purge is performed.
     */
    async cleanupOldData(): Promise<void> {
        console.log('[Storage] Link cleanup is report-only for schema v2');

        const tasks = await this.getEmailTasks();
        const entries = Object.entries(tasks);
        if (entries.length > DATA_LIMITS.MAX_EMAIL_TASKS) {
            console.warn(`[Storage] Email task mappings exceed soft limit (${entries.length}/${DATA_LIMITS.MAX_EMAIL_TASKS}); no automatic purge performed`);
        }
    }

    /**
     * Clear all auth-related data (for logout)
     */
    async clearAuth(): Promise<void> {
        await this.storage.remove([
            STORAGE_KEYS.TOKEN,
            STORAGE_KEYS.REFRESH_TOKEN,
            STORAGE_KEYS.USER,
            STORAGE_KEYS.TEAMS,
            STORAGE_KEYS.ENCRYPTION_KEY,
        ]);
    }

    /**
     * Clear all cached data
     */
    async clearCache(): Promise<void> {
        await this.storage.remove([
            STORAGE_KEYS.TEAMS,
            STORAGE_KEYS.HIERARCHY_CACHE,
        ]);
    }

    /**
     * Clear everything (for debugging)
     */
    async clearAll(): Promise<void> {
        await this.storage.clear();
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const storageService = new StorageService();

// Initialize on load
storageService.initialize().catch(_err => {
    console.error('[Storage] INIT_FAILED');
});
