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
import { ClickUpAPIWrapper, TokenRefreshCallback } from './src/services/api.service';
import { getSecureOAuthConfig, saveSecureOAuthConfig, getSecureToken } from './src/services/crypto.service';

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
    CACHED_TEAMS: 'cachedTeams',
    CACHED_USER: 'cachedUser',
    CACHED_HIERARCHY: 'hierarchyCache' // Unified cache key
};

const EXPIRATION_TIME = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

interface HierarchyData {
    spaces: ClickUpSpace[];
    lists?: ClickUpList[];
}

let clickupAPI: ClickUpAPIWrapper | null = null;
let hierarchyCache: Record<string, CacheEntry<HierarchyData>> = {};

// Default badge state
const BADGE_STATES = {
    playing: { text: "▶", color: "#4CAF50" }, // Green
    stopped: { text: "", color: "#00000000" }, // Transparent/None
    paused: { text: "II", color: "#FF9800" }  // Orange
};

// Initialize
chrome.runtime.onInstalled.addListener(() => {
    console.log('[ClickUp] Extension installed');
    chrome.contextMenus.create({
        id: "addToClickUp",
        title: "Add to ClickUp",
        contexts: ["all"]
    });
});

// Initialize API wrapper
// Token refresh logic
async function refreshAccessToken(): Promise<{ success: boolean; token?: string }> {
    try {
        // SEC-C1: Use encrypted OAuth config
        const oauthConfig = await getSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG);
        const refreshToken = await getSecureToken(STORAGE_KEYS.REFRESH_TOKEN);

        if (!refreshToken || !oauthConfig) {
            console.error('[ClickUp] Cannot refresh token: missing refresh token or config');
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
            console.error('[ClickUp] Token refresh failed:', response.status, await response.text());
            return { success: false };
        }

        const result = await response.json();
        const newToken = result.access_token;

        if (newToken) {
            console.log('[ClickUp] Token refreshed successfully');
            await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_TOKEN]: newToken });
            // Should properly close over clickupAPI if possible, or reliance on wrapper updating itself if we pass callback?
            // The wrapper calls this, gets the token, and updates itself.
            return { success: true, token: newToken };
        }

        return { success: false };

    } catch (e) {
        console.error('[ClickUp] Error refreshing token:', e);
        return { success: false };
    }
}

// Initialize API wrapper
async function initializeAPI() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN);
    const token = data[STORAGE_KEYS.AUTH_TOKEN];

    if (token) {
        clickupAPI = new ClickUpAPIWrapper(token);
        clickupAPI.setTokenRefreshCallback(refreshAccessToken);
    }
}

