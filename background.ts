import {
    ClickUpTask,
    ClickUpList,
    ClickUpFolder,
    ClickUpSpace,
    ClickUpTeam,
    ClickUpUser,
    ClickUpUserResponse,
    ClickUpTeamsResponse,
    ClickUpSpacesResponse,
    ClickUpFoldersResponse,
    ClickUpListsResponse,
    ExtensionMessage,
    CreateTaskPayload,
    EmailData,
    TimeEntry,
    ClickUpCustomField
} from './src/types/clickup';
import { ClickUpAPIWrapper, ClickUpRateGovernor, TokenRefreshCallback, type RateGovernorState } from './src/services/api.service';
import { getSecureOAuthConfig, saveSecureOAuthConfig, hasSecureOAuthConfig, getSecureToken, saveSecureToken, removeSecureToken } from './src/services/crypto.service';
import { Logger } from './src/logger';
import { validateExtensionMessage } from './src/message-security';
import {
    EMAIL_TASK_MAPPINGS_V2_KEY,
    SingleFlight,
    applyValidationToTask,
    classifyValidationError,
    commentsContainThreadId,
    escapeRegExp,
    isConfirmedThreadId,
    LINK_SCHEMA_VERSION,
    mergeThreadIdValue,
    migrateMappingsV1ToV2,
    nextHierarchyPreloadStatus,
    readMappingsWithFallback,
    runWithConcurrencyLimit,
    shouldAttemptHierarchyPreload,
    selectThreadIdCustomField,
    transitionLinkStatus,
    toVisibleLinkedTasks,
    type EmailTaskMappingsV2,
    type EmailTaskMappingV2,
    type HierarchyPreloadStatus,
    type LinkSource,
    type LinkValidationResult,
    type LinkValidationStatus,
} from './src/link-hardening';
import { isSyncProgressMessage, type SyncProgressMessage } from './src/sync-progress';
import {
    extractTaskIdCandidate,
    hasHighConfidenceTaskSearchResult,
    rankTaskSearchResults,
} from './src/task-search';
import { extractCurrentUserId } from './src/time-entry-history';

interface CreateTaskFullMessage {
    listId: string;
    taskData: CreateTaskPayload;
    emailData?: EmailData;
    attachWithFiles?: boolean;
    timeTracked?: number;
    teamId?: string;
}

interface AttachEmailMessage {
    taskId: string;
    emailData: EmailData;
}

const STORAGE_KEYS = {
    AUTH_TOKEN: 'clickupToken',
    REFRESH_TOKEN: 'clickupRefreshToken', // New key for refresh token
    OAUTH_CONFIG: 'oauthConfig', // New key for storing OAuth credentials
    PREFERRED_TEAM: 'preferredTeamId', // Replaces defaultList
    EMAIL_TASK_MAPPINGS: 'emailTaskMappings',
    EMAIL_TASK_MAPPINGS_V2: EMAIL_TASK_MAPPINGS_V2_KEY,
    CACHED_TEAMS: 'cachedTeams',
    CACHED_USER: 'cachedUser',
    CACHED_HIERARCHY: 'hierarchyCache', // Unified cache key
    HIERARCHY_PRELOAD_STATUS: 'hierarchyPreloadStatus',
    RATE_GOVERNOR_STATE: 'clickupRateGovernorState',
    DRAFT_CLIENT_ID: 'draftClientId',
    DRAFT_CLIENT_SECRET: 'draftClientSecret'
};

const EXPIRATION_TIME = 24 * 60 * 60 * 1000; // 24 hours
const TASK_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const TASK_SEARCH_MAX_PAGES = 50;
const TASK_SEARCH_PAGE_SIZE = 100;
const TASK_SEARCH_RESULT_LIMIT = 10;
const CURRENT_USER_VALIDATION_TTL_MS = 5 * 60 * 1000;
const RECENT_TIME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function emitSyncProgress(message: SyncProgressMessage): void {
    if (!isSyncProgressMessage(message)) return;
    void chrome.runtime.sendMessage(message).catch(() => undefined);
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

interface TaskSearchCache {
    tasks: Map<string, ClickUpTask>;
    nextPage: number;
    complete: boolean;
    expiresAt: number;
    inFlight?: Promise<void>;
}

const taskSearchCaches = new Map<string, TaskSearchCache>();

function getTaskSearchCache(teamId: string): TaskSearchCache {
    const current = taskSearchCaches.get(teamId);
    if (current && current.expiresAt > Date.now()) return current;

    const fresh: TaskSearchCache = {
        tasks: new Map(),
        nextPage: 0,
        complete: false,
        expiresAt: Date.now() + TASK_SEARCH_CACHE_TTL_MS,
    };
    taskSearchCaches.set(teamId, fresh);
    return fresh;
}

function addTasksToSearchCache(cache: TaskSearchCache, tasks: ClickUpTask[]): void {
    for (const task of tasks) {
        if (task?.id && task?.name) cache.tasks.set(task.id, task);
    }
    cache.expiresAt = Date.now() + TASK_SEARCH_CACHE_TTL_MS;
}

function seedTaskSearchCache(teamId: string, tasks: ClickUpTask[]): void {
    addTasksToSearchCache(getTaskSearchCache(teamId), tasks);
}

async function loadNextTaskSearchPage(teamId: string, cache: TaskSearchCache): Promise<void> {
    if (cache.complete) return;
    if (cache.inFlight) {
        await cache.inFlight;
        return;
    }

    const page = cache.nextPage;
    cache.inFlight = (async () => {
        const response = await clickupAPI!.getWorkspaceTasksPage(teamId, page);
        const tasks = response.tasks || [];
        addTasksToSearchCache(cache, tasks);
        cache.nextPage = page + 1;
        cache.complete = tasks.length < TASK_SEARCH_PAGE_SIZE || cache.nextPage >= TASK_SEARCH_MAX_PAGES;
    })();

    try {
        await cache.inFlight;
    } finally {
        cache.inFlight = undefined;
    }
}

interface HierarchyData {
    spaces: ClickUpSpace[];
    lists?: ClickUpList[];
}

let clickupAPI: ClickUpAPIWrapper | null = null;
let currentUserValidatedAt = 0;
let hierarchyCache: Record<string, CacheEntry<HierarchyData>> = {};
const hierarchyPreloadSingleFlight = new SingleFlight<string, number>();
let mappingWriteQueue: Promise<void> = Promise.resolve();
const customFieldUpdateQueues = new Map<string, Promise<void>>();
const HIERARCHY_FOLDER_CONCURRENCY = 3;

// Default badge state
const BADGE_STATES = {
    playing: { text: "▶", color: "#4CAF50" }, // Green
    stopped: { text: "", color: "#00000000" }, // Transparent/None
    paused: { text: "II", color: "#FF9800" }  // Orange
};

// Initialize
chrome.runtime.onInstalled.addListener(() => {
    Logger.info('EXTENSION_INSTALLED');
    chrome.storage.local.remove(STORAGE_KEYS.DRAFT_CLIENT_SECRET);

    // Create alarm for timer polling
    chrome.alarms.create('timer-poll', { periodInMinutes: 1 });
});

// Alarm listener for polling
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'timer-poll') {
        const store = await chrome.storage.local.get([STORAGE_KEYS.PREFERRED_TEAM, STORAGE_KEYS.CACHED_TEAMS]);
        let teamId = store[STORAGE_KEYS.PREFERRED_TEAM];

        if (!teamId && store[STORAGE_KEYS.CACHED_TEAMS]?.teams?.length > 0) {
            teamId = store[STORAGE_KEYS.CACHED_TEAMS].teams[0].id;
        }

        if (teamId) {
            await ensureAPI();
            try {
                const timer = await clickupAPI!.getRunningTimer(teamId);
                // Update badge based on timer state
                if (timer && (timer as any).data) { // Handle wrapped response
                    await updateTimerBadge('playing');
                } else if (timer) {
                    await updateTimerBadge('playing');
                } else {
                    await updateTimerBadge('stopped');
                }
            } catch (e) {
                Logger.error('TIMER_POLL_FAILED', e);
            }
        }
    }
});

