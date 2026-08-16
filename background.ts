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
import { ClickUpAPIWrapper, ClickUpRateGovernor, isClickUpWorkspaceAuthorizationError, isReauthenticationRequired, type RateGovernorState } from './src/services/api.service';
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
import {
    applyManualStopSuppression,
    decideClickUpTaskTabIndexTransition,
    decideLastTaskTabCloseAction,
    decideFocusedTimerAction,
    executeFocusedTimerAction,
    removeClickUpTaskTabIndexEntry,
    resolveClickUpFocusContext,
    updateClickUpTaskTabIndex,
    type FocusedTabSnapshot,
    type TimerAutoSettings,
} from './src/clickup-focus';
import {
    decideMeetJoinAuthority,
    sanitizeMeetMappingStore,
    sanitizeMeetPrioritySession,
    selectMeetMapping,
    type MeetMappingStoreV1,
    type MeetPrioritySession,
    type MeetTaskMappingV1,
} from './src/meet/meet-priority';
import { createMeetRoomKey, resolveMeetPageContext } from './src/meet/meet-room';
import { isAuthorizedTeamId, selectAuthorizedTeamId } from './src/team-selection';
import { SafeDiagnosticLog, type DiagnosticEventName } from './src/diagnostic-log';
import {
    CAUSAL_TRACE_PORT_NAME,
    CausalTraceSanitizer,
    createCaptureRef,
    type CausalTraceInput,
    type SafeCausalTraceEvent,
} from './src/causal-trace';

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
    REFRESH_TOKEN: 'clickupRefreshToken', // Legacy cleanup key; ClickUp does not document refresh grants
    OAUTH_CONFIG: 'oauthConfig', // New key for storing OAuth credentials
    PREFERRED_TEAM: 'preferredTeamId', // Replaces defaultList
    EMAIL_TASK_MAPPINGS: 'emailTaskMappings',
    EMAIL_TASK_MAPPINGS_V2: EMAIL_TASK_MAPPINGS_V2_KEY,
    CACHED_TEAMS: 'cachedTeams',
    CACHED_USER: 'cachedUser',
    CACHED_HIERARCHY: 'hierarchyCache', // Unified cache key
    HIERARCHY_PRELOAD_STATUS: 'hierarchyPreloadStatus',
    RATE_GOVERNOR_STATE: 'clickupRateGovernorState',
    REAUTH_REQUIRED: 'clickupReauthRequired',
    AUTHORIZATION_MODE: 'clickupAuthorizationMode',
    CURRENT_USER_VALIDATED_AT: 'clickupCurrentUserValidatedAt',
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
const FOCUSED_TIMER_DEBOUNCE_MS = 1_200;
const FOCUSED_TIMER_SESSION_KEY = 'focusedClickUpTimerState';
const AUTO_START_SUPPRESSED_TASK_SESSION_KEY = 'autoStartSuppressedTaskId';
const CLICKUP_TASK_TAB_INDEX_SESSION_KEY = 'clickUpTaskTabIndexV1';
const MEET_PRIORITY_ENABLED_KEY = 'meetPriorityEnabled';
const MEET_MAPPINGS_KEY = 'meetTaskMappingsV1';
const MEET_SESSION_KEY = 'meetPrioritySessionV1';
const MEET_CONFLICT_KEY = 'meetPriorityConflictV1';
const MEET_MAX_DURATION_MS = 4 * 60 * 60 * 1000;
const MEET_HEARTBEAT_STALE_MS = 3 * 60 * 1000;
const storageLocalTrustedReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const storageSessionTrustedReady = chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const diagnosticLog = new SafeDiagnosticLog(chrome.storage.session);
const causalTracePorts = new Map<chrome.runtime.Port, CausalTraceSanitizer>();

function recordDiagnostic(event: DiagnosticEventName, details: Record<string, unknown> = {}): void {
    void diagnosticLog.record(event, details).catch(() => undefined);
    emitCausalTrace({ event: 'diagnostic', action: event, outcome: String(details.outcome || 'none'), reason: String(details.reason || 'unknown') });
}

function emitCausalTrace(input: CausalTraceInput): SafeCausalTraceEvent | null {
    if (causalTracePorts.size === 0) return null;
    let lastEvent: SafeCausalTraceEvent | null = null;
    for (const [port, sanitizer] of [...causalTracePorts.entries()]) {
        const event = sanitizer.event(input);
        lastEvent = event;
        try {
            port.postMessage({ type: 'cgc-causal-trace-event', event });
        } catch {
            causalTracePorts.delete(port);
        }
    }
    return lastEvent;
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== CAUSAL_TRACE_PORT_NAME) return;
    const sanitizer = new CausalTraceSanitizer('extension-main', createCaptureRef('main'));
    causalTracePorts.set(port, sanitizer);
    try {
        port.postMessage({
            type: 'cgc-causal-trace-event',
            event: sanitizer.event({ event: 'capture', action: 'recording-started', outcome: 'armed' }),
        });
    } catch {
        causalTracePorts.delete(port);
        return;
    }
    port.onDisconnect.addListener(() => {
        causalTracePorts.delete(port);
    });
});

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
let authenticationStateQueue: Promise<void> = Promise.resolve();
let currentUserValidatedAt = 0;
let hierarchyCache: Record<string, CacheEntry<HierarchyData>> = {};
const hierarchyPreloadSingleFlight = new SingleFlight<string, number>();
let mappingWriteQueue: Promise<void> = Promise.resolve();
let focusedTimerQueue: Promise<void> = Promise.resolve();
let timerWriteQueue: Promise<void> = Promise.resolve();
let clickUpTaskTabIndexQueue: Promise<void> = Promise.resolve();
let focusedTimerDebounce: ReturnType<typeof setTimeout> | null = null;
let focusedTimerRevision = 0;
let meetPrioritySession: MeetPrioritySession | null = null;
let logoutInProgress = false;
const customFieldUpdateQueues = new Map<string, Promise<void>>();
const HIERARCHY_FOLDER_CONCURRENCY = 3;

// Default badge state
const BADGE_STATES = {
    playing: { text: "▶", color: "#4CAF50" }, // Green
    stopped: { text: "", color: "#00000000" }, // Transparent/None
    paused: { text: "II", color: "#FF9800" }, // Orange
    meeting: { text: "M", color: "#4CAF50" },
    attention: { text: "!", color: "#FF9800" },
};

// Initialize
chrome.runtime.onInstalled.addListener(() => {
    Logger.info('EXTENSION_INSTALLED');
    chrome.storage.local.remove(STORAGE_KEYS.DRAFT_CLIENT_SECRET);

    // Create alarm for timer polling
    chrome.alarms.create('timer-poll', { periodInMinutes: 1 });
});

const meetPriorityReady = restoreMeetPrioritySession();

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    emitCausalTrace({ event: 'listener', action: 'windows.onFocusChanged', outcome: 'received', windowId });
    void requestMeetAuthorityRefreshForWindow(windowId);
    scheduleFocusedTimerEvaluation('window-focus');
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    emitCausalTrace({ event: 'listener', action: 'tabs.onActivated', outcome: 'received', tabId: activeInfo.tabId, windowId: activeInfo.windowId });
    void requestMeetAuthorityRefresh(activeInfo.tabId);
    scheduleFocusedTimerEvaluation('tab-activated');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
        emitCausalTrace({ event: 'listener', action: 'tabs.onUpdated', outcome: 'received', rawUrl: changeInfo.url || tab.url, tabId, windowId: tab.windowId });
    }
    if (changeInfo.url
        || (changeInfo.status === 'complete' && tab.url?.startsWith('https://app.clickup.com/'))) {
        void updateTrackedClickUpTaskTab(tabId, changeInfo.url || tab.url)
            .catch((error) => Logger.error('CLICKUP_TASK_TAB_INDEX_UPDATE_FAILED', error));
    }
    if (meetPrioritySession?.tabId === tabId && (changeInfo.url || changeInfo.status === 'complete')) {
        void runTimerWrite(async () => {
            if (meetPrioritySession && !await isMeetSessionTabAlive(meetPrioritySession)) {
                await endMeetSession('navigation');
            }
        });
    }
    if (!tab.active || (!changeInfo.url && changeInfo.status !== 'complete')) return;
    scheduleFocusedTimerEvaluation('tab-url');
});

chrome.tabs.onRemoved.addListener((tabId) => {
    emitCausalTrace({ event: 'listener', action: 'tabs.onRemoved', outcome: 'received', tabId });
    if (meetPrioritySession?.tabId === tabId) {
        void runTimerWrite(() => endMeetSession('tab-closed'));
    }
    void handleTrackedClickUpTaskTabRemoved(tabId)
        .catch((error) => Logger.error('CLICKUP_TASK_TAB_CLOSE_EVALUATION_FAILED', error));
    scheduleFocusedTimerEvaluation('tab-removed');
});