initializeAPI();

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    // Log meaningful data without sensitive info
    const logData = { ...message };
    if (logData.action === 'authenticate') delete logData.data; // Don't log tokens
    console.log(`[ClickUp] Background received message: ${message.action}`, message.data || (Object.keys(message).length > 2 ? message : ''));

    handleMessage(message, sender)
        .then(response => {
            console.log('[ClickUp] Sending response:', response);

            // Serialize error if present
            if (response && response.error && response.error instanceof Error) {
                sendResponse({
                    success: false,
                    error: response.error.message // Send only the message string
                });
            } else {
                sendResponse(response);
            }
        })
        .catch(error => {
            console.error('[ClickUp] Error handling message:', error);
            sendResponse({ success: false, error: error.message || 'Unknown error' });
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

                await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_TOKEN]: result.access_token });

                if (result.refresh_token) {
                    await chrome.storage.local.set({ [STORAGE_KEYS.REFRESH_TOKEN]: result.refresh_token });
                }

                await initializeAPI();
                const user = await getCachedUser();

                return { success: true, user };
            } catch (e) {
                console.error('[ClickUp] Auth failed:', e);
                return { success: false, error: String(e) };
            }

        case 'saveOAuthConfig':
            // SEC-C1: Use encrypted storage for OAuth config
            await saveSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG, data);
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
            await chrome.storage.local.remove([STORAGE_KEYS.AUTH_TOKEN, STORAGE_KEYS.REFRESH_TOKEN, STORAGE_KEYS.CACHED_USER, STORAGE_KEYS.CACHED_TEAMS]);
            clickupAPI = null;
            hierarchyCache = {};
            await chrome.action.setBadgeText({ text: '' });
            return { success: true };

        case 'checkAuth':
            await initializeAPI();
            return { authenticated: !!clickupAPI };

        case 'getStatus': // Combined status check
            try {
                await initializeAPI();
                const config = await chrome.storage.local.get(STORAGE_KEYS.PREFERRED_TEAM);
                const user = clickupAPI ? await getCachedUser().catch(() => null) : null;
                return {
                    authenticated: !!clickupAPI && !!user,
                    configured: !!config[STORAGE_KEYS.PREFERRED_TEAM],
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
                return { success: true, listCount: listCount || 0 };
            } catch (e) {
                console.error('[ClickUp] Preload failed:', e);
                return { success: false, listCount: 0 };
            }

        case 'getUser':
            return await getUser();

        case 'getSpaces':
            return await getSpaces(message.teamId || (data ? data.teamId : undefined));

        case 'getFolders':
            return await getFolders(message.spaceId || (data ? data.spaceId : undefined));

        case 'getLists':
            return await getLists(message.folderId || (data ? data.folderId : undefined));

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
            if (data.days) {
                return await syncEmailTasksByTime(data.days);
            } else if (data.emailData) {
                await syncSingleEmailTask(data.emailData);
                return { success: true };
            }
            throw new Error('Invalid sync parameters');

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
            return await clickupAPI!.getTimeEntries(data.teamId, data.start_date, data.end_date);

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
        console.error('[ClickUp] Cannot preload hierarchy: No team selected');
        return 0;
    }

    console.log('[ClickUp] Starting hierarchy preload for team:', teamId);

    try {
        const hierarchy: any = { spaces: [] };
        const spacesRes = await clickupAPI!.getSpaces(teamId);
        let totalListCount = 0;
        const totalSpaces = spacesRes.spaces.length;

        console.log(`[ClickUp] Found ${totalSpaces} spaces to sync...`);

        for (let i = 0; i < spacesRes.spaces.length; i++) {
            const space = spacesRes.spaces[i];
            const spaceData: any = { ...space, folders: [], lists: [] };

            console.log(`[ClickUp] Syncing space ${i + 1}/${totalSpaces}: "${space.name}"`);

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
            const folderPromises = foldersRes.folders.map(async (folder) => {
                const fLists = await clickupAPI!.getLists(folder.id);
                return { ...folder, lists: fLists.lists };
            });

            const foldersWithLists = await Promise.all(folderPromises);
            spaceData.folders = foldersWithLists;

            // Count lists inside folders
            for (const folder of foldersWithLists) {
                totalListCount += folder.lists.length;
            }

            console.log(`[ClickUp]   ├─ ${listsRes.lists.length} folderless lists, ${foldersRes.folders.length} folders (${totalListCount} total lists so far)`);

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
        console.log('[ClickUp] Hierarchy preload complete. Total lists:', totalListCount);

        return totalListCount;

    } catch (e) {
        console.error('[ClickUp] Hierarchy preload failed:', e);
        return 0;
    }
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
    await ensureAPI();

    // Get configured Custom Field Name
    const settings = await chrome.storage.local.get(['threadIdField']);
    const customFieldName = (settings.threadIdField || 'Gmail Thread ID').trim().toLowerCase();

    // 1. Search in local mapping first (fastest)
    // TODO: Implement local mapping check if reliable

    // 2. No default list anymore. We cannot efficiently search global tasks without context.
    // We rely on 'syncEmailTasks' (bulk) or local mapping.

    return [];
}