// Initialize API wrapper
// Token refresh logic
async function refreshAccessToken(): Promise<{ success: boolean; token?: string }> {
    try {
        // SEC-C1: Use encrypted OAuth config
        const oauthConfig = await getSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG);
        const refreshToken = await getSecureToken(STORAGE_KEYS.REFRESH_TOKEN);

        if (!refreshToken || !oauthConfig) {
            Logger.warn('TOKEN_REFRESH_SKIPPED');
            return { success: false };
        }

        const response = await fetch('https://api.clickup.com/api/v2/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: oauthConfig.clientId,
                client_secret: oauthConfig.clientSecret,
                refresh_token: refreshToken
            })
        });

        if (!response.ok) {
            Logger.warn(`TOKEN_REFRESH_FAILED_${response.status}`);
            return { success: false };
        }

        const result = await response.json();
        const newToken = result.access_token;

        if (newToken) {
            Logger.info('TOKEN_REFRESHED');
            await saveSecureToken(STORAGE_KEYS.AUTH_TOKEN, newToken);
            // Should properly close over clickupAPI if possible, or reliance on wrapper updating itself if we pass callback?
            // The wrapper calls this, gets the token, and updates itself.
            return { success: true, token: newToken };
        }

        return { success: false };

    } catch (e) {
        Logger.error('TOKEN_REFRESH_ERROR', e);
        return { success: false };
    }
}

// Initialize API wrapper
async function initializeAPI() {
    const token = await getSecureToken(STORAGE_KEYS.AUTH_TOKEN);

    if (token) {
        const store = await chrome.storage.local.get(STORAGE_KEYS.RATE_GOVERNOR_STATE);
        const governor = new ClickUpRateGovernor(
            undefined,
            undefined,
            store[STORAGE_KEYS.RATE_GOVERNOR_STATE] as RateGovernorState | undefined,
            async (state) => {
                await chrome.storage.local.set({ [STORAGE_KEYS.RATE_GOVERNOR_STATE]: state });
            }
        );
        clickupAPI = new ClickUpAPIWrapper(token, governor);
        clickupAPI.setTokenRefreshCallback(refreshAccessToken);
    }
}

initializeAPI();
initializeLinkStorageShadow().catch((e) => {
    Logger.error('LINK_STORAGE_SHADOW_MIGRATION_SKIPPED', e);
});