chrome.windows.onRemoved.addListener((windowId) => {
    emitCausalTrace({ event: 'listener', action: 'windows.onRemoved', outcome: 'received', windowId });
    if (meetPrioritySession?.windowId === windowId) {
        void runTimerWrite(() => endMeetSession('window-closed'));
    }
    scheduleFocusedTimerEvaluation('window-removed');
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.autoStopTimer) {
        const operation = changes.autoStopTimer.newValue === true
            ? hydrateTrackedClickUpTaskTabs()
            : clearTrackedClickUpTaskTabIndex();
        void operation.catch((error) => Logger.error('CLICKUP_TASK_TAB_INDEX_SETTING_SYNC_FAILED', error));
    }
    if (changes.autoStartTimer || changes.autoStopTimer || changes[STORAGE_KEYS.PREFERRED_TEAM]) {
        scheduleFocusedTimerEvaluation('settings');
    }
});

scheduleFocusedTimerEvaluation('service-worker-start');

// Alarm listener for polling
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'timer-poll') {
        const authState = await chrome.storage.local.get(STORAGE_KEYS.REAUTH_REQUIRED);
        if (authState[STORAGE_KEYS.REAUTH_REQUIRED] === true) return;
        await meetPriorityReady;
        if (meetPrioritySession && ['awaiting-task', 'tracking', 'paused'].includes(meetPrioritySession.status)
            && (!await isMeetSessionTabAlive(meetPrioritySession)
                || Date.now() - meetPrioritySession.lastSeenAt > MEET_HEARTBEAT_STALE_MS)) {
            await runTimerWrite(() => endMeetSession('stale-session'));
        }
        if (meetPrioritySession?.status === 'tracking'
            && Date.now() - (meetPrioritySession.durationConfirmedAt || meetPrioritySession.joinedAt) >= MEET_MAX_DURATION_MS) {
            await runTimerWrite(() => pauseMeetSessionForLimit());
        }
        const teamId = await resolveFocusedTimerTeamId();

        if (teamId) {
            try {
                await ensureAPI();
                const timer = await clickupAPI!.getRunningTimer(teamId);
                recordDiagnostic('timer_poll', { outcome: timer ? 'running' : 'stopped' });
                if (meetPrioritySession?.status === 'tracking'
                    && meetPrioritySession.teamId === teamId
                    && getRunningTaskId(timer) !== meetPrioritySession.taskId) {
                    meetPrioritySession.status = 'paused';
                    await persistMeetPrioritySession();
                }
                // Update badge based on timer state
                if (timer && (timer as any).data) { // Handle wrapped response
                    await updateTimerBadge('playing');
                } else if (timer) {
                    await updateTimerBadge('playing');
                } else {
                    await updateTimerBadge('stopped');
                }
                await refreshMeetPriorityBadge();
            } catch (e) {
                recordDiagnostic('timer_poll', {
                    outcome: 'failure',
                    failureClass: classifyDiagnosticFailure(e),
                });
                Logger.error('TIMER_POLL_FAILED', e);
            }
        }
    }
});

// Initialize API wrapper
async function initializeAPI() {
    recordDiagnostic('auth_state', { stage: 'initialize', outcome: 'started' });
    const authState = await chrome.storage.local.get(STORAGE_KEYS.REAUTH_REQUIRED);
    if (authState[STORAGE_KEYS.REAUTH_REQUIRED] === true) {
        clickupAPI = null;
        recordDiagnostic('auth_state', { stage: 'initialize', outcome: 'reauth-required' });
        return;
    }

    const token = await getSecureToken(STORAGE_KEYS.AUTH_TOKEN);

    if (!token) {
        clickupAPI = null;
        recordDiagnostic('auth_state', { stage: 'initialize', outcome: 'no-token' });
        return;
    }

    const store = await chrome.storage.local.get([
        STORAGE_KEYS.RATE_GOVERNOR_STATE,
        STORAGE_KEYS.AUTHORIZATION_MODE,
    ]);
    const authorizationMode = store[STORAGE_KEYS.AUTHORIZATION_MODE] === 'bearer' ? 'bearer' : 'raw';
    const governor = new ClickUpRateGovernor(
        undefined,
        undefined,
        store[STORAGE_KEYS.RATE_GOVERNOR_STATE] as RateGovernorState | undefined,
        async (state) => {
            await chrome.storage.local.set({ [STORAGE_KEYS.RATE_GOVERNOR_STATE]: state });
        }
    );
    const api = new ClickUpAPIWrapper(token, governor, authorizationMode);
    api.setDiagnosticCallback(({ event, details }) => recordDiagnostic(event, details));
    api.setAuthenticationFailureCallback(invalidateAuthenticationSession);
    api.setAuthorizationModeChangeCallback(async (mode) => {
        const currentToken = await getSecureToken(STORAGE_KEYS.AUTH_TOKEN);
        if (currentToken === token) {
            await chrome.storage.local.set({ [STORAGE_KEYS.AUTHORIZATION_MODE]: mode });
        }
    });
    const [latestToken, latestAuthState] = await Promise.all([
        getSecureToken(STORAGE_KEYS.AUTH_TOKEN),
        chrome.storage.local.get(STORAGE_KEYS.REAUTH_REQUIRED),
    ]);
    if (latestToken !== token || latestAuthState[STORAGE_KEYS.REAUTH_REQUIRED] === true) return;
    clickupAPI = api;
    recordDiagnostic('auth_state', { stage: 'initialize', outcome: 'ready' });
    await hydrateTrackedClickUpTaskTabs()
        .catch((error) => Logger.error('CLICKUP_TASK_TAB_INDEX_HYDRATION_FAILED', error));
}

async function invalidateAuthenticationSession(rejectedToken: string): Promise<boolean> {
    return runAuthenticationStateMutation(async () => {
        const currentToken = await getSecureToken(STORAGE_KEYS.AUTH_TOKEN);
        if (!currentToken || currentToken !== rejectedToken) {
            Logger.warn('STALE_AUTH_FAILURE_IGNORED');
            return false;
        }
        clickupAPI = null;
        currentUserValidatedAt = 0;
        hierarchyCache = {};
        taskSearchCaches.clear();
        await chrome.storage.local.set({ [STORAGE_KEYS.REAUTH_REQUIRED]: true });
        await removeSecureToken(STORAGE_KEYS.AUTH_TOKEN);
        await removeSecureToken(STORAGE_KEYS.REFRESH_TOKEN);
        await chrome.storage.local.remove([
            STORAGE_KEYS.CACHED_USER,
            STORAGE_KEYS.CACHED_TEAMS,
            STORAGE_KEYS.CACHED_HIERARCHY,
            STORAGE_KEYS.HIERARCHY_PRELOAD_STATUS,
            STORAGE_KEYS.CURRENT_USER_VALIDATED_AT,
        ]);
        if (meetPrioritySession?.status === 'tracking') {
            meetPrioritySession.status = 'paused';
            await persistMeetPrioritySession();
        }
        await chrome.storage.session.remove([
            FOCUSED_TIMER_SESSION_KEY,
            AUTO_START_SUPPRESSED_TASK_SESSION_KEY,
            CLICKUP_TASK_TAB_INDEX_SESSION_KEY,
        ]);
        await clearTrackedClickUpTaskTabIndex();
        await updateTimerBadge('attention').catch(() => undefined);
        Logger.warn('AUTHENTICATION_INVALIDATED');
        recordDiagnostic('auth_state', { stage: 'invalidate', outcome: 'invalidated' });
        return true;
    });
}

function runAuthenticationStateMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = authenticationStateQueue.then(operation, operation);
    authenticationStateQueue = result.then(() => undefined, () => undefined);
    return result;
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
                    error: Logger.sanitizeError(response.error),
                    requiresReauth: isReauthenticationRequired(response.error),
                });
            } else {
                sendResponse(response);
            }
        })
        .catch(error => {
            Logger.error('MESSAGE_HANDLER_ERROR', error);
            sendResponse({
                success: false,
                error: Logger.sanitizeError(error),
                requiresReauth: isReauthenticationRequired(error),
            });
        });

    return true; // Keep channel open for async response
});

