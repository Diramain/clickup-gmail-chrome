/**
 * Application Constants
 * Centralizes magic numbers and configuration values
 */

// ============================================================================
// API
// ============================================================================

export const API = {
    BASE_URL: 'https://api.clickup.com/api/v2',
    OAUTH_URL: 'https://app.clickup.com/api',
    TOKEN_URL: 'https://api.clickup.com/api/v2/oauth/token',
} as const;

// ============================================================================
// Timeouts (milliseconds)
// ============================================================================

export const TIMEOUTS = {
    /** Debounce delay for search inputs */
    SEARCH_DEBOUNCE: 400,

    /** Debounce delay for task search in modal */
    TASK_SEARCH_DEBOUNCE: 300,

    /** Debounce delay for DOM scanning */
    SCAN_DEBOUNCE: 100,

    /** Duration to show success/error toast notifications */
    TOAST_DURATION: 3000,

    /** Duration to show temporary button state changes */
    BUTTON_FEEDBACK: 2000,

    /** Interval for URL change detection */
    URL_CHECK_INTERVAL: 1000,

    /** Interval for inbox badge scanning */
    INBOX_SCAN_INTERVAL: 5000,
} as const;

// ============================================================================
// Limits
// ============================================================================

export const LIMITS = {
    /** Max task results in popup search */
    SEARCH_RESULTS_POPUP: 5,

    /** Max task results in modal search */
    SEARCH_RESULTS_MODAL: 10,

    /** Max list results in location search */
    LIST_RESULTS: 15,

    /** Max list results in popup quick create */
    LIST_RESULTS_POPUP: 8,

    /** Max time entries per day to display */
    TIME_ENTRIES_PER_DAY: 5,

    /** Days of time history to show */
    TIME_HISTORY_DAYS: 7,

    /** Max tasks in search cache */
    SEARCH_CACHE_SIZE: 50,

    /** Max tasks in task cache */
    TASK_CACHE_SIZE: 100,
} as const;

// ============================================================================
// Cache TTL (milliseconds)
// ============================================================================

export const CACHE_TTL = {
    /** How long to cache search results */
    SEARCH: 30 * 1000,  // 30 seconds

    /** How long to cache individual tasks */
    TASK: 60 * 1000,  // 60 seconds

    /** How long hierarchy cache is considered fresh */
    HIERARCHY: 5 * 60 * 1000,  // 5 minutes

    /** Bar age before considering it stale */
    BAR_STALE: 30 * 1000,  // 30 seconds

    /** Full hierarchy cache TTL */
    HIERARCHY_FULL: 24 * 60 * 60 * 1000,  // 24 hours

    /** Teams cache TTL */
    TEAMS: 7 * 24 * 60 * 60 * 1000,  // 7 days
} as const;

// ============================================================================
// Data Limits
// ============================================================================

export const DATA_LIMITS = {
    /** Maximum number of email-task mappings to store */
    MAX_EMAIL_TASKS: 1000,

    /** Maximum age of email-task mappings in days */
    EMAIL_TASKS_MAX_AGE_DAYS: 90,
} as const;

// ============================================================================
// Rate Limiting
// ============================================================================

export const RATE_LIMIT = {
    /** Minimum interval between search API calls */
    MIN_SEARCH_INTERVAL: 300,
} as const;

// ============================================================================
// Storage Keys
// ============================================================================

export const STORAGE_KEYS = {
    TOKEN: 'clickupToken',
    REFRESH_TOKEN: 'clickupRefreshToken',
    OAUTH_CONFIG: 'oauthConfig',
    DEFAULT_LIST: 'defaultList',
    EMAIL_TASKS: 'emailTaskMappings',
    TEAMS: 'cachedTeams',
    USER: 'cachedUser',
    HIERARCHY_CACHE: 'hierarchyCache',
    EMAIL_TASKS_SYNC: 'emailTasksSync',
    ENCRYPTION_KEY: 'encryptionKey',
    AUTO_START_TIMER: 'autoStartTimer',
    AUTO_STOP_TIMER: 'autoStopTimer',
    DRAFT_CLIENT_ID: 'draftClientId',
    DRAFT_CLIENT_SECRET: 'draftClientSecret',
} as const;

// ============================================================================
// UI
// ============================================================================

export const UI = {
    /** Default color for spaces without a color */
    DEFAULT_SPACE_COLOR: '#7B68EE',

    /** Minimum characters to trigger search */
    MIN_SEARCH_LENGTH: 2,

    /** Minimum characters to trigger task name search */
    MIN_TASK_SEARCH_LENGTH: 4,
} as const;