async function initializeLinkStorageShadow(): Promise<void> {
    await updateEmailTaskMappings((mappings) => mappings, { schemaVersion: LINK_SCHEMA_VERSION });
}

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    const validation = validateExtensionMessage(message, sender, chrome.runtime.id);
    if (!validation.ok) {
        Logger.warn(`MESSAGE_REJECTED_${validation.code || 'UNKNOWN'}`);
        sendResponse({ success: false, error: validation.code || 'INVALID_MESSAGE' });
        return false;
    }

    Logger.info(`MESSAGE_${message.action}`);

    handleMessage(message, sender)
        .then(response => {
            // Serialize error if present
            if (response && response.error && response.error instanceof Error) {
                sendResponse({
                    success: false,
                    error: Logger.sanitizeError(response.error)
                });
            } else {
                sendResponse(response);
            }
        })
        .catch(error => {
            Logger.error('MESSAGE_HANDLER_ERROR', error);
            sendResponse({ success: false, error: Logger.sanitizeError(error) });
        });

    return true; // Keep channel open for async response
});

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender) {
    const { action, data } = message;

    switch (action) {
        case 'authenticate':
            try {
                // SEC-C1: Use encrypted OAuth config retrieval
                const config = await getSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG);

                if (!config || !config.clientId || !config.clientSecret) {
                    throw new Error('Missing OAuth configuration');
                }

                const redirectUri = chrome.identity.getRedirectURL();
                const authUrl = `https://app.clickup.com/api?client_id=${config.clientId}&redirect_uri=${redirectUri}&response_type=code`;

                const responseUrl = await chrome.identity.launchWebAuthFlow({
                    url: authUrl,
                    interactive: true
                });

                if (!responseUrl) throw new Error('Auth flow failed');

                const urlParams = new URL(responseUrl).searchParams;
                const code = urlParams.get('code');

                if (!code) throw new Error('No code returned');

                const tokenResponse = await fetch('https://api.clickup.com/api/v2/oauth/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                        code: code
                    })
                });

                if (!tokenResponse.ok) {
                    throw new Error(`Token exchange failed: ${tokenResponse.status}`);
                }

                const result = await tokenResponse.json();

                await saveSecureToken(STORAGE_KEYS.AUTH_TOKEN, result.access_token);

                if (result.refresh_token) {
                    await saveSecureToken(STORAGE_KEYS.REFRESH_TOKEN, result.refresh_token);
                }

                await chrome.storage.local.remove([
                    STORAGE_KEYS.DRAFT_CLIENT_ID,
                    STORAGE_KEYS.DRAFT_CLIENT_SECRET,
                    STORAGE_KEYS.CACHED_USER,
                ]);
                currentUserValidatedAt = 0;

                await initializeAPI();
                const user = await getCachedUser();

                return { success: true, user };
            } catch (e) {
                Logger.error('AUTH_FAILED', e);
                return { success: false, error: Logger.sanitizeError(e) };
            }

        case 'saveOAuthConfig':
            // SEC-C1: Use encrypted storage for OAuth config
            await saveSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG, data);
            await chrome.storage.local.remove([STORAGE_KEYS.DRAFT_CLIENT_ID, STORAGE_KEYS.DRAFT_CLIENT_SECRET]);
            if (!await hasSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG)) {
                throw new Error('OAuth configuration was not stored securely');
            }
            return { success: true };

        case 'testTokenRefresh': // New action for testing
            if (!clickupAPI) return { success: false, error: 'API not initialized' };
            try {
                // Force a refresh attempt if possible, or just log config
                // In a real scenario, we might invalidate the current token to force refresh on next call
                // For now, we'll just check if we have the config
                const storedConfig = await getSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG);
                if (!storedConfig) {
                    return { success: false, error: 'No OAuth config found' };
                }
                return { success: true, message: 'OAuth config present' };
            } catch (e: unknown) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }

        case 'logout':
            await removeSecureToken(STORAGE_KEYS.AUTH_TOKEN);
            await removeSecureToken(STORAGE_KEYS.REFRESH_TOKEN);
            await chrome.storage.local.remove([
                STORAGE_KEYS.OAUTH_CONFIG,
                STORAGE_KEYS.DRAFT_CLIENT_ID,
                STORAGE_KEYS.DRAFT_CLIENT_SECRET,
                STORAGE_KEYS.CACHED_USER,
                STORAGE_KEYS.CACHED_TEAMS,
            ]);
            clickupAPI = null;
            currentUserValidatedAt = 0;
            hierarchyCache = {};
            taskSearchCaches.clear();
            await chrome.action.setBadgeText({ text: '' });
            return { success: true };

        case 'checkAuth':
            await initializeAPI();
            return { authenticated: !!clickupAPI };

        case 'getStatus': // Combined status check
            try {
                await initializeAPI();
                const configured = await hasSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG);
                const user = clickupAPI ? await getCachedUser().catch(() => null) : null;
                return {
                    authenticated: !!clickupAPI && !!user,
                    configured,
                    user: user
                };
            } catch (e) {
                return { authenticated: false, configured: false, error: String(e) };
            }

        // DEV-H1: Functions moved to module level (lines 624+)

        case 'getTeams':
            return await getTeams();

        case 'getHierarchy':
            // Resolve teamId: arg > preferred > first cached
            let hTeamId = message.teamId || (data ? data.teamId : undefined);
            if (!hTeamId) {
                const store = await chrome.storage.local.get([STORAGE_KEYS.PREFERRED_TEAM, STORAGE_KEYS.CACHED_TEAMS]);
                hTeamId = store[STORAGE_KEYS.PREFERRED_TEAM] || store[STORAGE_KEYS.CACHED_TEAMS]?.teams?.[0]?.id;
            }
            if (!hTeamId) {
                return { spaces: [] }; // No team available
            }

            // Check cache first
            const cached = await getCachedHierarchy(hTeamId);
            if (cached) {
                return cached;
            }
            // Fallback: fetch spaces on-demand (no full preload)
            return { spaces: await getSpaces(hTeamId) };

        case 'getHierarchyCache':
            // Return entire cache for debugging or fast load
            const fullCache = await chrome.storage.local.get(STORAGE_KEYS.CACHED_HIERARCHY);
            return fullCache[STORAGE_KEYS.CACHED_HIERARCHY] || {};

        case 'preloadFullHierarchy':
            // Trigger full hierarchy fetch and wait for result
            const pTeamId = message.teamId || (data ? data.teamId : undefined);
            try {
                const listCount = await preloadHierarchy(pTeamId);
                return { success: listCount >= 0, listCount: Math.max(0, listCount) };
            } catch (e) {
                Logger.error('HIERARCHY_PRELOAD_MESSAGE_FAILED', e);
                return { success: false, listCount: 0 };
            }

        case 'getUser':
            return await getUser();

        case 'getSpaces':
            return await getSpaces(message.teamId || (data ? data.teamId : undefined));

        case 'getFolders':
            return await getFolders(message.spaceId || (data ? data.spaceId : undefined));

        case 'getLists':
            const listsFolderId = message.folderId || (data ? data.folderId : undefined);
            const listsSpaceId = message.spaceId || (data ? data.spaceId : undefined);
            return listsFolderId ? await getLists(listsFolderId) : await getFolderlessLists(listsSpaceId);

        case 'getFolderlessLists':
            return await getFolderlessLists(message.spaceId || (data ? data.spaceId : undefined));

        case 'getMembers':
            return await clickupAPI!.getListMembers(message.listId || (data ? data.listId : undefined));

        case 'getList':
            return await clickupAPI!.getList(message.listId || (data ? data.listId : undefined));

        case 'getEmailTasksSyncStatus':
            // Return persisted sync status
            const emailSyncData = await chrome.storage.local.get(['lastEmailSync', 'lastEmailSyncCount']);
            return {
                synced: !!emailSyncData.lastEmailSync,
                lastSync: emailSyncData.lastEmailSync,
                foundCount: emailSyncData.lastEmailSyncCount || 0
            };

        case 'createTask': // Action used by Gmail Button (Default List)
            return await createTaskFromEmail(message.emailData || data);

        case 'createTaskSimple': // Action used by Quick Create Form (Manual List Selection)
            return await createTaskSimple(data);



        // Interface definition removed from here

        case 'createTaskFull':
            // Modal sends flattened data, so we pass the whole message object
            return await createTaskFull(message as any);

        case 'savePreferredTeam':
            await chrome.storage.local.set({ [STORAGE_KEYS.PREFERRED_TEAM]: data.teamId });
            return { success: true };

        case 'getPreferredTeam':
            const prefData = await chrome.storage.local.get(STORAGE_KEYS.PREFERRED_TEAM);
            return { teamId: prefData[STORAGE_KEYS.PREFERRED_TEAM] };


        case 'attachToTask':
            // Modal sends taskId and emailData at message root, not in data
            return await attachEmailToTask({
                taskId: message.taskId || (data ? data.taskId : undefined),
                emailData: message.emailData || (data ? data.emailData : undefined)
            });

        case 'validateTask':
            // Verify if task exists and we have access
            const vTaskId = message.taskId || (data ? data.taskId : undefined);
            return await validateTask(vTaskId);

        case 'validateTaskLink':
            // Verify if task exists AND Thread ID is still linked
            const vlTaskId = message.taskId || (data ? data.taskId : undefined);
            const vlThreadId = message.threadId || (data ? data.threadId : undefined);
            return await validateTaskLink(vlTaskId, vlThreadId);

        case 'findLinkedTasks':
            return await findLinkedTasks(data.threadId);

        case 'syncEmailTasks':
            if (Number.isInteger(data.days)) {
                try {
                    return await syncEmailTasksByTime(data.days);
                } catch (error) {
                    emitSyncProgress({ action: 'syncProgress', scope: 'email', phase: 'error' });
                    throw error;
                }
            }
            throw new Error('Invalid sync parameters');

        case 'clearLocalData':
            return await clearLocalData(sender);

        case 'searchTasks':
            const sQuery = message.query || (data ? data.query : undefined);
            const sTeamId = message.teamId || (data ? data.teamId : undefined);
            return await searchTasks(sQuery, sTeamId);

        case 'getTaskById':
            const gTaskId = message.taskId || (data ? data.taskId : undefined);
            return await getTaskById(gTaskId);

        // Time Tracking
        case 'startTimer':
            const startRes = await clickupAPI!.startTimer(data.teamId, data.taskId);
            await updateTimerBadge('playing');
            return startRes;

        case 'stopTimer':
            const stopRes = await clickupAPI!.stopTimer(data.teamId);
            await updateTimerBadge('stopped');
            return stopRes;

        case 'getRunningTimer':
            const timer = await clickupAPI!.getRunningTimer(data.teamId);
            if (timer) {
                await updateTimerBadge('playing');
            } else {
                await updateTimerBadge('stopped');
            }
            return timer;

        case 'createTimeEntry':
            // Kept for backward compatibility if entry object is used
            return await clickupAPI!.createTimeEntry(
                data.teamId,
                data.entry?.tid || data.taskId,
                data.entry?.duration || data.duration,
                data.entry?.start || data.start
            );

        case 'addTimeEntry':
            return await clickupAPI!.createTimeEntry(
                data.teamId,
                data.taskId,
                data.duration,
                data.start
            );

        case 'getTimeEntries':
            const currentUserId = await getValidatedCurrentUserId();
            if (!currentUserId) throw new Error('CURRENT_USER_UNAVAILABLE');
            const recentEndDate = Date.now();
            return await clickupAPI!.getTimeEntries(
                data.teamId,
                recentEndDate - RECENT_TIME_WINDOW_MS,
                recentEndDate,
                currentUserId
            );

        case 'updateTimerBadge':
            await updateTimerBadge(data.state);
            return { success: true };

        default:
            throw new Error(`Unknown action: ${action}`);
    }
}

async function ensureAPI() {
    if (!clickupAPI) {
        await initializeAPI();
        if (!clickupAPI) throw new Error('Not authenticated');
    }
}

// ... (Rest of fetch functions: getTeams, getSpaces, etc. - ensure they use caching or standard calls)

async function getCachedUser() {
    const cache = await chrome.storage.local.get(STORAGE_KEYS.CACHED_USER);
    if (cache[STORAGE_KEYS.CACHED_USER]) {
        return cache[STORAGE_KEYS.CACHED_USER];
    }
    await ensureAPI();
    const user = await clickupAPI!.getUser();
    await chrome.storage.local.set({ [STORAGE_KEYS.CACHED_USER]: user });
    return user;
}