async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender) {
    const { action, data } = message;

    switch (action) {
        case 'authenticate':
            recordDiagnostic('auth_state', { stage: 'oauth', outcome: 'started' });
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

                if (typeof result.access_token !== 'string' || result.access_token.length === 0) {
                    throw new Error('Access token missing from OAuth response');
                }
                await runAuthenticationStateMutation(async () => {
                    await saveSecureToken(STORAGE_KEYS.AUTH_TOKEN, result.access_token);
                    await removeSecureToken(STORAGE_KEYS.REFRESH_TOKEN);
                    await chrome.storage.local.remove([
                        STORAGE_KEYS.DRAFT_CLIENT_ID,
                        STORAGE_KEYS.DRAFT_CLIENT_SECRET,
                        STORAGE_KEYS.CACHED_USER,
                        STORAGE_KEYS.CACHED_TEAMS,
                        STORAGE_KEYS.CACHED_HIERARCHY,
                        STORAGE_KEYS.HIERARCHY_PRELOAD_STATUS,
                        STORAGE_KEYS.CURRENT_USER_VALIDATED_AT,
                        STORAGE_KEYS.REAUTH_REQUIRED,
                    ]);
                    currentUserValidatedAt = 0;
                    await initializeAPI();
                });
                const user = await getFreshAuthenticatedUser();
                await getTeams(true);
                logoutInProgress = false;
                if (meetPrioritySession && meetPrioritySession.status !== 'ignored') {
                    await refreshMeetPriorityBadge().catch(() => undefined);
                } else {
                    await restoreNormalTimerBadge().catch(() => undefined);
                }
                scheduleFocusedTimerEvaluation('authenticated');
                recordDiagnostic('auth_state', { stage: 'oauth', outcome: 'success' });

                return { success: true, user };
            } catch (e) {
                recordDiagnostic('auth_state', {
                    stage: 'oauth',
                    outcome: 'failure',
                    failureClass: classifyDiagnosticFailure(e),
                });
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

        case 'logout':
            logoutInProgress = true;
            await runTimerWrite(async () => {
                try {
                    await endMeetSession('logout');
                } catch {
                    Logger.warn('LOGOUT_REMOTE_TIMER_UNVERIFIED');
                }
                try {
                    await stopRunningTimerBeforeLogout();
                } catch {
                    Logger.warn('LOGOUT_REMOTE_TIMER_UNVERIFIED');
                }
            });
            await runAuthenticationStateMutation(async () => {
                meetPrioritySession = null;
                await chrome.storage.session.remove([
                    MEET_SESSION_KEY,
                    MEET_CONFLICT_KEY,
                    FOCUSED_TIMER_SESSION_KEY,
                    AUTO_START_SUPPRESSED_TASK_SESSION_KEY,
                    CLICKUP_TASK_TAB_INDEX_SESSION_KEY,
                ]);
                await clearTrackedClickUpTaskTabIndex();
                await removeSecureToken(STORAGE_KEYS.AUTH_TOKEN);
                await removeSecureToken(STORAGE_KEYS.REFRESH_TOKEN);
                await chrome.storage.local.remove([
                    STORAGE_KEYS.OAUTH_CONFIG,
                    STORAGE_KEYS.DRAFT_CLIENT_ID,
                    STORAGE_KEYS.DRAFT_CLIENT_SECRET,
                    STORAGE_KEYS.CACHED_USER,
                    STORAGE_KEYS.CACHED_TEAMS,
                    STORAGE_KEYS.CURRENT_USER_VALIDATED_AT,
                    STORAGE_KEYS.REAUTH_REQUIRED,
                ]);
                clickupAPI = null;
                currentUserValidatedAt = 0;
                hierarchyCache = {};
                taskSearchCaches.clear();
            });
            await chrome.action.setBadgeText({ text: '' });
            return { success: true };

        case 'checkAuth':
            return await getAuthenticationStatus();

        case 'getStatus': // Combined status check
            return await getAuthenticationStatus();

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

        case 'getEmailTaskMappings':
            await storageLocalTrustedReady;
            return await getEmailTaskMappingsForRead();

        case 'getDefaultListConfig':
            await storageLocalTrustedReady;
            const defaultListStore = await chrome.storage.local.get(['defaultList', 'defaultListConfig']);
            return {
                defaultList: typeof defaultListStore.defaultList === 'string' ? defaultListStore.defaultList : undefined,
                defaultListConfig: sanitizeDefaultListConfig(defaultListStore.defaultListConfig),
            };

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
            const authorizedTeams = await getTeams();
            if (!isAuthorizedTeamId(authorizedTeams.teams, data.teamId)) {
                throw new Error('TEAM_NOT_AUTHORIZED');
            }
            await chrome.storage.local.set({ [STORAGE_KEYS.PREFERRED_TEAM]: data.teamId });
            return { success: true };

        case 'getPreferredTeam':
            const prefData = await chrome.storage.local.get(STORAGE_KEYS.PREFERRED_TEAM);
            return { teamId: prefData[STORAGE_KEYS.PREFERRED_TEAM] };

        case 'getDiagnosticStatus':
            await storageSessionTrustedReady;
            return await diagnosticLog.getStatus();

        case 'setDiagnosticEnabled':
            await storageSessionTrustedReady;
            return await diagnosticLog.setEnabled(data.enabled);

        case 'exportDiagnostics':
            await storageSessionTrustedReady;
            return await diagnosticLog.createExport(chrome.runtime.getManifest().version);

        case 'clearDiagnostics':
            await storageSessionTrustedReady;
            return await diagnosticLog.clear();


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
            return await runTimerWrite(() => clearLocalData(sender));

        case 'searchTasks':
            const sQuery = message.query || (data ? data.query : undefined);
            const sTeamId = message.teamId || (data ? data.teamId : undefined);
            return await searchTasks(sQuery, sTeamId);

        case 'getTaskById':
            const gTaskId = message.taskId || (data ? data.taskId : undefined);
            return await getTaskById(gTaskId);

        case 'focusedClickUpNavigation':
            if (typeof sender.tab?.id === 'number') {
                await updateTrackedClickUpTaskTab(sender.tab.id, sender.tab.url || sender.url);
            }
            scheduleFocusedTimerEvaluation('content-navigation');
            return { success: true };

        case 'meetSessionEvent':
            return await runTimerWrite(() => handleMeetSessionEvent(data, sender));

        case 'getMeetDetectionEnabled':
            const meetDetectionSettings = await chrome.storage.local.get(MEET_PRIORITY_ENABLED_KEY);
            return { enabled: meetDetectionSettings[MEET_PRIORITY_ENABLED_KEY] === true };

        case 'getMeetPriorityStatus':
            return await getMeetPriorityStatus();

        case 'getMeetMappings':
            return await getMeetMappings();

        case 'assignMeetTask':
            return await runTimerWrite(() => assignMeetTask(data.taskId, data.teamId, data.remember));

        case 'ignoreMeetSession':
            return await runTimerWrite(() => ignoreMeetSession());

        case 'endMeetSession':
            return await runTimerWrite(() => endMeetSession('manual'));

        case 'resumeMeetSession':
            return await runTimerWrite(() => resumeMeetSession());

        case 'deleteMeetMapping':
            return await runTimerWrite(() => deleteMeetMapping(data.roomKey));

        case 'setMeetMappingEnabled':
            return await runTimerWrite(() => setMeetMappingEnabled(data.roomKey, data.enabled));

        case 'setMeetPriorityEnabled':
            if (!data.enabled) await runTimerWrite(() => endMeetSession('disabled'));
            await chrome.storage.local.set({ [MEET_PRIORITY_ENABLED_KEY]: data.enabled });
            await requestMeetDetectionRefresh(data.enabled);
            return { success: true };

        // Time Tracking
        case 'startTimer':
            return await runTimerWrite(async () => {
                await meetPriorityReady;
                if (meetPrioritySession
                    && ['awaiting-task', 'tracking', 'paused'].includes(meetPrioritySession.status)) {
                    throw new Error('MEET_PRIORITY_ACTIVE');
                }
                if (!await validateFocusedTask(data.taskId, data.teamId)) {
                    throw new Error('TIMER_TASK_INVALID');
                }
                const running = await clickupAPI!.getRunningTimer(data.teamId);
                const runningTaskId = getRunningTaskId(running);
                if (running && !runningTaskId) throw new Error('TIMER_RUNNING_TASK_UNKNOWN');
                if (runningTaskId && runningTaskId !== data.taskId) {
                    await clickupAPI!.stopTimer(data.teamId);
                }
                const startRes = runningTaskId === data.taskId
                    ? running
                    : await clickupAPI!.startTimer(data.teamId, data.taskId);
                await clearManualStopSuppression();
                await updateTimerBadge('playing');
                await refreshMeetPriorityBadge();
                return startRes;
            });

        case 'stopTimer':
            return await runTimerWrite(async () => {
                const running = await clickupAPI!.getRunningTimer(data.teamId);
                if (!running) {
                    await updateTimerBadge('stopped');
                    return null;
                }
                const stopRes = await clickupAPI!.stopTimer(data.teamId);
                await persistManualStopSuppression(getRunningTaskId(running));
                if (meetPrioritySession?.status === 'tracking' && meetPrioritySession.teamId === data.teamId) {
                    meetPrioritySession.status = 'paused';
                    await persistMeetPrioritySession();
                }
                await updateTimerBadge('stopped');
                await refreshMeetPriorityBadge();
                return stopRes;
            });

        case 'getRunningTimer':
            const timer = await clickupAPI!.getRunningTimer(data.teamId);
            if (timer) {
                await updateTimerBadge('playing');
            } else {
                await updateTimerBadge('stopped');
            }
            if (meetPrioritySession?.status === 'tracking'
                && meetPrioritySession.teamId === data.teamId
                && getRunningTaskId(timer) !== meetPrioritySession.taskId) {
                meetPrioritySession.status = 'paused';
                await persistMeetPrioritySession();
            }
            await refreshMeetPriorityBadge();
            return timer;

        case 'createTimeEntry':
            // Kept for backward compatibility if entry object is used
            return await runTimerWrite(() => clickupAPI!.createTimeEntry(
                data.teamId,
                data.entry?.tid || data.taskId,
                data.entry?.duration || data.duration,
                data.entry?.start || data.start
            ));

        case 'addTimeEntry':
            return await runTimerWrite(() => clickupAPI!.createTimeEntry(
                data.teamId,
                data.taskId,
                data.duration,
                data.start
            ));

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
        if (!clickupAPI) {
            const authState = await chrome.storage.local.get(STORAGE_KEYS.REAUTH_REQUIRED);
            if (authState[STORAGE_KEYS.REAUTH_REQUIRED] === true) {
                const error = new Error('Authentication failed. Reconnect ClickUp.') as Error & { status?: number; requiresReauth?: boolean };
                error.status = 401;
                error.requiresReauth = true;
                throw error;
            }
            throw new Error('Not authenticated');
        }
    }
}

