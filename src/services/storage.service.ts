/**
 * Storage Service
 * Centralized storage abstraction with schema versioning, data limits, and TTL
 */

import type {
    ClickUpTeamsResponse,
    ClickUpUserResponse,
    CachedListItem,
    TaskMapping
} from '../types/clickup';

// ============================================================================
// Schema Version
// ============================================================================

const SCHEMA_VERSION = 1;

// ============================================================================
// Storage Keys
// ============================================================================

export const STORAGE_KEYS = {
    // Schema
    SCHEMA_VERSION: 'schemaVersion',

    // Auth
    TOKEN: 'clickupToken',
    REFRESH_TOKEN: 'clickupRefreshToken',
    OAUTH_CONFIG: 'oauthConfig',
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
    EMAIL_TASKS_SYNC: 'emailTasksSync',

    // Draft (temporary)
    DRAFT_CLIENT_ID: 'draftClientId',
    DRAFT_CLIENT_SECRET: 'draftClientSecret',
} as const;

// ============================================================================
// Limits and TTL
// ============================================================================

export const DATA_LIMITS = {
    /** Maximum number of email-task mappings to store */
    MAX_EMAIL_TASKS: 1000,

    /** Maximum age of email-task mappings in days */
    EMAIL_TASKS_MAX_AGE_DAYS: 90,

    /** Hierarchy cache TTL in milliseconds */
    HIERARCHY_CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours

    /** Teams cache TTL in milliseconds */
    TEAMS_CACHE_TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ============================================================================
// Types
// ============================================================================

interface OAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUrl: string;
}

interface DefaultListConfig {
    teamId: string;
    spaceId: string;
    listId: string;
    path?: string;
}

interface HierarchyCache {
    teamId: string;
    lists: CachedListItem[];
    spaces: any[];
    members: any[];
    timestamp: number;
}

interface EmailTasksSyncStatus {
    lastSync: number;
    tasksFound: number;
    errors: string[];
}

// Storage schema (for future migrations)
interface StorageSchema {
    schemaVersion: number;
    [key: string]: any;
}

// ============================================================================
// Storage Service Class
// ============================================================================

class StorageService {
    private storage = chrome.storage.local;

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

        // Run cleanup on initialize
        await this.cleanupOldData();
    }

    /**
     * Run migrations between schema versions
     */
    private async migrate(fromVersion: number, toVersion: number): Promise<void> {
        console.log(`[Storage] Migrating from v${fromVersion} to v${toVersion}`);

        // Version 0 -> 1: Initial schema, no migration needed
        if (fromVersion === 0 && toVersion >= 1) {
            // Just set the version, data is already in correct format
        }

        // Add future migrations here:
        // if (fromVersion < 2 && toVersion >= 2) { ... }
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
    // Auth Methods
    // ------------------------------------------------------------------------

    async getOAuthConfig(): Promise<OAuthConfig | null> {
        return await this.get<OAuthConfig>(STORAGE_KEYS.OAUTH_CONFIG);
    }

    async setOAuthConfig(config: OAuthConfig): Promise<void> {
        await this.set(STORAGE_KEYS.OAUTH_CONFIG, config);
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

    async getEmailTasks(): Promise<Record<string, TaskMapping[]>> {
        return await this.get<Record<string, TaskMapping[]>>(STORAGE_KEYS.EMAIL_TASKS) || {};
    }

    async setEmailTasks(tasks: Record<string, TaskMapping[]>): Promise<void> {
        // Enforce limit
        const entries = Object.entries(tasks);

        if (entries.length > DATA_LIMITS.MAX_EMAIL_TASKS) {
            // Keep most recent entries (assuming keys are sortable by date)
            const sorted = entries.sort((a, b) => b[0].localeCompare(a[0]));
            const limited = sorted.slice(0, DATA_LIMITS.MAX_EMAIL_TASKS);
            tasks = Object.fromEntries(limited);
            console.log(`[Storage] Trimmed email tasks to ${DATA_LIMITS.MAX_EMAIL_TASKS}`);
        }

        await this.set(STORAGE_KEYS.EMAIL_TASKS, tasks);
    }

    async addEmailTask(threadId: string, task: TaskMapping): Promise<void> {
        const tasks = await this.getEmailTasks();

        if (!tasks[threadId]) {
            tasks[threadId] = [];
        }

        // Avoid duplicates
        if (!tasks[threadId].find(t => t.id === task.id)) {
            tasks[threadId].push(task);
        }

        await this.setEmailTasks(tasks);
    }

    // ------------------------------------------------------------------------
    // Cleanup Methods
    // ------------------------------------------------------------------------

    /**
     * Remove old data that exceeds limits or TTL
     */
    async cleanupOldData(): Promise<void> {
        console.log('[Storage] Running cleanup...');

        // Clean old email tasks
        const tasks = await this.getEmailTasks();
        const cutoffDate = Date.now() - (DATA_LIMITS.EMAIL_TASKS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

        let removed = 0;
        const cleaned: Record<string, TaskMapping[]> = {};

        for (const [threadId, taskList] of Object.entries(tasks)) {
            // Keep if has any recent task
            cleaned[threadId] = taskList;
        }

        // Enforce max limit
        const entries = Object.entries(cleaned);
        if (entries.length > DATA_LIMITS.MAX_EMAIL_TASKS) {
            const sorted = entries.slice(0, DATA_LIMITS.MAX_EMAIL_TASKS);
            await this.set(STORAGE_KEYS.EMAIL_TASKS, Object.fromEntries(sorted));
            removed = entries.length - DATA_LIMITS.MAX_EMAIL_TASKS;
        }

        if (removed > 0) {
            console.log(`[Storage] Removed ${removed} old email task entries`);
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
storageService.initialize().catch(err => {
    console.error('[Storage] Initialization failed:', err);
});