async function getValidatedCurrentUserId(): Promise<number | null> {
    await ensureAPI();
    const now = Date.now();

    if (now - currentUserValidatedAt >= CURRENT_USER_VALIDATION_TTL_MS) {
        const freshUser = await clickupAPI!.getUser();
        const freshUserId = extractCurrentUserId(freshUser);
        if (!freshUserId) return null;
        await chrome.storage.local.set({ [STORAGE_KEYS.CACHED_USER]: freshUser });
        currentUserValidatedAt = now;
        return freshUserId;
    }

    return extractCurrentUserId(await getCachedUser());
}

async function getUser() {
    return await getCachedUser();
}

async function getTeams() {
    const cache = await chrome.storage.local.get(STORAGE_KEYS.CACHED_TEAMS);
    if (cache[STORAGE_KEYS.CACHED_TEAMS]) {
        return cache[STORAGE_KEYS.CACHED_TEAMS];
    }
    await ensureAPI();
    const teams = await clickupAPI!.getTeams();
    await chrome.storage.local.set({ [STORAGE_KEYS.CACHED_TEAMS]: teams });
    return teams;
}


async function getSpaces(teamId: string) {
    await ensureAPI();
    return await clickupAPI!.getSpaces(teamId);
}

async function getFolders(spaceId: string) {
    await ensureAPI();
    return await clickupAPI!.getFolders(spaceId);
}

async function getLists(folderId: string) {
    await ensureAPI();
    return await clickupAPI!.getLists(folderId);
}

async function getFolderlessLists(spaceId: string) {
    await ensureAPI();
    return await clickupAPI!.getFolderlessLists(spaceId);
}

// ============================================================================
// Hierarchy Caching Logic (Preload)
// ============================================================================

async function preloadHierarchy(teamId?: string): Promise<number> {
    await ensureAPI();

    // Resolve Team ID: Arg > Preferred > First Cached
    if (!teamId) {
        const store = await chrome.storage.local.get([STORAGE_KEYS.PREFERRED_TEAM, STORAGE_KEYS.CACHED_TEAMS]);
        if (store[STORAGE_KEYS.PREFERRED_TEAM]) {
            teamId = store[STORAGE_KEYS.PREFERRED_TEAM];
        } else if (store[STORAGE_KEYS.CACHED_TEAMS]?.teams?.length > 0) {
            teamId = store[STORAGE_KEYS.CACHED_TEAMS].teams[0].id;
        }
    }

    if (!teamId) {
        Logger.warn('HIERARCHY_PRELOAD_NO_TEAM');
        return 0;
    }

    return hierarchyPreloadSingleFlight.run(teamId, () => preloadHierarchyForTeamWithCooldown(teamId!));
}

async function preloadHierarchyForTeamWithCooldown(teamId: string): Promise<number> {
    const statusStore = await chrome.storage.local.get(STORAGE_KEYS.HIERARCHY_PRELOAD_STATUS);
    const allStatuses = (statusStore[STORAGE_KEYS.HIERARCHY_PRELOAD_STATUS] || {}) as Record<string, HierarchyPreloadStatus>;
    const teamStatus = allStatuses[teamId];
    if (!shouldAttemptHierarchyPreload(teamStatus)) {
        Logger.warn('HIERARCHY_PRELOAD_COOLDOWN');
        return 0;
    }

    return preloadHierarchyForTeam(teamId);
}

async function preloadHierarchyForTeam(teamId: string): Promise<number> {
    await ensureAPI();

    Logger.info('HIERARCHY_PRELOAD_START');
    emitSyncProgress({ action: 'syncProgress', scope: 'hierarchy', phase: 'starting' });
    await setHierarchyPreloadStatus(teamId, 'in_progress');

    try {
        const hierarchy: any = { spaces: [] };
        const spacesRes = await clickupAPI!.getSpaces(teamId);
        let totalListCount = 0;
        const totalSpaces = spacesRes.spaces.length;

        Logger.info(`HIERARCHY_SPACES_COUNT_${totalSpaces}`);
        emitSyncProgress({
            action: 'syncProgress',
            scope: 'hierarchy',
            phase: 'fetching',
            total: totalSpaces,
        });

        for (let i = 0; i < spacesRes.spaces.length; i++) {
            const space = spacesRes.spaces[i];
            const spaceData: any = { ...space, folders: [], lists: [] };

            Logger.info(`HIERARCHY_SPACE_PROGRESS_${i + 1}_OF_${totalSpaces}`);

            // Parallelize fetching folders and folderless lists
            const [foldersRes, listsRes] = await Promise.all([
                clickupAPI!.getFolders(space.id),
                clickupAPI!.getFolderlessLists(space.id)
            ]);

            spaceData.lists = listsRes.lists;
            totalListCount += listsRes.lists.length;

            // Fetch lists for each folder
            // To avoid rate limits, we might want to batch this or do it sequentially if needed
            // For now, simple Promise.all
            const foldersWithLists = await runWithConcurrencyLimit(foldersRes.folders, HIERARCHY_FOLDER_CONCURRENCY, async (folder) => {
                const fLists = await clickupAPI!.getLists(folder.id);
                return { ...folder, lists: fLists.lists };
            });
            spaceData.folders = foldersWithLists;

            // Count lists inside folders
            for (const folder of foldersWithLists) {
                totalListCount += folder.lists.length;
            }

            Logger.info(`HIERARCHY_COUNTS_LISTS_${totalListCount}_FOLDERS_${foldersRes.folders.length}`);
            emitSyncProgress({
                action: 'syncProgress',
                scope: 'hierarchy',
                phase: 'processing',
                current: i + 1,
                total: totalSpaces,
                listCount: totalListCount,
            });

            hierarchy.spaces.push(spaceData);
        }

        // Save to storage
        // Structure: hierarchyCache: { [teamId]: { data: ..., timestamp: ... } }
        const currentCache = await chrome.storage.local.get(STORAGE_KEYS.CACHED_HIERARCHY);
        const cache = currentCache[STORAGE_KEYS.CACHED_HIERARCHY] || {};
        cache[teamId] = {
            data: hierarchy,
            timestamp: Date.now()
        };

        await chrome.storage.local.set({ [STORAGE_KEYS.CACHED_HIERARCHY]: cache });
        await setHierarchyPreloadStatus(teamId, 'success');
        Logger.info(`HIERARCHY_PRELOAD_COMPLETE_${totalListCount}`);
        emitSyncProgress({
            action: 'syncProgress',
            scope: 'hierarchy',
            phase: 'complete',
            listCount: totalListCount,
        });

        return totalListCount;

    } catch (e) {
        Logger.error('HIERARCHY_PRELOAD_FAILED', e);
        await setHierarchyPreloadStatus(teamId, 'failed');
        emitSyncProgress({ action: 'syncProgress', scope: 'hierarchy', phase: 'error' });
        return -1;
    }
}

async function setHierarchyPreloadStatus(teamId: string, status: HierarchyPreloadStatus['status']): Promise<void> {
    const store = await chrome.storage.local.get(STORAGE_KEYS.HIERARCHY_PRELOAD_STATUS);
    const statuses = (store[STORAGE_KEYS.HIERARCHY_PRELOAD_STATUS] || {}) as Record<string, HierarchyPreloadStatus>;
    statuses[teamId] = nextHierarchyPreloadStatus(statuses[teamId], status);
    await chrome.storage.local.set({ [STORAGE_KEYS.HIERARCHY_PRELOAD_STATUS]: statuses });
}

async function getCachedHierarchy(teamId: string) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.CACHED_HIERARCHY);
    const cache = data[STORAGE_KEYS.CACHED_HIERARCHY];
    if (cache && cache[teamId]) {
        const entry = cache[teamId];
        // Valid if < 24 hours
        if (Date.now() - entry.timestamp < EXPIRATION_TIME) {
            return entry.data;
        }
    }
    return null;
}

// ============================================================================
// Task Linking Logic
// ============================================================================