async function syncSingleEmailTask(emailData: EmailData) {
    const tasks = await findLinkedTasks(emailData.threadId);

    // Store in local storage for quick access by content script
    // mapping: { [threadId]: [ {id, name, status, ...} ] }
    const store = await chrome.storage.local.get(STORAGE_KEYS.EMAIL_TASK_MAPPINGS);
    const mappings = store[STORAGE_KEYS.EMAIL_TASK_MAPPINGS] || {};

    mappings[emailData.threadId] = tasks.map(t => ({
        id: t.id,
        name: t.name,
        url: t.url,
        status: t.status.status
    }));

    await chrome.storage.local.set({ [STORAGE_KEYS.EMAIL_TASK_MAPPINGS]: mappings });
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
    console.log(`[ClickUp] Email Sync: Fetching ALL tasks modified since ${new Date(dateFrom).toISOString()}...`);

    // Use paginated method to get ALL tasks, not just first 100
    const tasks = await clickupAPI!.getAllTasksSince(teamId, dateFrom);
    const totalTasks = tasks.length;
    console.log(`[ClickUp] Email Sync: Found ${totalTasks} total tasks. Scanning for Gmail Thread IDs...`);

    // Get configured settings
    const settings = await chrome.storage.local.get(['threadIdField', 'useCustomFieldForThreadId']);
    const customFieldName = (settings.threadIdField || 'Gmail Thread ID').trim().toLowerCase();
    const useCustomField = settings.useCustomFieldForThreadId !== false; // Default: true

    console.log(`[ClickUp] Email Sync: Mode: ${useCustomField ? 'Custom Field' : 'Description'}, looking for "${customFieldName}"`);

    const mappings = await chrome.storage.local.get(STORAGE_KEYS.EMAIL_TASK_MAPPINGS);
    const currentMappings = mappings[STORAGE_KEYS.EMAIL_TASK_MAPPINGS] || {};
    let foundCount = 0;

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

        if (useCustomField) {
            // Toggle ON: Search in Custom Field (supports multiple Thread IDs separated by comma)
            if (task.custom_fields && Array.isArray(task.custom_fields)) {
                const threadIdField = task.custom_fields.find((field: any) =>
                    field.name && field.name.toLowerCase() === customFieldName
                );
                if (threadIdField) {
                    threadIdValue = threadIdField.value || threadIdField.text_value || null;
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
            const threadIds = threadIdValue.split(',').map(id => id.trim()).filter(id => id.length > 0);

            for (const threadId of threadIds) {
                foundCount++;
                console.log(`[ClickUp] Email Sync: Found link in task "${task.name.substring(0, 40)}..." → Thread ${threadId}`);

                // Add to mapping
                const entry = {
                    id: task.id,
                    name: task.name,
                    url: task.url,
                    status: task.status?.status || 'unknown'
                };

                const existing = currentMappings[threadId] || [];
                if (!existing.find((t: any) => t.id === entry.id)) {
                    existing.push(entry);
                    currentMappings[threadId] = existing;
                }
            }
        }

        // Log progress every 100 tasks
        if ((i + 1) % 100 === 0) {
            console.log(`[ClickUp] Email Sync: Scanned ${i + 1}/${totalTasks} tasks (${foundCount} links found)`);
        }
    }

    console.log(`[ClickUp] Email Sync: Complete. Scanned ${totalTasks} tasks, found ${foundCount} linked.`);

    await chrome.storage.local.set({
        [STORAGE_KEYS.EMAIL_TASK_MAPPINGS]: currentMappings,
        // Save sync status for UI persistence
        'lastEmailSync': Date.now(),
        'lastEmailSyncCount': foundCount
    });

    return { success: true, foundCount };
}

async function saveEmailTaskMapping(threadId: string, task: ClickUpTask) {
    const store = await chrome.storage.local.get(STORAGE_KEYS.EMAIL_TASK_MAPPINGS);
    const mappings = store[STORAGE_KEYS.EMAIL_TASK_MAPPINGS] || {};

    const current = mappings[threadId] || [];
    // Avoid duplicates
    if (!current.find((t: any) => t.id === task.id)) {
        current.push({
            id: task.id,
            name: task.name,
            url: task.url,
            status: task.status.status
        });
        mappings[threadId] = current;
        await chrome.storage.local.set({ [STORAGE_KEYS.EMAIL_TASK_MAPPINGS]: mappings });
    }
}

// ... helper functions for searching tasks ...

async function searchTasks(query: string, teamId: string) {
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

    // 0. Extract ID from URL if present
    const urlMatch = cleanQuery.match(/\/t\/([a-zA-Z0-9]+)/);
    if (urlMatch) {
        cleanQuery = urlMatch[1];
    }

    // Truncate to avoid 413 or API errors with massive inputs
    if (cleanQuery.length > 100) {
        cleanQuery = cleanQuery.substring(0, 100);
    }

    // 1. Try as Task ID (if it looks like one: alphanumeric 5-12 chars, no spaces)
    const isPotentialId = /^[a-zA-Z0-9]{5,12}$/.test(cleanQuery) || /^#[a-zA-Z0-9]+$/.test(cleanQuery);
    if (isPotentialId) {
        try {
            const taskId = cleanQuery.replace('#', '');
            const task = await clickupAPI!.getTask(taskId);
            if (task && task.id) {
                return { tasks: [task] };
            }
        } catch (e) {
            // Ignore error, proceed to search
        }
    }

    // 2. Search API
    try {
        const results = await clickupAPI!.searchTasks(teamId, cleanQuery);
        return { tasks: results.tasks || [] };
    } catch (e) {
        console.error('[ClickUp] Search failed:', e);
        return { tasks: [] };
    }
}

async function getTaskById(taskId: string) {
    await ensureAPI();
    return await clickupAPI!.getTask(taskId);
}

async function validateTask(taskId: string) {
    await ensureAPI();
    try {
        const task = await clickupAPI!.getTask(taskId);
        return { valid: true, task };
    } catch (e) {
        return { valid: false };
    }
}

/**
 * Validate that a specific Thread ID is still linked to a task
 * Checks either custom field or description based on toggle setting
 */
async function validateTaskLink(taskId: string, threadId: string): Promise<{ valid: boolean; linked: boolean; task?: any }> {
    await ensureAPI();

    try {
        const task = await clickupAPI!.getTask(taskId);

        // Get settings
        const settings = await chrome.storage.local.get(['threadIdField', 'useCustomFieldForThreadId']);
        const customFieldName = (settings.threadIdField || 'Gmail Thread ID').trim().toLowerCase();
        const useCustomField = settings.useCustomFieldForThreadId !== false;

        let isLinked = false;

        if (useCustomField) {
            // Check custom field (supports multiple Thread IDs separated by comma)
            if (task.custom_fields && Array.isArray(task.custom_fields)) {
                const field = task.custom_fields.find((f: any) =>
                    f.name && f.name.toLowerCase() === customFieldName
                );
                const fieldValue = field?.value || field?.text_value || '';
                // Split by comma and check if threadId is in the list
                const threadIds = fieldValue.split(',').map((id: string) => id.trim());
                isLinked = threadIds.includes(threadId);
            }
        } else {
            // Check description/text_content for Thread ID pattern
            const searchText = (task.description || '') + ' ' + (task.text_content || '');
            const patterns = [
                new RegExp(`\\*\\*Thread ID:\\*\\*\\s*${threadId}`, 'i'),
                new RegExp(`Thread ID:\\s*${threadId}`, 'i'),
                new RegExp(`inbox/${threadId}`, 'i')
            ];
            isLinked = patterns.some(p => p.test(searchText));
        }

        console.log(`[ClickUp] validateTaskLink: Task ${taskId}, Thread ${threadId}, Linked: ${isLinked}`);
        return { valid: true, linked: isLinked, task };
    } catch (e) {
        return { valid: false, linked: false };
    }
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
    throw new Error('Please use the Task Modal to create tasks (Default List feature deprecated).');
}

async function attachEmailToTask(data: AttachEmailMessage): Promise<ClickUpTask> {
    await ensureAPI();

    const { taskId, emailData } = data;
    const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${emailData.threadId}`;

    // First get the task to know its list
    const task = await clickupAPI!.getTask(taskId);

    // Get configured Custom Field Name for Thread ID
    const settings = await chrome.storage.local.get(['threadIdField', 'useCustomFieldForThreadId']);
    const customFieldName = (settings.threadIdField || 'Gmail Thread ID').trim().toLowerCase();
    const useCustomField = settings.useCustomFieldForThreadId !== false; // Default: true

    // Save Thread ID based on toggle setting
    if (useCustomField && emailData.threadId && task.list?.id) {
        // Toggle ON: Save to Custom Field (supports multiple Thread IDs separated by comma)
        try {
            const customFields = await clickupAPI!.getAccessibleCustomFields(task.list.id);
            const threadIdField = customFields.fields.find(f => f.name.trim().toLowerCase() === customFieldName);

            if (threadIdField) {
                // Get existing value from task's custom fields
                const existingField = task.custom_fields?.find((f: any) =>
                    f.name && f.name.toLowerCase() === customFieldName
                );
                const existingValue = existingField?.value || existingField?.text_value || '';

                // Check if this Thread ID is already in the list
                const existingIds = existingValue ? existingValue.split(',').map((id: string) => id.trim()) : [];
                if (!existingIds.includes(emailData.threadId)) {
                    // Append new Thread ID with comma separator
                    const newValue = existingValue
                        ? `${existingValue},${emailData.threadId}`
                        : emailData.threadId;
                    await clickupAPI!.setCustomFieldValue(taskId, threadIdField.id, newValue);
                    console.log(`[ClickUp] Saved Thread ID to Custom Field "${customFieldName}" for attached task ${taskId} (total: ${existingIds.length + 1})`);
                } else {
                    console.log(`[ClickUp] Thread ID ${emailData.threadId} already linked to task ${taskId}`);
                }
            } else {
                console.warn(`[ClickUp] Custom Field "${customFieldName}" not found in list ${task.list.id}. Thread ID not saved to field.`);
            }
        } catch (e) {
            console.error('[ClickUp] Failed to set Custom Field for attached task:', e);
        }
    } else if (!useCustomField && emailData.threadId) {
        // Toggle OFF: Save to Description via Comment (can't edit task description directly via API easily)
        // We'll add thread ID in a structured comment that can be searched
        const threadIdComment = `📎 **Thread ID:** ${emailData.threadId}`;
        await clickupAPI!.addComment(taskId, threadIdComment);
        console.log(`[ClickUp] Saved Thread ID to comment for attached task ${taskId} (custom field disabled)`);
    }

    // Add comment with email link
    const commentText = `📧 **Email adjunto:** ${emailData.subject}\nFrom: ${emailData.from}\n\n🔗 [Ver email original en Gmail](${gmailUrl})`;
    await clickupAPI!.addComment(taskId, commentText);

    // Attach email HTML
    if (emailData.html) {
        await clickupAPI!.uploadAttachment(taskId, emailData.html, emailData.subject, emailData);
    }

    // Save to local mapping for quick lookup
    await saveEmailTaskMapping(emailData.threadId, task);

    return task;
}

async function createTaskFull(data: CreateTaskFullMessage): Promise<ClickUpTask> {
    await ensureAPI();
    const { listId, taskData, emailData } = data;

    // Get configured Custom Field Name
    const settings = await chrome.storage.local.get(['threadIdField', 'useCustomFieldForThreadId']);
    const customFieldName = (settings.threadIdField || 'Gmail Thread ID').trim().toLowerCase();
    const useMethod = settings.useCustomFieldForThreadId !== false; // Default: true
    console.log(`[ClickUp] Thread ID storage method: ${useMethod ? 'Custom Field' : 'Description'}, setting value: ${settings.useCustomFieldForThreadId}`);

    // 1. Get Custom Field definition from List
    let threadIdFieldId: string | null = null;
    if (useMethod && emailData && emailData.threadId) { // Only try to get field if emailData is present
        try {
            const customFields = await clickupAPI!.getAccessibleCustomFields(listId);
            const threadIdField = customFields.fields.find(f => f.name.trim().toLowerCase() === customFieldName);

            if (threadIdField) {
                threadIdFieldId = threadIdField.id;
            } else {
                console.warn(`[ClickUp] Custom Field "${customFieldName}" not found in list ${listId}. Link will NOT be saved.`);
            }
        } catch (e) {
            console.error('[ClickUp] Failed to fetch custom fields for list:', listId, e);
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
        console.log('[ClickUp] Thread ID appended to description (custom field disabled)');
    }

    // 2. Create Task
    const task = await clickupAPI!.createTask(listId, taskData);

    // 3. Link Email (Thread ID)
    if (emailData && emailData.threadId) {
        await saveEmailTaskMapping(emailData.threadId, task);

        if (threadIdFieldId) {
            try {
                await clickupAPI!.setCustomFieldValue(task.id, threadIdFieldId, emailData.threadId);
                console.log(`[ClickUp] Saved Thread ID to Custom Field "${customFieldName}" (${threadIdFieldId})`);
            } catch (e: unknown) {
                console.error('[ClickUp] Failed to set Custom Field:', e);
                const errorMessage = e instanceof Error ? e.message : String(e);
                if (errorMessage.includes('usages exceeded')) {
                    // PLAN LIMIT HIT
                    console.warn('[ClickUp] PLAN LIMIT REACHED: Custom field usages exceeded. Cannot save Thread ID.');
                    // TODO: Notify user via UI?
                    await clickupAPI!.addComment(task.id, `⚠️ **System Alert:** Could not link email Thread ID via Custom Field due to ClickUp Plan limits.\n\nThread ID: ${emailData.threadId}`);
                }
            }
        }
    }

    // 4. Attachments & Comments
    if (emailData) {
        try {
            const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${emailData.threadId}`;
            const commentText = `📧 **Email vinculado:**\n🔗 [Ver email original en Gmail](${gmailUrl})`;

            // Only add comment if we have email data, basically always if we are here
            await clickupAPI!.addComment(task.id, commentText);

            if (emailData.html) {
                await clickupAPI!.uploadAttachment(task.id, emailData.html, emailData.subject, emailData);
            }
        } catch (e) {
            console.error('[ClickUp] Failed to attach email info:', e);
        }
    }

    // 5. BUG FIX: Track Time (if specified from modal)
    if (data.timeTracked && data.teamId) {
        try {
            await clickupAPI!.createTimeEntry(data.teamId, task.id, data.timeTracked);
            console.log(`[ClickUp] Added ${data.timeTracked}ms time entry to task ${task.id}`);
        } catch (e) {
            console.error('[ClickUp] Failed to add time entry:', e);
        }
    }

    // 6. Notify Tabs
    if (chrome.tabs && emailData) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: 'taskCreated',
                data: { threadId: emailData.threadId, task }
            });
        }
    }

    return task;
}