async function getAuthenticationStatus(): Promise<{
    authenticated: boolean;
    configured: boolean;
    requiresReauth: boolean;
    authUnavailable?: boolean;
    user?: ClickUpUserResponse;
}> {
    const configured = await hasSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG);
    const authState = await chrome.storage.local.get(STORAGE_KEYS.REAUTH_REQUIRED);
    if (authState[STORAGE_KEYS.REAUTH_REQUIRED] === true) {
        recordDiagnostic('auth_state', { stage: 'status', outcome: 'reauth-required' });
        return { authenticated: false, configured, requiresReauth: true };
    }

    try {
        if (!clickupAPI) await initializeAPI();
        if (!clickupAPI) {
            recordDiagnostic('auth_state', { stage: 'status', outcome: 'no-token' });
            return { authenticated: false, configured, requiresReauth: false };
        }
        const cache = await chrome.storage.local.get([
            STORAGE_KEYS.CACHED_USER,
            STORAGE_KEYS.CURRENT_USER_VALIDATED_AT,
        ]);
        const cachedValidatedAt = Number(cache[STORAGE_KEYS.CURRENT_USER_VALIDATED_AT]);
        if (cache[STORAGE_KEYS.CACHED_USER]
            && Number.isFinite(cachedValidatedAt)
            && Date.now() - cachedValidatedAt < CURRENT_USER_VALIDATION_TTL_MS) {
            currentUserValidatedAt = Math.max(currentUserValidatedAt, cachedValidatedAt);
            recordDiagnostic('auth_state', { stage: 'status', outcome: 'cached' });
            return {
                authenticated: true,
                configured,
                requiresReauth: false,
                user: cache[STORAGE_KEYS.CACHED_USER] as ClickUpUserResponse,
            };
        }
        const user = await getFreshAuthenticatedUser();
        recordDiagnostic('auth_state', { stage: 'status', outcome: 'remote' });
        return { authenticated: true, configured, requiresReauth: false, user };
    } catch (error) {
        if (isReauthenticationRequired(error)) {
            recordDiagnostic('auth_state', { stage: 'status', outcome: 'reauth-required' });
            return { authenticated: false, configured, requiresReauth: true };
        }
        recordDiagnostic('auth_state', {
            stage: 'status',
            outcome: 'unavailable',
            failureClass: classifyDiagnosticFailure(error),
        });
        Logger.warn('AUTHENTICATION_STATUS_UNAVAILABLE');
        return { authenticated: false, configured, requiresReauth: false, authUnavailable: true };
    }
}

function runTimerWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = timerWriteQueue.then(operation, operation);
    timerWriteQueue = result.then(() => undefined, () => undefined);
    return result;
}

function runClickUpTaskTabIndexMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = clickUpTaskTabIndexQueue.then(operation, operation);
    clickUpTaskTabIndexQueue = result.then(() => undefined, () => undefined);
    return result;
}

async function restoreMeetPrioritySession(): Promise<void> {
    const stored = await chrome.storage.session.get(MEET_SESSION_KEY);
    const session = sanitizeMeetPrioritySession(stored[MEET_SESSION_KEY]);
    if (!session) {
        await chrome.storage.session.remove(MEET_SESSION_KEY);
        return;
    }
    meetPrioritySession = session;
    if (!await isMeetSessionTabAlive(session) || !await hasConfirmedMeetSignal(session)) {
        meetPrioritySession = null;
        await chrome.storage.session.remove(MEET_SESSION_KEY);
        return;
    }
    await refreshMeetPriorityBadge();
}

async function handleMeetSessionEvent(
    data: { event: 'candidate' | 'joined' | 'left' | 'heartbeat'; roomKey: string },
    sender: chrome.runtime.MessageSender,
): Promise<{ success: boolean; status?: string }> {
    await meetPriorityReady;
    await storageLocalTrustedReady;
    const settings = await chrome.storage.local.get(MEET_PRIORITY_ENABLED_KEY);
    if (settings[MEET_PRIORITY_ENABLED_KEY] !== true) return { success: true, status: 'disabled' };
    if (typeof sender.tab?.id !== 'number' || typeof sender.tab.windowId !== 'number') return { success: false };
    if (sender.tab.incognito) return { success: true, status: 'incognito-blocked' };

    if (data.event === 'candidate') return { success: true, status: 'candidate' };
    if (data.event === 'heartbeat' && meetPrioritySession?.roomKey === data.roomKey
        && meetPrioritySession.tabId === sender.tab.id) {
        meetPrioritySession.lastSeenAt = Date.now();
        await persistMeetPrioritySession();
        return { success: true, status: meetPrioritySession.status };
    }
    if (data.event === 'heartbeat') return { success: true, status: 'ignored' };
    if (data.event === 'left') {
        if (meetPrioritySession?.roomKey === data.roomKey && meetPrioritySession.tabId === sender.tab.id) {
            await endMeetSession('left');
        } else {
            await chrome.storage.session.remove(MEET_CONFLICT_KEY);
        }
        return { success: true, status: 'idle' };
    }

    const focused = await getFocusedTabSnapshot();
    const authority = decideMeetJoinAuthority(meetPrioritySession, {
        roomKey: data.roomKey,
        tabId: sender.tab.id,
        windowId: sender.tab.windowId,
    }, focused ? { tabId: focused.tabId, windowId: focused.windowId } : null);
    if (authority === 'conflict') {
        await chrome.storage.session.set({ [MEET_CONFLICT_KEY]: true });
        return { success: true, status: 'conflict' };
    }
    if (authority === 'continue') {
        meetPrioritySession!.lastSeenAt = Date.now();
        await persistMeetPrioritySession();
        return { success: true, status: meetPrioritySession!.status };
    }
    if (authority === 'replace') await endMeetSession('priority-replaced');

    const previous = await captureRunningTimerContext();

    meetPrioritySession = {
        roomKey: data.roomKey,
        tabId: sender.tab.id,
        windowId: sender.tab.windowId,
        status: 'awaiting-task',
        previousTaskId: previous.taskId || undefined,
        previousTeamId: previous.teamId || undefined,
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
    };
    await chrome.storage.session.remove(MEET_CONFLICT_KEY);
    await persistMeetPrioritySession();
    await refreshMeetPriorityBadge();

    const mapping = await getMeetMapping(data.roomKey);
    if (mapping) {
        try {
            await startMeetTracking(mapping.taskId, mapping.teamId);
        } catch {
            await stopCurrentTimerForUnassignedMeet();
            await refreshMeetPriorityBadge();
            return { success: true, status: meetPrioritySession?.status };
        }
        mapping.lastUsedAt = Date.now();
        await saveMeetMapping(mapping).catch(() => undefined);
    } else {
        await stopCurrentTimerForUnassignedMeet();
    }

    return { success: true, status: meetPrioritySession?.status };
}

async function assignMeetTask(taskId: string, teamId: string, remember: boolean): Promise<{ success: boolean; mappingSaved: boolean }> {
    await meetPriorityReady;
    if (!meetPrioritySession || !['awaiting-task', 'tracking', 'paused'].includes(meetPrioritySession.status)) {
        throw new Error('MEET_SESSION_UNAVAILABLE');
    }
    const roomKey = meetPrioritySession.roomKey;
    await startMeetTracking(taskId, teamId);
    let mappingSaved = !remember;
    if (remember) {
        try {
            const now = Date.now();
            const existing = await readMeetMappings();
            await saveMeetMapping({
                roomKey,
                taskId,
                teamId,
                createdAt: existing.mappings[roomKey]?.createdAt || now,
                lastUsedAt: now,
                enabled: true,
            });
            mappingSaved = true;
        } catch {
            mappingSaved = false;
        }
    }
    return { success: true, mappingSaved };
}