const EMAIL_REGEX = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/;

// Check if a task is linked to this email thread
// Check if a task is linked to this email thread
function isTaskLinked(task: any, threadId: string, customFieldName: string = 'gmail thread id'): boolean {
    const extractedId = extractThreadId(task, customFieldName);
    return extractedId === threadId;
}

function extractThreadId(task: any, customFieldName: string): string | null {
    // 1. Check for Configured Custom Field
    if (task.custom_fields && Array.isArray(task.custom_fields)) {
        const threadIdField = task.custom_fields.find((field: any) =>
            field.name.toLowerCase() === customFieldName && field.value
        );
        if (threadIdField) {
            return threadIdField.value; // It's a text field
        }
    }

    // Pattern: Thread ID: xxxxxxxxxxxx or threadId=xxxxxxxxxxxx
    const patterns = [
        /_Thread ID: ([a-f0-9]+)_/i,
        /Thread ID: ([a-f0-9]+)/i,
        /threadId=([a-f0-9]+)/i,
        /inbox\/([a-f0-9]+)/i
    ];

    // Check task name
    for (const pattern of patterns) {
        const match = task.name?.match(pattern);
        if (match) return match[1];
    }

    // Check description
    for (const pattern of patterns) {
        const match = task.description?.match(pattern);
        if (match) return match[1];
    }

    // Check text_content
    for (const pattern of patterns) {
        const match = task.text_content?.match(pattern);
        if (match) return match[1];
    }

    return null;
}

async function findLinkedTasks(threadId: string): Promise<ClickUpTask[]> {
    if (!isConfirmedThreadId(threadId)) return [];
    const mappings = await getEmailTaskMappingsForRead();
    return toVisibleLinkedTasks(mappings[threadId] || []).map(task => ({
        id: task.id,
        name: task.name,
        url: task.url,
        status: { status: task.status || 'unknown' } as any,
    } as ClickUpTask));
}

async function getEmailTaskMappingsForRead(): Promise<EmailTaskMappingsV2> {
    const store = await chrome.storage.local.get([STORAGE_KEYS.EMAIL_TASK_MAPPINGS, STORAGE_KEYS.EMAIL_TASK_MAPPINGS_V2]);
    return readMappingsWithFallback(
        store[STORAGE_KEYS.EMAIL_TASK_MAPPINGS_V2] || {},
        store[STORAGE_KEYS.EMAIL_TASK_MAPPINGS] || {}
    );
}

async function updateEmailTaskMappings(
    mutator: (mappings: EmailTaskMappingsV2) => EmailTaskMappingsV2 | void,
    extraWrites: Record<string, unknown> = {}
): Promise<EmailTaskMappingsV2> {
    let updated: EmailTaskMappingsV2 = {};
    const next = mappingWriteQueue.then(async () => {
        const store = await chrome.storage.local.get([STORAGE_KEYS.EMAIL_TASK_MAPPINGS, STORAGE_KEYS.EMAIL_TASK_MAPPINGS_V2, 'schemaVersion']);
        const current = migrateMappingsV1ToV2(
            store[STORAGE_KEYS.EMAIL_TASK_MAPPINGS] || {},
            store[STORAGE_KEYS.EMAIL_TASK_MAPPINGS_V2] || {}
        );
        updated = mutator(current) || current;
        await chrome.storage.local.set({
            [STORAGE_KEYS.EMAIL_TASK_MAPPINGS_V2]: updated,
            ...extraWrites,
            schemaVersion: resolveSchemaVersion(store.schemaVersion, extraWrites.schemaVersion),
        });
    });

    mappingWriteQueue = next.catch(() => undefined);
    await next;
    return updated;
}

function safeSchemaVersion(value: unknown): number {
    const version = Number(value);
    return Number.isFinite(version) && version >= 0 ? Math.floor(version) : 0;
}

function resolveSchemaVersion(stored: unknown, extra: unknown = 0): number {
    return Math.max(safeSchemaVersion(stored), LINK_SCHEMA_VERSION, safeSchemaVersion(extra));
}

async function clearLocalData(sender: chrome.runtime.MessageSender): Promise<{ success: boolean }> {
    if (sender.id !== chrome.runtime.id || !(sender.url || '').startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
        throw new Error('clearLocalData is extension-only');
    }

    const next = mappingWriteQueue.then(async () => {
        const store = await chrome.storage.local.get('schemaVersion');
        const schemaVersion = resolveSchemaVersion(store.schemaVersion);
        await chrome.storage.local.remove([
            STORAGE_KEYS.EMAIL_TASK_MAPPINGS,
            STORAGE_KEYS.EMAIL_TASK_MAPPINGS_V2,
            'lastEmailSync',
            'lastEmailSyncCount',
            STORAGE_KEYS.CACHED_HIERARCHY,
            STORAGE_KEYS.HIERARCHY_PRELOAD_STATUS,
            STORAGE_KEYS.CACHED_TEAMS,
            STORAGE_KEYS.CACHED_USER,
        ]);
        await chrome.storage.local.set({
            [STORAGE_KEYS.EMAIL_TASK_MAPPINGS_V2]: {},
            schemaVersion,
        });
        hierarchyCache = {};
    });

    mappingWriteQueue = next.catch(() => undefined);
    await next;
    return { success: true };
}

async function syncEmailTasksByTime(days: number): Promise<{ success: boolean; foundCount: number }> {
    await ensureAPI();
    const store = await chrome.storage.local.get([STORAGE_KEYS.CACHED_TEAMS, STORAGE_KEYS.PREFERRED_TEAM]);
    let teamId: string | undefined = store[STORAGE_KEYS.PREFERRED_TEAM];

    // Try to get teamId from various sources
    if (!teamId && store[STORAGE_KEYS.CACHED_TEAMS]?.teams?.length > 0) {
        teamId = store[STORAGE_KEYS.CACHED_TEAMS].teams[0].id;
    }

    if (!teamId) throw new Error('No team found');

    const dateFrom = Date.now() - (days * 24 * 60 * 60 * 1000);
    Logger.info('EMAIL_SYNC_START');
    emitSyncProgress({ action: 'syncProgress', scope: 'email', phase: 'starting' });

    // Use paginated method to get ALL tasks, not just first 100
    const tasks = await clickupAPI!.getAllTasksSince(teamId, dateFrom, (progress) => {
        emitSyncProgress({
            action: 'syncProgress',
            scope: 'email',
            phase: 'fetching',
            current: progress.page,
            processed: progress.totalFetched,
        });
    });
    const totalTasks = tasks.length;
    seedTaskSearchCache(teamId, tasks);
    Logger.info(`EMAIL_SYNC_TASK_COUNT_${totalTasks}`);

    // Get configured settings
    const settings = await chrome.storage.local.get(['threadIdField', 'useCustomFieldForThreadId']);
    const customFieldName = (settings.threadIdField || 'Gmail Thread ID').trim();
    const useCustomField = settings.useCustomFieldForThreadId !== false; // Default: true

    Logger.info(`EMAIL_SYNC_MODE_${useCustomField ? 'CUSTOM_FIELD' : 'DESCRIPTION'}`);

    let foundCount = 0;
    const foundEntries: Array<{ threadId: string; entry: EmailTaskMappingV2 }> = [];

    // Patterns to find Thread ID in description/text_content
    const threadIdPatterns = [
        /\*\*Thread ID:\*\*\s*([a-f0-9]+)/i,  // **Thread ID:** xxx
        /Thread ID:\s*([a-f0-9]+)/i,           // Thread ID: xxx
        /threadId=([a-f0-9]+)/i,               // threadId=xxx
        /inbox\/([a-f0-9]+)/i                  // Gmail URL pattern
    ];

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        let threadIdValue: string | null = null;
        let customFieldId: string | undefined;

        if (useCustomField) {
            // Toggle ON: Search in Custom Field (supports multiple Thread IDs separated by comma)
            if (task.custom_fields && Array.isArray(task.custom_fields)) {
                const threadIdField = selectThreadIdCustomField(task.custom_fields as any[], undefined, customFieldName);
                if (threadIdField) {
                    customFieldId = threadIdField.id;
                    const rawThreadIdValue = threadIdField.value || threadIdField.text_value || null;
                    threadIdValue = typeof rawThreadIdValue === 'string' ? rawThreadIdValue : null;
                }
            }
        } else {
            // Toggle OFF: Search in Description/text_content
            const searchText = (task.description || '') + ' ' + (task.text_content || '');
            for (const pattern of threadIdPatterns) {
                const match = searchText.match(pattern);
                if (match) {
                    threadIdValue = match[1];
                    break;
                }
            }
        }

        if (threadIdValue && typeof threadIdValue === 'string' && threadIdValue.length > 0) {
            // Split by comma to support multiple Thread IDs
            const threadIds = threadIdValue.split(',').map(id => id.trim()).filter(isConfirmedThreadId);

            for (const threadId of threadIds) {
                foundCount++;
                Logger.info('EMAIL_SYNC_LINK_FOUND');

                // Add to mapping
                const entry: EmailTaskMappingV2 = {
                    id: task.id,
                    name: task.name,
                    url: task.url,
                    status: task.status?.status || 'unknown',
                    linkStatus: 'linked' as const,
                    linkSource: useCustomField ? 'custom_field' as const : 'description' as const,
                    customFieldId,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    failureCount: 0,
                };

                foundEntries.push({ threadId, entry });
            }
        }

        // Log progress every 100 tasks
        if ((i + 1) % 100 === 0 || i === totalTasks - 1) {
            Logger.info(`EMAIL_SYNC_PROGRESS_${i + 1}_OF_${totalTasks}_FOUND_${foundCount}`);
            emitSyncProgress({
                action: 'syncProgress',
                scope: 'email',
                phase: 'processing',
                current: i + 1,
                total: totalTasks,
                found: foundCount,
            });
        }
    }

    Logger.info(`EMAIL_SYNC_COMPLETE_SCANNED_${totalTasks}_FOUND_${foundCount}`);

    await updateEmailTaskMappings((mappings) => {
        for (const { threadId, entry } of foundEntries) {
            const current = mappings[threadId] || [];
            const existing = current.find(task => task.id === entry.id);
            if (existing) {
                existing.name = entry.name;
                existing.url = entry.url;
                existing.status = entry.status;
                existing.linkStatus = 'linked';
                existing.linkSource = entry.linkSource;
                existing.customFieldId = entry.customFieldId || existing.customFieldId;
                existing.updatedAt = Date.now();
                existing.failureCount = 0;
            } else {
                current.push(entry);
                mappings[threadId] = current;
            }
        }
    }, {
        'lastEmailSync': Date.now(),
        'lastEmailSyncCount': foundCount,
    });

    emitSyncProgress({
        action: 'syncProgress',
        scope: 'email',
        phase: 'complete',
        processed: totalTasks,
        found: foundCount,
    });

    return { success: true, foundCount };
}

interface SaveEmailTaskMappingOptions {
    linkStatus?: LinkValidationStatus;
    linkSource?: LinkSource;
    customFieldId?: string;
}

async function saveEmailTaskMapping(threadId: string, task: ClickUpTask, options: SaveEmailTaskMappingOptions = {}): Promise<EmailTaskMappingV2 | null> {
    if (!isConfirmedThreadId(threadId)) return null;
    let record: EmailTaskMappingV2 | null = null;

    await updateEmailTaskMappings((mappings) => {
        const current = mappings[threadId] || [];
        const existing = current.find((t: any) => t.id === task.id);
        const now = Date.now();
        const linkStatus = options.linkStatus || 'unverified';

        if (existing) {
            existing.name = task.name;
            existing.url = task.url;
            existing.status = task.status.status;
            existing.linkStatus = linkStatus;
            existing.linkSource = options.linkSource || existing.linkSource || 'unknown';
            existing.customFieldId = options.customFieldId || existing.customFieldId;
            existing.updatedAt = now;
            record = existing;
        } else {
            record = {
                id: task.id,
                name: task.name,
                url: task.url,
                status: task.status.status,
                linkStatus,
                linkSource: options.linkSource || 'unknown',
                customFieldId: options.customFieldId,
                createdAt: now,
                updatedAt: now,
                failureCount: 0,
            };
            current.push(record);
            mappings[threadId] = current;
        }
    });
    return record;
}

async function getStoredTaskMapping(threadId: string, taskId: string) {
    const mappings = await getEmailTaskMappingsForRead();
    return (mappings[threadId] || []).find(task => task.id === taskId) || null;
}

async function appendThreadIdToCustomFieldSerialized(
    taskId: string,
    fieldId: string,
    threadId: string,
    configuredFieldName: string
): Promise<boolean> {
    const previous = customFieldUpdateQueues.get(taskId) || Promise.resolve();
    let confirmed = false;

    const next = previous.then(async () => {
        const freshTask = await clickupAPI!.getTask(taskId);
        const field = selectThreadIdCustomField(freshTask.custom_fields as any[], fieldId, configuredFieldName);
        if (!field?.id) {
            Logger.warn('LINK_FIELD_NOT_FOUND');
            confirmed = false;
            return;
        }

        const existingValue = field.value || field.text_value || '';
        const newValue = mergeThreadIdValue(existingValue, threadId);
        await clickupAPI!.setCustomFieldValue(taskId, field.id, newValue);
        confirmed = true;
    });

    customFieldUpdateQueues.set(taskId, next.catch(() => undefined));
    await next;
    return confirmed;
}

// ... helper functions for searching tasks ...

async function searchTasks(query: string, teamId?: string) {
    await ensureAPI();

    // Resolve Team ID
    if (!teamId) {
        const store = await chrome.storage.local.get([STORAGE_KEYS.PREFERRED_TEAM, STORAGE_KEYS.CACHED_TEAMS]);
        if (store[STORAGE_KEYS.PREFERRED_TEAM]) {
            teamId = store[STORAGE_KEYS.PREFERRED_TEAM];
        } else if (store[STORAGE_KEYS.CACHED_TEAMS]?.teams?.length > 0) {
            teamId = store[STORAGE_KEYS.CACHED_TEAMS].teams[0].id;
        }
    }

    if (!teamId) return { tasks: [] };

    let cleanQuery = query.trim();

    // Truncate to avoid 413 or API errors with massive inputs
    if (cleanQuery.length > 100) {
        cleanQuery = cleanQuery.substring(0, 100);
    }

    // 1. Preserve the fast direct lookup for an exact ID, #ID or ClickUp task URL.
    const taskId = extractTaskIdCandidate(cleanQuery);
    if (taskId) {
        try {
            const task = await clickupAPI!.getTask(taskId);
            if (task && task.id) {
                seedTaskSearchCache(teamId, [task]);
                return { tasks: [task] };
            }
        } catch (e) {
            // Ignore error, proceed to search
        }
    }

    // 2. The team task endpoint does not provide reliable title search. Build a
    // bounded, ephemeral in-memory index and return only ID/title matches.
    try {
        const cache = getTaskSearchCache(teamId);
        let matches = rankTaskSearchResults([...cache.tasks.values()], cleanQuery, TASK_SEARCH_RESULT_LIMIT);

        while (!cache.complete
            && matches.length < TASK_SEARCH_RESULT_LIMIT
            && !hasHighConfidenceTaskSearchResult(matches, cleanQuery)) {
            await loadNextTaskSearchPage(teamId, cache);
            matches = rankTaskSearchResults([...cache.tasks.values()], cleanQuery, TASK_SEARCH_RESULT_LIMIT);
        }

        return { tasks: matches };
    } catch (e) {
        Logger.error('SEARCH_FAILED', e);
        return { tasks: [] };
    }
}