async function ignoreMeetSession(): Promise<{ success: boolean }> {
    await meetPriorityReady;
    if (!meetPrioritySession || meetPrioritySession.status !== 'awaiting-task') {
        throw new Error('MEET_SESSION_UNAVAILABLE');
    }
    meetPrioritySession.status = 'ignored';
    await persistMeetPrioritySession();
    await restoreNormalTimerBadge();
    scheduleFocusedTimerEvaluation('meet-ignored');
    return { success: true };
}

async function startMeetTracking(taskId: string, teamId: string): Promise<void> {
    if (!meetPrioritySession || !await isMeetSessionTabAlive(meetPrioritySession)) throw new Error('MEET_SESSION_STALE');
    const expectedSession = {
        roomKey: meetPrioritySession.roomKey,
        tabId: meetPrioritySession.tabId,
        windowId: meetPrioritySession.windowId,
    };
    await ensureAPI();
    if (!await validateFocusedTask(taskId, teamId)) throw new Error('MEET_TASK_INVALID');
    const running = await clickupAPI!.getRunningTimer(teamId);
    const runningTaskId = getRunningTaskId(running);

    if (running && !runningTaskId) throw new Error('MEET_RUNNING_TASK_UNKNOWN');
    if (runningTaskId && runningTaskId !== taskId) await clickupAPI!.stopTimer(teamId);
    if (!await isSameMeetSessionAlive(expectedSession)) throw new Error('MEET_SESSION_STALE_AFTER_STOP');
    const startedMeetTimer = runningTaskId !== taskId;
    if (startedMeetTimer) await clickupAPI!.startTimer(teamId, taskId);
    await clearManualStopSuppression();

    const previousState = { ...meetPrioritySession };
    try {
        meetPrioritySession.status = 'tracking';
        meetPrioritySession.taskId = taskId;
        meetPrioritySession.teamId = teamId;
        meetPrioritySession.startedAt = meetPrioritySession.startedAt || Date.now();
        meetPrioritySession.lastSeenAt = Date.now();
        await persistMeetPrioritySession();
    } catch (error) {
        meetPrioritySession = previousState;
        if (startedMeetTimer) {
            try {
                await clickupAPI!.stopTimer(teamId);
            } catch {
                Logger.error('MEET_TIMER_COMPENSATION_FAILED');
            }
        }
        throw error;
    }
    await refreshMeetPriorityBadge().catch(() => undefined);
}

async function stopCurrentTimerForUnassignedMeet(): Promise<void> {
    const teamId = await resolveFocusedTimerTeamId();
    if (!teamId) return;
    await ensureAPI();
    const running = await clickupAPI!.getRunningTimer(teamId);
    if (running) {
        await clickupAPI!.stopTimer(teamId);
        await updateTimerBadge('stopped');
    }
}

async function endMeetSession(_reason: string): Promise<{ success: boolean }> {
    await meetPriorityReady;
    const session = meetPrioritySession;
    if (!session) return { success: true };

    if (session.status === 'tracking' && session.teamId) {
        await ensureAPI();
        const running = await clickupAPI!.getRunningTimer(session.teamId);
        if (getRunningTaskId(running) === session.taskId) {
            await clickupAPI!.stopTimer(session.teamId);
            if (['manual', 'logout'].includes(_reason) && session.taskId) {
                await persistManualStopSuppression(session.taskId);
            }
            await updateTimerBadge('stopped');
        }
    }

    if (_reason === 'manual') {
        session.status = 'ignored';
        session.taskId = undefined;
        session.teamId = undefined;
        session.startedAt = undefined;
        await persistMeetPrioritySession();
    } else {
        meetPrioritySession = null;
        await chrome.storage.session.remove([MEET_SESSION_KEY, MEET_CONFLICT_KEY]);
    }
    await restoreNormalTimerBadge();
    scheduleFocusedTimerEvaluation('meet-ended');
    return { success: true };
}

async function getMeetPriorityStatus(): Promise<Record<string, unknown>> {
    await meetPriorityReady;
    const settings = await chrome.storage.local.get(MEET_PRIORITY_ENABLED_KEY);
    const conflict = await chrome.storage.session.get(MEET_CONFLICT_KEY);
    if (!meetPrioritySession) return {
        enabled: settings[MEET_PRIORITY_ENABLED_KEY] === true,
        status: 'idle',
        conflict: false,
    };
    return {
        enabled: settings[MEET_PRIORITY_ENABLED_KEY] === true,
        status: meetPrioritySession.status,
        conflict: conflict[MEET_CONFLICT_KEY] === true,
        taskId: meetPrioritySession.taskId,
        teamId: meetPrioritySession.teamId,
        startedAt: meetPrioritySession.startedAt,
        joinedAt: meetPrioritySession.joinedAt,
        previousTaskId: meetPrioritySession.previousTaskId,
        previousTeamId: meetPrioritySession.previousTeamId,
    };
}

async function getMeetMappings(): Promise<{ mappings: MeetTaskMappingV1[] }> {
    const store = await readMeetMappings();
    return {
        mappings: Object.values(store.mappings)
            .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
            .slice(0, 50),
    };
}

async function captureRunningTimerContext(): Promise<{ taskId: string | null; teamId: string | null }> {
    try {
        const teamId = await resolveFocusedTimerTeamId();
        if (!teamId) return { taskId: null, teamId: null };
        await ensureAPI();
        const running = await clickupAPI!.getRunningTimer(teamId);
        return { taskId: getRunningTaskId(running), teamId };
    } catch {
        return { taskId: null, teamId: null };
    }
}

async function pauseMeetSessionForLimit(): Promise<{ success: boolean }> {
    const session = meetPrioritySession;
    if (!session || session.status !== 'tracking' || !session.teamId) return { success: true };
    await ensureAPI();
    const running = await clickupAPI!.getRunningTimer(session.teamId);
    if (getRunningTaskId(running) === session.taskId) await clickupAPI!.stopTimer(session.teamId);
    session.status = 'paused';
    await persistMeetPrioritySession();
    await refreshMeetPriorityBadge();
    return { success: true };
}

async function resumeMeetSession(): Promise<{ success: boolean }> {
    if (!meetPrioritySession || meetPrioritySession.status !== 'paused'
        || !meetPrioritySession.taskId || !meetPrioritySession.teamId) {
        throw new Error('MEET_SESSION_NOT_PAUSED');
    }
    const taskId = meetPrioritySession.taskId;
    const teamId = meetPrioritySession.teamId;
    const previousConfirmedAt = meetPrioritySession.durationConfirmedAt;
    meetPrioritySession.durationConfirmedAt = Date.now();
    try {
        await startMeetTracking(taskId, teamId);
    } catch (error) {
        if (meetPrioritySession) meetPrioritySession.durationConfirmedAt = previousConfirmedAt;
        throw error;
    }
    return { success: true };
}

async function readMeetMappings(): Promise<MeetMappingStoreV1> {
    const stored = await chrome.storage.local.get(MEET_MAPPINGS_KEY);
    return sanitizeMeetMappingStore(stored[MEET_MAPPINGS_KEY]);
}

async function getMeetMapping(roomKey: string): Promise<MeetTaskMappingV1 | null> {
    return selectMeetMapping(await readMeetMappings(), roomKey);
}

async function saveMeetMapping(mapping: MeetTaskMappingV1): Promise<void> {
    const store = await readMeetMappings();
    store.mappings[mapping.roomKey] = mapping;
    await chrome.storage.local.set({ [MEET_MAPPINGS_KEY]: store });
}

async function deleteMeetMapping(roomKey: string): Promise<{ success: boolean }> {
    const store = await readMeetMappings();
    delete store.mappings[roomKey];
    await chrome.storage.local.set({ [MEET_MAPPINGS_KEY]: store });
    return { success: true };
}

async function setMeetMappingEnabled(roomKey: string, enabled: boolean): Promise<{ success: boolean }> {
    const store = await readMeetMappings();
    const mapping = store.mappings[roomKey];
    if (!mapping) throw new Error('MEET_MAPPING_NOT_FOUND');
    mapping.enabled = enabled;
    await chrome.storage.local.set({ [MEET_MAPPINGS_KEY]: store });
    return { success: true };
}