async function getTaskById(taskId: string) {
    await ensureAPI();
    return await clickupAPI!.getTask(taskId);
}

async function validateTask(taskId: string): Promise<LinkValidationResult> {
    await ensureAPI();
    try {
        const task = await clickupAPI!.getTask(taskId);
        return { status: 'linked', valid: true, linked: true, task };
    } catch (e: any) {
        return classifyValidationError(e?.status, e);
    }
}

/**
 * Validate that a specific Thread ID is still linked to a task
 * Checks either custom field or description based on toggle setting
 */
async function validateTaskLink(taskId: string, threadId: string): Promise<LinkValidationResult> {
    await ensureAPI();

    try {
        if (!isConfirmedThreadId(threadId)) return { status: 'unverified', valid: false, linked: false, error: 'invalid_thread_id' };
        const task = await clickupAPI!.getTask(taskId);

        // Get settings
        const settings = await chrome.storage.local.get(['threadIdField', 'useCustomFieldForThreadId']);
        const customFieldName = (settings.threadIdField || 'Gmail Thread ID').trim();
        const useCustomField = settings.useCustomFieldForThreadId !== false;
        const storedMapping = await getStoredTaskMapping(threadId, taskId);

        let isLinked = false;

        if (storedMapping?.linkSource === 'comment') {
            try {
                const comments = await clickupAPI!.getTaskComments(taskId);
                isLinked = commentsContainThreadId(comments, threadId);
            } catch (e: any) {
                const classified = classifyValidationError(e?.status, e);
                if (['auth_error', 'rate_limited', 'transient_error', 'unknown_error'].includes(classified.status)) return classified;
            }
        } else if (useCustomField) {
            // Check custom field (supports multiple Thread IDs separated by comma)
            if (task.custom_fields && Array.isArray(task.custom_fields)) {
                const field = selectThreadIdCustomField(task.custom_fields as any[], storedMapping?.customFieldId, customFieldName);
                const rawFieldValue = field?.value || field?.text_value || '';
                const fieldValue = typeof rawFieldValue === 'string' ? rawFieldValue : String(rawFieldValue || '');
                // Split by comma and check if threadId is in the list
                const threadIds = fieldValue.split(',').map((id: string) => id.trim());
                isLinked = threadIds.includes(threadId);
            }
        } else {
            // Check description/text_content for Thread ID pattern
            const searchText = (task.description || '') + ' ' + (task.text_content || '');
            const escapedThreadId = escapeRegExp(threadId);
            const patterns = [
                new RegExp(`\\*\\*Thread ID:\\*\\*\\s*${escapedThreadId}`, 'i'),
                new RegExp(`Thread ID:\\s*${escapedThreadId}`, 'i'),
                new RegExp(`inbox/${escapedThreadId}`, 'i')
            ];
            isLinked = patterns.some(p => p.test(searchText));
        }

        Logger.info(`VALIDATE_TASK_LINK_${isLinked ? 'LINKED' : 'UNLINKED'}`);
        const result: LinkValidationResult = { status: isLinked ? 'linked' : 'unlinked', valid: true, linked: isLinked, task };
        const linkRecord = await applyValidationResultToMapping(threadId, taskId, result, task);
        return { ...result, linkRecord } as LinkValidationResult & { linkRecord?: EmailTaskMappingV2 };
    } catch (e: any) {
        const result = classifyValidationError(e?.status, e);
        const linkRecord = await applyValidationResultToMapping(threadId, taskId, result);
        return { ...result, linkRecord } as LinkValidationResult & { linkRecord?: EmailTaskMappingV2 };
    }
}

async function applyValidationResultToMapping(threadId: string, taskId: string, result: LinkValidationResult, freshTask?: ClickUpTask): Promise<EmailTaskMappingV2 | null> {
    if (!isConfirmedThreadId(threadId)) return null;
    let updatedRecord: EmailTaskMappingV2 | null = null;
    await updateEmailTaskMappings((mappings) => {
        const current = mappings[threadId] || [];
        const existing = current.find(task => task.id === taskId);
        if (!existing) return;
        if (freshTask) {
            existing.name = freshTask.name || existing.name;
            existing.url = freshTask.url || existing.url;
            existing.status = freshTask.status?.status || existing.status;
        }
        updatedRecord = applyValidationToTask(existing, result);
        const index = current.findIndex(task => task.id === taskId);
        if (index >= 0) current[index] = updatedRecord;
        mappings[threadId] = current;
    });
    return updatedRecord;
}

async function createTaskSimple(data: { listId: string; name: string; description: string; assignees?: number[]; priority?: number }): Promise<ClickUpTask> {
    await ensureAPI();

    const taskData: CreateTaskPayload = {
        name: data.name,
        description: data.description,
        assignees: data.assignees,
        priority: data.priority
    };

    return await clickupAPI!.createTask(data.listId, taskData);
}

async function updateTimerBadge(state: 'playing' | 'stopped' | 'paused'): Promise<void> {
    const badgeState = BADGE_STATES[state];
    await chrome.action.setBadgeText({ text: badgeState.text });
    await chrome.action.setBadgeBackgroundColor({ color: badgeState.color });
}

// ============================================================================
// Task Creation Functions
// ============================================================================

async function createTaskFromEmail(emailData: EmailData): Promise<ClickUpTask> {
    await ensureAPI();
    // With Default List removed, this function requires a list target.
    throw new Error('Usá el formulario de tarea para crear tareas.');
}