async function requestMeetDetectionRefresh(enabled: boolean): Promise<void> {
    const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
    await Promise.all(tabs
        .filter((tab) => typeof tab.id === 'number' && !tab.incognito)
        .map((tab) => chrome.tabs.sendMessage(tab.id!, {
            action: 'setMeetDetectionEnabled',
            data: { enabled },
        }).catch(() => undefined)));
}

async function requestMeetAuthorityRefresh(tabId: number): Promise<void> {
    await chrome.tabs.sendMessage(tabId, { action: 'refreshMeetAuthority' }).catch(() => undefined);
}

async function requestMeetAuthorityRefreshForWindow(windowId: number): Promise<void> {
    const tabs = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
    if (typeof tabs[0]?.id === 'number') await requestMeetAuthorityRefresh(tabs[0].id);
}

async function isMeetSessionTabAlive(session: MeetPrioritySession): Promise<boolean> {
    try {
        const tab = await chrome.tabs.get(session.tabId);
        if (tab.windowId !== session.windowId || typeof tab.url !== 'string') return false;
        const context = resolveMeetPageContext(tab.url);
        if (context.kind !== 'candidate') return false;
        return await createMeetRoomKey(context.roomCode) === session.roomKey;
    } catch {
        return false;
    }
}

async function isSameMeetSessionAlive(expected: { roomKey: string; tabId: number; windowId: number }): Promise<boolean> {
    return !!meetPrioritySession
        && meetPrioritySession.roomKey === expected.roomKey
        && meetPrioritySession.tabId === expected.tabId
        && meetPrioritySession.windowId === expected.windowId
        && Date.now() - meetPrioritySession.lastSeenAt <= MEET_HEARTBEAT_STALE_MS
        && await isMeetSessionTabAlive(meetPrioritySession)
        && await hasConfirmedMeetSignal(expected);
}

async function hasConfirmedMeetSignal(expected: { roomKey: string; tabId: number; windowId: number }): Promise<boolean> {
    try {
        const response = await chrome.tabs.sendMessage(expected.tabId, { action: 'confirmMeetSession' });
        if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
        if (!Object.keys(response).every((key) => ['active', 'roomKey'].includes(key))) return false;
        return response.active === true && response.roomKey === expected.roomKey;
    } catch {
        return false;
    }
}

async function persistMeetPrioritySession(): Promise<void> {
    if (!meetPrioritySession) await chrome.storage.session.remove(MEET_SESSION_KEY);
    else await chrome.storage.session.set({ [MEET_SESSION_KEY]: meetPrioritySession });
}

async function refreshMeetPriorityBadge(): Promise<void> {
    if (!meetPrioritySession || meetPrioritySession.status === 'ignored') return;
    if (meetPrioritySession.status === 'tracking') {
        await updateTimerBadge('meeting');
        return;
    }
    await updateTimerBadge('attention');
}

async function restoreNormalTimerBadge(): Promise<void> {
    try {
        const teamId = await resolveFocusedTimerTeamId();
        if (!teamId) {
            await updateTimerBadge('stopped');
            return;
        }
        await ensureAPI();
        const running = await clickupAPI!.getRunningTimer(teamId);
        await updateTimerBadge(running ? 'playing' : 'stopped');
    } catch {
        await updateTimerBadge('stopped');
    }
}

async function hydrateTrackedClickUpTaskTabs(): Promise<void> {
    if (!clickupAPI || logoutInProgress) return;
    const settings = await readFocusedTimerSettings();
    if (!settings.autoStopTimer) {
        await clearTrackedClickUpTaskTabIndex();
        return;
    }
    const tabs = await chrome.tabs.query({ url: 'https://app.clickup.com/*' });
    await Promise.all(tabs.map(async (tab) => {
        if (typeof tab.id !== 'number') return;
        await updateTrackedClickUpTaskTab(tab.id, tab.url);
    }));
}

async function updateTrackedClickUpTaskTab(tabId: number, rawUrl: string | undefined): Promise<void> {
    if (!Number.isSafeInteger(tabId) || tabId < 0 || !clickupAPI || logoutInProgress) return;
    const settings = await readFocusedTimerSettings();
    if (!settings.autoStopTimer) return;
    await storageSessionTrustedReady;
    let exitedTaskId: string | null = null;
    await runClickUpTaskTabIndexMutation(async () => {
        const stored = await chrome.storage.session.get(CLICKUP_TASK_TAB_INDEX_SESSION_KEY);
        const transition = decideClickUpTaskTabIndexTransition(
            stored[CLICKUP_TASK_TAB_INDEX_SESSION_KEY],
            tabId,
            rawUrl,
        );
        exitedTaskId = transition.exitedTaskId;
        await chrome.storage.session.set({ [CLICKUP_TASK_TAB_INDEX_SESSION_KEY]: transition.nextIndex });
        emitCausalTrace({
            event: 'index',
            action: 'last-task-view-exit',
            outcome: transition.outcome,
            reason: exitedTaskId ? 'last-task-view-left' : 'unknown',
            rawUrl,
            tabId,
            taskId: transition.nextTaskId || transition.previousTaskId,
        });
    });
    if (exitedTaskId) {
        await runTimerWrite(() => stopTimerAfterLastTaskTabClose(exitedTaskId!, 'last-task-view-left'));
    }
}

async function clearTrackedClickUpTaskTabIndex(): Promise<void> {
    await storageSessionTrustedReady;
    await runClickUpTaskTabIndexMutation(async () => {
        await chrome.storage.session.remove(CLICKUP_TASK_TAB_INDEX_SESSION_KEY);
    });
}

async function removeTrackedClickUpTaskTab(tabId: number): Promise<string | null> {
    if (!Number.isSafeInteger(tabId) || tabId < 0) return null;
    await storageSessionTrustedReady;
    return runClickUpTaskTabIndexMutation(async () => {
        const stored = await chrome.storage.session.get(CLICKUP_TASK_TAB_INDEX_SESSION_KEY);
        const removed = removeClickUpTaskTabIndexEntry(
            stored[CLICKUP_TASK_TAB_INDEX_SESSION_KEY],
            tabId,
        );
        await chrome.storage.session.set({ [CLICKUP_TASK_TAB_INDEX_SESSION_KEY]: removed.nextIndex });
        return removed.taskId;
    });
}

async function handleTrackedClickUpTaskTabRemoved(tabId: number): Promise<void> {
    const closedTaskId = await removeTrackedClickUpTaskTab(tabId);
    emitCausalTrace({ event: 'index', action: 'last-task-view-exit', outcome: closedTaskId ? 'index-hit' : 'index-miss', reason: closedTaskId ? 'last-task-tab-closed' : 'closed-task-unknown', tabId, taskId: closedTaskId });
    if (!closedTaskId) return;
    await runTimerWrite(() => stopTimerAfterLastTaskTabClose(closedTaskId));
}

async function stopTimerAfterLastTaskTabClose(closedTaskId: string, traceReason: 'last-task-tab-closed' | 'last-task-view-left' = 'last-task-tab-closed'): Promise<void> {
    if (logoutInProgress) {
        emitCausalTrace({ event: 'guard', guard: 'auth', outcome: 'skipped', reason: 'unknown', taskId: closedTaskId });
        return;
    }
    const authState = await chrome.storage.local.get(STORAGE_KEYS.REAUTH_REQUIRED);
    if (authState[STORAGE_KEYS.REAUTH_REQUIRED] === true) {
        emitCausalTrace({ event: 'guard', guard: 'auth', outcome: 'skipped', reason: 'unknown', taskId: closedTaskId });
        return;
    }

    await meetPriorityReady;
    const meetPriorityActive = !!meetPrioritySession
        && ['awaiting-task', 'tracking', 'paused'].includes(meetPrioritySession.status);
    if (meetPriorityActive) emitCausalTrace({ event: 'guard', guard: 'meet-priority', outcome: 'skipped', reason: 'meet-priority', taskId: closedTaskId });
    if (meetPriorityActive) return;

    const settings = await readFocusedTimerSettings();
    if (!settings.autoStopTimer) {
        emitCausalTrace({ event: 'guard', guard: 'settings', outcome: 'skipped', reason: 'auto-stop-disabled', taskId: closedTaskId });
        return;
    }

    try {
        const teamId = await resolveFocusedTimerTeamId();
        if (!teamId) {
            emitCausalTrace({ event: 'guard', guard: 'team', outcome: 'skipped', reason: 'unknown', taskId: closedTaskId });
            return;
        }
        await ensureAPI();

        const runningBeforeTabQuery = await clickupAPI!.getRunningTimer(teamId);
        const runningTaskId = getRunningTaskId(runningBeforeTabQuery);
        const remainingTabs = await chrome.tabs.query({ url: 'https://app.clickup.com/*' });
        emitCausalTrace({ event: 'navigation', action: 'last-task-view-exit', outcome: 'attempted', reason: traceReason, taskId: closedTaskId });
        const action = decideLastTaskTabCloseAction(
            settings,
            closedTaskId,
            runningTaskId,
            remainingTabs.map((tab) => tab.url),
            false,
        );
        emitCausalTrace({ event: 'decision', action: action.type, outcome: action.type === 'stop' ? 'attempted' : 'skipped', reason: action.type === 'stop' ? traceReason : action.reason, taskId: closedTaskId });
        if (action.type !== 'stop') return;

        emitCausalTrace({ event: 'attempt', action: 'stop', outcome: 'attempted', reason: traceReason, taskId: closedTaskId });
        const runningBeforeStop = await clickupAPI!.getRunningTimer(teamId);
        if (getRunningTaskId(runningBeforeStop) !== closedTaskId) {
            emitCausalTrace({ event: 'guard', guard: 'running-task', outcome: 'skipped', reason: 'closed-different-task', taskId: closedTaskId });
            return;
        }
        await clickupAPI!.stopTimer(teamId);
        await updateTimerBadge('stopped');
        await chrome.storage.session.remove(FOCUSED_TIMER_SESSION_KEY);
        recordDiagnostic('timer_transition', {
            action: 'stop',
            outcome: 'stopped',
            reason: traceReason,
        });
        emitCausalTrace({ event: 'result', action: 'stop', outcome: 'stopped', reason: traceReason, taskId: closedTaskId });
    } catch (error) {
        emitCausalTrace({ event: 'result', action: 'stop', outcome: 'failure', reason: traceReason, error, taskId: closedTaskId });
        throw error;
    }
}

function scheduleFocusedTimerEvaluation(reason: string): void {
    const revision = ++focusedTimerRevision;
    if (focusedTimerDebounce) clearTimeout(focusedTimerDebounce);
    focusedTimerDebounce = setTimeout(() => {
        focusedTimerDebounce = null;
        focusedTimerQueue = focusedTimerQueue
            .then(() => evaluateFocusedTimer(revision, reason))
            .catch((error) => Logger.error('FOCUSED_TIMER_EVALUATION_FAILED', error));
    }, FOCUSED_TIMER_DEBOUNCE_MS);
}

async function evaluateFocusedTimer(revision: number, _reason: string): Promise<void> {
    if (revision !== focusedTimerRevision || logoutInProgress) return;
    const authState = await chrome.storage.local.get(STORAGE_KEYS.REAUTH_REQUIRED);
    if (authState[STORAGE_KEYS.REAUTH_REQUIRED] === true) return;
    emitCausalTrace({ event: 'listener', action: 'focused-evaluation', outcome: 'received', reason: _reason });
    await meetPriorityReady;
    if (meetPrioritySession && ['awaiting-task', 'tracking', 'paused'].includes(meetPrioritySession.status)) return;

    const settings = await readFocusedTimerSettings();
    if (!settings.autoStartTimer && !settings.autoStopTimer) return;

    const snapshot = await getFocusedTabSnapshot();
    if (!snapshot || revision !== focusedTimerRevision) return;

    const context = resolveClickUpFocusContext(snapshot.url);
    emitCausalTrace({
        event: 'navigation',
        action: 'focused-evaluation',
        outcome: 'attempted',
        rawUrl: snapshot.url,
        tabId: snapshot.tabId,
        windowId: snapshot.windowId,
        taskId: context.kind === 'task' ? context.taskId : null,
        reason: context.kind === 'task' ? context.source : context.source,
    });
    const teamId = await resolveFocusedTimerTeamId();
    if (!teamId || revision !== focusedTimerRevision) return;

    await ensureAPI();
    await runTimerWrite(async () => {
        if (revision !== focusedTimerRevision || !await isSnapshotStillFocused(snapshot)) return;

        const running = await clickupAPI!.getRunningTimer(teamId);
        if (revision !== focusedTimerRevision || !await isSnapshotStillFocused(snapshot)) return;

        const runningTaskId = getRunningTaskId(running);
        if (running && !runningTaskId) {
            Logger.warn('FOCUSED_TIMER_RUNNING_TASK_UNKNOWN');
            return;
        }

        const proposedAction = decideFocusedTimerAction(settings, context, runningTaskId);
        const suppressedTaskId = await readManualStopSuppression();
        const suppression = applyManualStopSuppression(proposedAction, suppressedTaskId);
        emitCausalTrace({
            event: 'decision',
            action: suppression.action.type,
            outcome: suppression.action.type === 'none' ? 'skipped' : 'attempted',
            reason: suppression.action.reason,
            rawUrl: snapshot.url,
            tabId: snapshot.tabId,
            windowId: snapshot.windowId,
            taskId: suppression.action.type === 'start' || suppression.action.type === 'switch' ? suppression.action.taskId : runningTaskId,
        });
        if (suppression.action.type !== 'none') {
            emitCausalTrace({ event: 'attempt', action: suppression.action.type, outcome: 'attempted', reason: suppression.action.reason, tabId: snapshot.tabId, windowId: snapshot.windowId });
        }
        const transitionResult = await executeFocusedTimerAction(suppression.action, {
            isCurrent: async () => revision === focusedTimerRevision && await isSnapshotStillFocused(snapshot),
            validateTask: (taskId) => validateFocusedTask(taskId, teamId),
            stopTimer: async () => {
                await clickupAPI!.stopTimer(teamId);
                await updateTimerBadge('stopped');
                await persistFocusedTimerState(snapshot, null);
            },
            startTimer: async (taskId) => {
                await clickupAPI!.startTimer(teamId, taskId);
                await clearManualStopSuppression();
                await updateTimerBadge('playing');
                await persistFocusedTimerState(snapshot, taskId);
            },
        });
        recordDiagnostic('timer_transition', {
            action: suppression.action.type,
            outcome: transitionResult,
            reason: sanitizeDiagnosticTimerReason(suppression.action.reason),
        });
        emitCausalTrace({
            event: 'result',
            action: suppression.action.type,
            outcome: transitionResult,
            reason: suppression.action.reason,
            rawUrl: snapshot.url,
            tabId: snapshot.tabId,
            windowId: snapshot.windowId,
            taskId: suppression.action.type === 'start' || suppression.action.type === 'switch' ? suppression.action.taskId : runningTaskId,
        });
    });
}

async function readFocusedTimerSettings(): Promise<TimerAutoSettings> {
    const stored = await chrome.storage.local.get(['autoStartTimer', 'autoStopTimer']);
    return {
        autoStartTimer: stored.autoStartTimer === true,
        autoStopTimer: stored.autoStopTimer === true,
    };
}

async function getFocusedTabSnapshot(): Promise<FocusedTabSnapshot | null> {
    const focusedWindow = await chrome.windows.getLastFocused({ populate: false });
    if (!focusedWindow.focused || typeof focusedWindow.id !== 'number') return null;

    const tabs = await chrome.tabs.query({ active: true, windowId: focusedWindow.id });
    const tab = tabs[0];
    if (!tab?.active || typeof tab.id !== 'number' || typeof tab.url !== 'string') return null;

    return { windowId: focusedWindow.id, tabId: tab.id, url: tab.url };
}

async function isSnapshotStillFocused(snapshot: FocusedTabSnapshot): Promise<boolean> {
    const current = await getFocusedTabSnapshot();
    return !!current
        && current.windowId === snapshot.windowId
        && current.tabId === snapshot.tabId
        && current.url === snapshot.url;
}

async function resolveFocusedTimerTeamId(): Promise<string | null> {
    const teams = await getTeams();
    return reconcilePreferredTeamSelection(teams);
}

function getRunningTaskId(entry: TimeEntry | null): string | null {
    const taskId = entry?.task?.id;
    if (typeof taskId === 'string' && taskId.length > 0) return taskId;
    const fallback = (entry as any)?.task?.id || (entry as any)?.tid;
    return typeof fallback === 'string' && fallback.length > 0 ? fallback : null;
}