async function attachEmailToTask(data: AttachEmailMessage): Promise<ClickUpTask> {
    if (data.emailData?.html && data.emailData.htmlSanitized !== true) {
        throw new Error('El HTML del email debe estar sanitizado antes de adjuntarlo.');
    }
    await ensureAPI();

    const { taskId, emailData } = data;
    const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${emailData.threadId}`;

    // First get the task to know its list
    const task = await clickupAPI!.getTask(taskId);

    // Get configured Custom Field Name for Thread ID
    const settings = await chrome.storage.local.get(['threadIdField', 'useCustomFieldForThreadId']);
    const customFieldName = (settings.threadIdField || 'Gmail Thread ID').trim();
    const useCustomField = settings.useCustomFieldForThreadId !== false; // Default: true
    let linkConfirmed = false;
    let linkSource: LinkSource = 'unknown';
    let customFieldId: string | undefined;

    if (emailData.threadId) {
        await saveEmailTaskMapping(emailData.threadId, task, { linkStatus: 'pending', linkSource: 'unknown' });
    }

    // Save Thread ID based on toggle setting
    if (useCustomField && emailData.threadId && task.list?.id) {
        // Toggle ON: Save to Custom Field (supports multiple Thread IDs separated by comma)
        try {
            const customFields = await clickupAPI!.getAccessibleCustomFields(task.list.id);
            const threadIdField = selectThreadIdCustomField(customFields.fields as any[], undefined, customFieldName);

            if (threadIdField) {
                customFieldId = threadIdField.id;
                linkConfirmed = await appendThreadIdToCustomFieldSerialized(taskId, threadIdField.id!, emailData.threadId, customFieldName);
                linkSource = linkConfirmed ? 'custom_field' : 'unknown';
                Logger.info(`LINK_CUSTOM_FIELD_${linkConfirmed ? 'CONFIRMED' : 'UNCONFIRMED'}`);
            } else {
                Logger.warn('LINK_FIELD_NOT_FOUND');
            }
        } catch (e) {
            Logger.warn('LINK_CUSTOM_FIELD_FAILED');
        }
    } else if (!useCustomField && emailData.threadId) {
        // Toggle OFF: Save to Description via Comment (can't edit task description directly via API easily)
        // We'll add thread ID in a structured comment that can be searched
        const threadIdComment = `📎 **Thread ID:** ${emailData.threadId}`;
        try {
            await clickupAPI!.addComment(taskId, threadIdComment);
            linkConfirmed = true;
            linkSource = 'comment';
            Logger.info('LINK_COMMENT_CONFIRMED');
        } catch (e) {
            Logger.warn('LINK_COMMENT_FAILED');
        }
    }

    if (emailData.threadId) {
        await saveEmailTaskMapping(emailData.threadId, task, {
            linkStatus: transitionLinkStatus('pending', linkConfirmed),
            linkSource,
            customFieldId,
        });
    }

    // Add comment with email link
    const commentText = `📧 **Email adjunto:** ${emailData.subject}\nDe: ${emailData.from}\n\n🔗 [Ver email original en Gmail](${gmailUrl})`;
    let partialWarning: string | undefined;
    try {
        await clickupAPI!.addComment(taskId, commentText);
    } catch (e) {
        Logger.warn('ATTACH_COMMENT_FAILED');
        partialWarning = 'Email vinculado, pero no se pudo agregar el comentario.';
    }

    // Attach email HTML
    if (emailData.html) {
        try {
            await clickupAPI!.uploadAttachment(taskId, emailData.html, emailData.subject, emailData);
        } catch (e) {
            Logger.warn('ATTACH_HTML_UPLOAD_FAILED');
            partialWarning = partialWarning || 'Email vinculado, pero no se pudo subir el adjunto HTML.';
        }
    }

    if (partialWarning && emailData.threadId) {
        await saveEmailTaskMapping(emailData.threadId, task, { linkStatus: 'partial_failed', linkSource, customFieldId });
        return { ...task, warning: partialWarning, partial: true } as ClickUpTask & { warning: string; partial: true };
    }

    return task;
}

async function createTaskFull(data: CreateTaskFullMessage): Promise<ClickUpTask> {
    await ensureAPI();
    const { listId, taskData, emailData } = data;

    // Get configured Custom Field Name
    const settings = await chrome.storage.local.get(['threadIdField', 'useCustomFieldForThreadId']);
    const customFieldName = (settings.threadIdField || 'Gmail Thread ID').trim().toLowerCase();
    const useMethod = settings.useCustomFieldForThreadId !== false; // Default: true
    Logger.info(`LINK_METHOD_${useMethod ? 'CUSTOM_FIELD' : 'DESCRIPTION'}`);

    // 1. Get Custom Field definition from List
    let threadIdFieldId: string | null = null;
    if (useMethod && emailData && emailData.threadId) { // Only try to get field if emailData is present
        try {
            const customFields = await clickupAPI!.getAccessibleCustomFields(listId);
            const threadIdField = selectThreadIdCustomField(customFields.fields as any[], undefined, customFieldName);

            if (threadIdField?.id) {
                threadIdFieldId = threadIdField.id;
            } else {
                Logger.warn('LINK_FIELD_NOT_FOUND');
            }
        } catch (e) {
            Logger.warn('LINK_FIELD_LOOKUP_FAILED');
        }
    } else if (!useMethod && emailData && emailData.threadId) {
        // Toggle OFF: Append to Description (use markdown_description as that's what modal sends)
        const threadIdLine = `\n\n---\n**Thread ID:** ${emailData.threadId}`;
        if (taskData.markdown_description) {
            taskData.markdown_description += threadIdLine;
        } else if (taskData.description) {
            taskData.description += threadIdLine;
        } else {
            taskData.markdown_description = threadIdLine;
        }
        Logger.info('LINK_DESCRIPTION_INCLUDED');
    }

    // 2. Create Task
    const task = await clickupAPI!.createTask(listId, taskData);
    let responseTask: ClickUpTask = task;

    // 3. Link Email (Thread ID)
    if (emailData && emailData.threadId) {
        await saveEmailTaskMapping(emailData.threadId, task, {
            linkStatus: useMethod ? 'pending' : 'linked',
            linkSource: useMethod ? 'unknown' : 'description',
            customFieldId: threadIdFieldId || undefined,
        });

        if (threadIdFieldId) {
            let linkConfirmed = false;
            try {
                linkConfirmed = await appendThreadIdToCustomFieldSerialized(task.id, threadIdFieldId, emailData.threadId, customFieldName);
                Logger.info(`LINK_CUSTOM_FIELD_${linkConfirmed ? 'CONFIRMED' : 'UNCONFIRMED'}`);
            } catch (e: unknown) {
                Logger.warn('LINK_CUSTOM_FIELD_FAILED');
                const errorMessage = e instanceof Error ? e.message : String(e);
                if (errorMessage.includes('usages exceeded')) {
                    // PLAN LIMIT HIT
                    Logger.warn('LINK_PLAN_LIMIT');
                    try {
                        await clickupAPI!.addComment(task.id, `⚠️ **Alerta del sistema:** No se pudo vincular el Thread ID del email mediante campo personalizado por límites del plan de ClickUp.\n\nThread ID: ${emailData.threadId}`);
                    } catch (commentError) {
                        Logger.warn('LINK_PLAN_LIMIT_COMMENT_FAILED');
                    }
                }
            }
            await saveEmailTaskMapping(emailData.threadId, task, {
                linkStatus: transitionLinkStatus('pending', linkConfirmed),
                linkSource: linkConfirmed ? 'custom_field' : 'unknown',
                customFieldId: threadIdFieldId,
            });
        } else if (useMethod) {
            await saveEmailTaskMapping(emailData.threadId, task, {
                linkStatus: 'unverified',
                linkSource: 'unknown',
            });
        }
    }

    // 4. Attachments & Comments
    if (emailData) {
        const warnings: string[] = [];
        const markPartial = async (): Promise<void> => {
            if (!emailData.threadId) return;
            await saveEmailTaskMapping(emailData.threadId, task, {
                linkStatus: 'partial_failed',
                linkSource: useMethod ? (threadIdFieldId ? 'custom_field' : 'unknown') : 'description',
                customFieldId: threadIdFieldId || undefined,
            });
        };

        const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${emailData.threadId}`;
        const commentText = `📧 **Email vinculado:**\n🔗 [Ver email original en Gmail](${gmailUrl})`;
        try {
            await clickupAPI!.addComment(task.id, commentText);
        } catch (e) {
            Logger.warn('CREATE_TASK_EMAIL_COMMENT_FAILED');
            warnings.push('no se pudo agregar el comentario del email');
        }

        if (emailData.html) {
            try {
                await clickupAPI!.uploadAttachment(task.id, emailData.html, emailData.subject, emailData);
            } catch (e) {
                Logger.warn('CREATE_TASK_HTML_UPLOAD_FAILED');
                warnings.push('no se pudo subir el adjunto HTML');
            }
        }

        if (warnings.length > 0) {
            await markPartial();
            responseTask = { ...task, warning: `Tarea creada, pero ${warnings.join(' y ')}.`, warnings, partial: true } as ClickUpTask & { warning: string; warnings: string[]; partial: true };
        }
    }

    // 5. BUG FIX: Track Time (if specified from modal)
    if (data.timeTracked && data.teamId) {
        try {
            await clickupAPI!.createTimeEntry(data.teamId, task.id, data.timeTracked);
            Logger.info('TIME_ENTRY_ADDED');
        } catch (e) {
            Logger.error('TIME_ENTRY_ADD_FAILED', e);
        }
    }

    // 6. Notify Tabs
    if (chrome.tabs && emailData) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: 'taskCreated',
                data: { threadId: emailData.threadId, task: responseTask }
            });
        }
    }

    return responseTask;
}