async function validateFocusedTask(taskId: string, teamId: string): Promise<boolean> {
    recordDiagnostic('task_validation', { stage: 'direct', outcome: 'attempted' });
    try {
        const task = await clickupAPI!.getTask(taskId);
        const valid = task.id === taskId && (!task.team_id || task.team_id === teamId);
        recordDiagnostic('task_validation', { stage: 'direct', outcome: valid ? 'valid' : 'invalid' });
        return valid;
    } catch (error) {
        if (isReauthenticationRequired(error)) throw error;
        recordDiagnostic('task_validation', {
            stage: 'direct',
            outcome: 'failure',
            failureClass: classifyDiagnosticFailure(error),
            clickupCode: getDiagnosticClickUpCode(error),
        });
        if (isClickUpWorkspaceAuthorizationError(error)) {
            recordDiagnostic('task_validation', { stage: 'workspace-fallback', outcome: 'attempted' });
            try {
                const workspaceTask = await clickupAPI!.getWorkspaceTaskById(teamId, taskId);
                if (workspaceTask?.id === taskId) {
                    recordDiagnostic('task_validation', { stage: 'workspace-fallback', outcome: 'valid' });
                    return true;
                }
                recordDiagnostic('task_validation', { stage: 'workspace-fallback', outcome: 'not-found' });
                Logger.warn('FOCUSED_TIMER_TASK_NOT_IN_AUTHORIZED_WORKSPACE');
                return false;
            } catch (workspaceError) {
                if (isReauthenticationRequired(workspaceError)) throw workspaceError;
                recordDiagnostic('task_validation', {
                    stage: 'workspace-fallback',
                    outcome: 'failure',
                    failureClass: classifyDiagnosticFailure(workspaceError),
                    clickupCode: getDiagnosticClickUpCode(workspaceError),
                });
                Logger.warn(`FOCUSED_TIMER_WORKSPACE_LOOKUP_FAILED_${classifyFocusedTaskValidationFailure(workspaceError)}`);
                return false;
            }
        }
        Logger.warn(`FOCUSED_TIMER_TASK_VALIDATION_FAILED_${classifyFocusedTaskValidationFailure(error)}`);
        return false;
    }
}

function classifyFocusedTaskValidationFailure(error: unknown): string {
    const clickupCode = (error as { clickupCode?: unknown } | null)?.clickupCode;
    if (typeof clickupCode === 'string' && /^OAUTH_(023|026|027|0(?:29|3[0-9]|4[0-5]))$/.test(clickupCode)) {
        return 'WORKSPACE_NOT_AUTHORIZED';
    }
    const status = Number((error as { status?: unknown } | null)?.status);
    if (status === 401 || status === 403 || status === 404 || status === 429) return String(status);
    if (Number.isFinite(status) && status >= 500 && status <= 599) return '5XX';
    if (error instanceof TypeError) return 'NETWORK';
    return 'UNKNOWN';
}

function classifyDiagnosticFailure(error: unknown): string {
    if (isClickUpWorkspaceAuthorizationError(error)) return 'workspace-not-authorized';
    const status = Number((error as { status?: unknown } | null)?.status);
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not-found';
    if (status === 429) return 'rate-limited';
    if (Number.isFinite(status) && status >= 500 && status <= 599) return 'server-error';
    if (error instanceof TypeError) return 'network';
    return 'unknown';
}

function getDiagnosticClickUpCode(error: unknown): string | undefined {
    const value = (error as { clickupCode?: unknown } | null)?.clickupCode;
    return typeof value === 'string' ? value : undefined;
}

function sanitizeDiagnosticTimerReason(reason: string): string {
    return [
        'direct', 'inbox-notification', 'disabled', 'outside-clickup', 'inbox',
        'clickup-other', 'same-task', 'different-task', 'timer-already-running',
        'auto-start-disabled', 'manually-stopped', 'manual', 'poll',
        'last-task-tab-closed', 'last-task-view-left',
    ].includes(reason) ? reason : 'unknown';
}

async function persistFocusedTimerState(snapshot: FocusedTabSnapshot, taskId: string | null): Promise<void> {
    await chrome.storage.session.set({
        [FOCUSED_TIMER_SESSION_KEY]: {
            windowId: snapshot.windowId,
            tabId: snapshot.tabId,
            taskId,
            updatedAt: Date.now(),
        },
    });
}

async function readManualStopSuppression(): Promise<string | null> {
    const stored = await chrome.storage.session.get(AUTO_START_SUPPRESSED_TASK_SESSION_KEY);
    const taskId = stored[AUTO_START_SUPPRESSED_TASK_SESSION_KEY];
    return typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
}

async function persistManualStopSuppression(taskId: string | null): Promise<void> {
    if (!taskId) {
        await clearManualStopSuppression();
        return;
    }
    await chrome.storage.session.set({ [AUTO_START_SUPPRESSED_TASK_SESSION_KEY]: taskId });
}

async function clearManualStopSuppression(): Promise<void> {
    await chrome.storage.session.remove(AUTO_START_SUPPRESSED_TASK_SESSION_KEY);
}

async function stopRunningTimerBeforeLogout(): Promise<void> {
    if (!clickupAPI) return;
    const teamId = await resolveFocusedTimerTeamId();
    if (!teamId) return;
    const running = await clickupAPI.getRunningTimer(teamId);
    if (!running) return;
    await clickupAPI.stopTimer(teamId);
    await persistManualStopSuppression(getRunningTaskId(running));
    await updateTimerBadge('stopped');
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

async function getFreshAuthenticatedUser(): Promise<ClickUpUserResponse> {
    await ensureAPI();
    const user = await clickupAPI!.getUser();
    const validatedAt = Date.now();
    await chrome.storage.local.set({
        [STORAGE_KEYS.CACHED_USER]: user,
        [STORAGE_KEYS.CURRENT_USER_VALIDATED_AT]: validatedAt,
    });
    currentUserValidatedAt = validatedAt;
    return user;
}

async function getValidatedCurrentUserId(): Promise<number | null> {
    await ensureAPI();
    const now = Date.now();

    if (now - currentUserValidatedAt >= CURRENT_USER_VALIDATION_TTL_MS) {
        const freshUser = await clickupAPI!.getUser();
        const freshUserId = extractCurrentUserId(freshUser);
        if (!freshUserId) return null;
        await chrome.storage.local.set({
            [STORAGE_KEYS.CACHED_USER]: freshUser,
            [STORAGE_KEYS.CURRENT_USER_VALIDATED_AT]: now,
        });
        currentUserValidatedAt = now;
        return freshUserId;
    }

    return extractCurrentUserId(await getCachedUser());
}

async function getUser() {
    return await getCachedUser();
}

async function getTeams(forceRefresh = false): Promise<ClickUpTeamsResponse> {
    if (!forceRefresh) {
        const cache = await chrome.storage.local.get(STORAGE_KEYS.CACHED_TEAMS);
        if (cache[STORAGE_KEYS.CACHED_TEAMS]) {
            const cachedTeams = cache[STORAGE_KEYS.CACHED_TEAMS] as ClickUpTeamsResponse;
            recordDiagnostic('workspace_selection', {
                source: 'cache',
                outcome: 'cached',
                count: cachedTeams.teams?.length || 0,
            });
            await reconcilePreferredTeamSelection(cachedTeams);
            return cachedTeams;
        }
    }
    await ensureAPI();
    const teams = await clickupAPI!.getTeams();
    recordDiagnostic('workspace_selection', {
        source: 'remote',
        outcome: 'remote',
        count: teams.teams?.length || 0,
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.CACHED_TEAMS]: teams });
    await reconcilePreferredTeamSelection(teams);
    return teams;
}

async function reconcilePreferredTeamSelection(teams: ClickUpTeamsResponse): Promise<string | null> {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PREFERRED_TEAM);
    const current = stored[STORAGE_KEYS.PREFERRED_TEAM];
    const selected = selectAuthorizedTeamId(teams.teams, current);
    recordDiagnostic('workspace_selection', {
        source: selected ? (selected === current ? 'preferred' : 'first-authorized') : 'none',
        outcome: selected ? (selected === current ? 'selected-preferred' : 'selected-first') : 'no-workspace',
        count: teams.teams?.length || 0,
    });
    if (selected && selected !== current) {
        await chrome.storage.local.set({ [STORAGE_KEYS.PREFERRED_TEAM]: selected });
    } else if (!selected && current !== undefined) {
        await chrome.storage.local.remove(STORAGE_KEYS.PREFERRED_TEAM);
    }
    return selected;
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

function sanitizeDefaultListConfig(value: unknown): { listId: string; path?: string; listName?: string } | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const config = value as { listId?: unknown; path?: unknown; listName?: unknown };
    if (typeof config.listId !== 'string' || config.listId.length === 0 || config.listId.length > 100) return undefined;
    return {
        listId: config.listId,
        path: typeof config.path === 'string' ? config.path.slice(0, 1000) : undefined,
        listName: typeof config.listName === 'string' ? config.listName.slice(0, 500) : undefined,
    };
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
            MEET_MAPPINGS_KEY,
        ]);
        await chrome.storage.local.set({
            [STORAGE_KEYS.EMAIL_TASK_MAPPINGS_V2]: {},
            schemaVersion,
        });
        hierarchyCache = {};
    });

    mappingWriteQueue = next.catch(() => undefined);
        await next;
        await chrome.storage.session.remove([
            FOCUSED_TIMER_SESSION_KEY,
            AUTO_START_SUPPRESSED_TASK_SESSION_KEY,
            CLICKUP_TASK_TAB_INDEX_SESSION_KEY,
        ]);
        await clearTrackedClickUpTaskTabIndex();
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

async function updateTimerBadge(state: 'playing' | 'stopped' | 'paused' | 'meeting' | 'attention'): Promise<void> {
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
