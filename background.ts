/**
 * ClickUp Gmail Chrome Extension - Background Service Worker
 * Handles OAuth, API calls, and message routing
 * 
 * Built with AI (Anthropic Claude) - TypeScript version
 */

import type {
    ClickUpUser,
    ClickUpUserResponse,
    ClickUpTeamsResponse,
    ClickUpSpacesResponse,
    ClickUpFoldersResponse,
    ClickUpListsResponse,
    ClickUpTask,
    ClickUpTasksResponse,
    CreateTaskPayload,
    EmailData,
    EmailTaskMapping,
    StorageData,
    MessageAction,
    ExtensionMessage
} from './src/types/clickup';

// ============================================================================
// Types
// ============================================================================

interface StorageKeys {
    TOKEN: string;
    REFRESH_TOKEN: string;
    OAUTH_CONFIG: string;
    DEFAULT_LIST: string;
    EMAIL_TASKS: string;
    TEAMS: string;
    USER: string;
}

interface OAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUrl?: string;
}

interface ExtensionStatus {
    authenticated: boolean;
    configured: boolean;
    user: ClickUpUserResponse | null;
}

interface ValidationResult {
    exists: boolean;
    reason?: string;
    error?: string;
    errorStatus?: number;
}

interface TestResult {
    success: boolean;
    message?: string;
    error?: string;
}

interface CreateTaskFullMessage {
    listId: string;
    taskData: CreateTaskPayload;
    emailData?: EmailData;
    timeTracked?: number;
    teamId?: string;
}

interface AttachEmailMessage {
    taskId: string;
    emailData: EmailData;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEYS: StorageKeys = {
    TOKEN: 'clickupToken',
    REFRESH_TOKEN: 'clickupRefreshToken',
    OAUTH_CONFIG: 'oauthConfig',
    DEFAULT_LIST: 'defaultList',
    EMAIL_TASKS: 'emailTaskMappings',
    TEAMS: 'cachedTeams',
    USER: 'cachedUser'
};

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

// ============================================================================
// State
// ============================================================================

let clickupAPI: ClickUpAPIWrapper | null = null;
let cachedTeams: ClickUpTeamsResponse | null = null;
let cachedUser: ClickUpUserResponse | null = null;

// ============================================================================
// Chrome Event Listeners
// ============================================================================

chrome.runtime.onInstalled.addListener(() => {
    console.log('[ClickUp] Extension installed');
});

chrome.runtime.onMessage.addListener((
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: any) => void
) => {
    handleMessage(message, sender).then(sendResponse);
    return true;
});

// ============================================================================
// Message Handler
// ============================================================================

async function handleMessage(
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender
): Promise<any> {
    const { action, data } = message;

    switch (action) {
        case 'getStatus':
            return await getStatus();

        case 'authenticate':
            return await startOAuthFlow();

        case 'logout':
            return await logout();

        case 'saveOAuthConfig':
            return await saveOAuthConfig(data as OAuthConfig);

        case 'getTeams':
        case 'getHierarchy':
            return await getTeams();

        case 'getSpaces':
            return await getSpaces(message.teamId || data?.teamId);

        case 'getFolders':
            return await getFolders(message.spaceId || data?.spaceId);

        case 'getLists':
            return await getLists({
                spaceId: message.spaceId || data?.spaceId,
                folderId: message.folderId || data?.folderId
            });

        case 'getMembers':
            return await getMembers(data.listId);

        case 'createTask':
            return await createTaskFromEmail(message.emailData || data);

        case 'createTaskFull':
            return await createTaskFull(message as unknown as CreateTaskFullMessage);

        case 'setDefaultList':
            await chrome.storage.local.set({ [STORAGE_KEYS.DEFAULT_LIST]: data.listId });
            return { success: true };

        case 'getTaskById':
            return await getTaskById(message.taskId || data?.taskId);

        case 'searchTasks':
            return await searchTasks(message.query || data?.query);

        case 'attachToTask':
            return await attachEmailToTask(message as unknown as AttachEmailMessage);

        case 'validateTask':
            return await validateTask(message.taskId || data?.taskId);

        case 'findLinkedTasks':
            return await findLinkedTasks(message.threadIds || data);

        case 'testTokenRefresh':
            return await testTokenRefresh();

        default:
            console.log('[ClickUp] Unknown action:', action);
            return { error: 'Unknown action' };
    }
}

// ============================================================================
// Authentication Functions
// ============================================================================

async function getStatus(): Promise<ExtensionStatus> {
    const data = await chrome.storage.local.get([
        STORAGE_KEYS.TOKEN,
        STORAGE_KEYS.OAUTH_CONFIG,
        STORAGE_KEYS.USER
    ]);

    return {
        authenticated: !!data[STORAGE_KEYS.TOKEN],
        configured: !!(data[STORAGE_KEYS.OAUTH_CONFIG]?.clientId),
        user: data[STORAGE_KEYS.USER] || null
    };
}

async function saveOAuthConfig(config: OAuthConfig): Promise<{ success: boolean }> {
    await chrome.storage.local.set({ [STORAGE_KEYS.OAUTH_CONFIG]: config });
    return { success: true };
}

async function startOAuthFlow(): Promise<{ success: boolean; user?: ClickUpUserResponse }> {
    const config = await chrome.storage.local.get(STORAGE_KEYS.OAUTH_CONFIG);
    const oauthConfig = config[STORAGE_KEYS.OAUTH_CONFIG] as OAuthConfig | undefined;

    if (!oauthConfig?.clientId || !oauthConfig?.clientSecret) {
        throw new Error('OAuth not configured');
    }

    const redirectUrl = chrome.identity.getRedirectURL();
    const authUrl = `https://app.clickup.com/api?client_id=${oauthConfig.clientId}&redirect_uri=${encodeURIComponent(redirectUrl)}`;

    try {
        const responseUrl = await chrome.identity.launchWebAuthFlow({
            url: authUrl,
            interactive: true
        });

        if (!responseUrl) {
            throw new Error('No response URL from OAuth flow');
        }

        const url = new URL(responseUrl);
        const code = url.searchParams.get('code');

        if (!code) {
            throw new Error('No authorization code received');
        }

        const tokenResponse = await fetch('https://api.clickup.com/api/v2/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: oauthConfig.clientId,
                client_secret: oauthConfig.clientSecret,
                code: code
            })
        });

        const tokenData = await tokenResponse.json();
        console.log('[ClickUp] OAuth token response:', JSON.stringify(tokenData, null, 2));

        if (tokenData.access_token) {
            await chrome.storage.local.set({
                [STORAGE_KEYS.TOKEN]: tokenData.access_token,
                [STORAGE_KEYS.REFRESH_TOKEN]: tokenData.refresh_token || null
            });

            clickupAPI = new ClickUpAPIWrapper(tokenData.access_token);
            const user = await clickupAPI.getUser();
            await chrome.storage.local.set({ [STORAGE_KEYS.USER]: user });

            return { success: true, user };
        }

        throw new Error(tokenData.error || 'Failed to get token');

    } catch (error) {
        console.error('[ClickUp] OAuth error:', error);
        throw error;
    }
}

async function logout(): Promise<{ success: boolean }> {
    await chrome.storage.local.remove([
        STORAGE_KEYS.TOKEN,
        STORAGE_KEYS.REFRESH_TOKEN,
        STORAGE_KEYS.USER,
        STORAGE_KEYS.TEAMS
    ]);
    clickupAPI = null;
    cachedTeams = null;
    cachedUser = null;
    return { success: true };
}

async function refreshToken(): Promise<boolean> {
    console.log('[ClickUp] Attempting token refresh...');

    const config = await chrome.storage.local.get([
        STORAGE_KEYS.OAUTH_CONFIG,
        STORAGE_KEYS.REFRESH_TOKEN
    ]);

    const oauthConfig = config[STORAGE_KEYS.OAUTH_CONFIG] as OAuthConfig | undefined;
    const refreshTokenValue = config[STORAGE_KEYS.REFRESH_TOKEN] as string | null;

    if (!refreshTokenValue || !oauthConfig?.clientId) {
        console.log('[ClickUp] No refresh token available');
        return false;
    }

    try {
        const response = await fetch('https://api.clickup.com/api/v2/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: oauthConfig.clientId,
                client_secret: oauthConfig.clientSecret,
                refresh_token: refreshTokenValue,
                grant_type: 'refresh_token'
            })
        });

        const tokenData = await response.json();

        if (tokenData.access_token) {
            await chrome.storage.local.set({
                [STORAGE_KEYS.TOKEN]: tokenData.access_token,
                [STORAGE_KEYS.REFRESH_TOKEN]: tokenData.refresh_token || refreshTokenValue
            });

            clickupAPI = new ClickUpAPIWrapper(tokenData.access_token);
            console.log('[ClickUp] Token refreshed successfully');
            return true;
        }

        console.error('[ClickUp] Token refresh failed:', tokenData.error);
        return false;

    } catch (error) {
        console.error('[ClickUp] Token refresh error:', error);
        return false;
    }
}

async function testTokenRefresh(): Promise<TestResult> {
    console.log('[ClickUp] Starting token/auth test...');

    try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.TOKEN, STORAGE_KEYS.REFRESH_TOKEN]);
        const originalToken = data[STORAGE_KEYS.TOKEN] as string | undefined;

        if (!originalToken) {
            return { success: false, error: 'No token found. Please authenticate first.' };
        }

        console.log('[ClickUp] Note: ClickUp tokens do not expire');

        console.log('[ClickUp] Verifying current token...');
        try {
            const user = await clickupAPI!.getUser();
            console.log('[ClickUp] Current token valid. User:', user.user?.username);
        } catch (e: any) {
            return { success: false, error: 'Current token is invalid: ' + e.message };
        }

        console.log('[ClickUp] Testing with corrupted token...');
        await chrome.storage.local.set({ [STORAGE_KEYS.TOKEN]: 'CORRUPTED_TOKEN_TEST' });
        clickupAPI = new ClickUpAPIWrapper('CORRUPTED_TOKEN_TEST');

        try {
            await clickupAPI.getUser();
            return { success: false, error: 'Corrupted token was accepted (unexpected)' };

        } catch (apiError: any) {
            console.log('[ClickUp] Got expected error:', apiError.message);

            await chrome.storage.local.set({ [STORAGE_KEYS.TOKEN]: originalToken });
            clickupAPI = new ClickUpAPIWrapper(originalToken);

            try {
                const user = await clickupAPI.getUser();
                return {
                    success: true,
                    message: `401 handling works! Token restored. User: ${user.user?.username || 'verified'}`
                };
            } catch (e: any) {
                return { success: false, error: 'Failed to restore token: ' + e.message };
            }
        }

    } catch (error: any) {
        console.error('[ClickUp] Token test error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// Data Fetching Functions
// ============================================================================

async function getTeams(): Promise<ClickUpTeamsResponse> {
    await ensureAPI();
    if (!cachedTeams) {
        cachedTeams = await clickupAPI!.getTeams();
        await chrome.storage.local.set({ [STORAGE_KEYS.TEAMS]: cachedTeams });
    }
    return cachedTeams;
}

async function getSpaces(teamId: string): Promise<ClickUpSpacesResponse> {
    await ensureAPI();
    return await clickupAPI!.getSpaces(teamId);
}

async function getFolders(spaceId: string): Promise<ClickUpFoldersResponse> {
    await ensureAPI();
    return await clickupAPI!.getFolders(spaceId);
}

async function getLists(data: { spaceId?: string; folderId?: string }): Promise<ClickUpListsResponse> {
    await ensureAPI();
    if (data.folderId) {
        return await clickupAPI!.getListsInFolder(data.folderId);
    }
    return await clickupAPI!.getListsInSpace(data.spaceId!);
}

async function getMembers(listId: string): Promise<any> {
    await ensureAPI();
    return await clickupAPI!.getListMembers(listId);
}

async function getTaskById(taskId: string): Promise<ClickUpTask | null> {
    try {
        await ensureAPI();
        const task = await clickupAPI!.getTask(taskId);
        return task;
    } catch (error: any) {
        console.log('[ClickUp] Task lookup failed:', taskId, error.message);
        return null;
    }
}

async function searchTasks(query: string): Promise<ClickUpTasksResponse> {
    await ensureAPI();
    if (!cachedTeams) {
        cachedTeams = await clickupAPI!.getTeams();
    }
    const teamId = cachedTeams.teams[0]?.id;
    if (!teamId) return { tasks: [] };

    return await clickupAPI!.searchTasks(teamId, query);
}

// ============================================================================
// Task Creation Functions
// ============================================================================

async function createTaskFromEmail(emailData: EmailData): Promise<ClickUpTask> {
    await ensureAPI();

    const data = await chrome.storage.local.get(STORAGE_KEYS.DEFAULT_LIST);
    const defaultList = data[STORAGE_KEYS.DEFAULT_LIST] as string | undefined;

    if (!defaultList) {
        throw new Error('No default list configured');
    }

    const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${emailData.threadId}`;

    const taskData: CreateTaskPayload = {
        name: emailData.subject || 'Email Task',
        description: `📧 **Email from:** ${emailData.from}\n\n`
    };

    const task = await clickupAPI!.createTask(defaultList, taskData);
    await saveEmailTaskMapping(emailData.threadId, task);

    try {
        const commentText = `📧 **Email vinculado:**\n🔗 [Ver email original en Gmail](${gmailUrl})\n\n_Thread ID: ${emailData.threadId}_`;
        await clickupAPI!.addComment(task.id, commentText);
    } catch (e) {
        console.error('[ClickUp] Failed to add comment:', e);
    }

    if (emailData.html) {
        try {
            await clickupAPI!.uploadAttachment(task.id, emailData.html, emailData.subject, emailData);
        } catch (e) {
            console.error('[ClickUp] Failed to upload attachment:', e);
        }
    }

    if (chrome.tabs) {
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

async function attachEmailToTask(data: AttachEmailMessage): Promise<ClickUpTask> {
    await ensureAPI();

    const { taskId, emailData } = data;
    const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${emailData.threadId}`;

    const commentText = `📧 **Email adjuntado:**\n🔗 [Ver en Gmail](${gmailUrl})\n\n**From:** ${emailData.from}\n**Subject:** ${emailData.subject}`;
    await clickupAPI!.addComment(taskId, commentText);

    if (emailData.html) {
        await clickupAPI!.uploadAttachment(taskId, emailData.html, emailData.subject, emailData);
    }

    const task = await clickupAPI!.getTask(taskId);
    await saveEmailTaskMapping(emailData.threadId, task);

    return task;
}

async function createTaskFull(message: CreateTaskFullMessage): Promise<ClickUpTask> {
    await ensureAPI();

    const { listId, taskData, emailData, timeTracked, teamId } = message;

    if (!listId) {
        throw new Error('No list selected');
    }

    const task = await clickupAPI!.createTask(listId, taskData);

    if (emailData?.threadId) {
        const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${emailData.threadId}`;
        try {
            const commentText = `📧 **Email vinculado:**\n🔗 [Ver email original en Gmail](${gmailUrl})\n\n_Thread ID: ${emailData.threadId}_`;
            await clickupAPI!.addComment(task.id, commentText);
        } catch (e) {
            console.error('[ClickUp] Failed to add comment:', e);
        }

        if (emailData.html) {
            try {
                await clickupAPI!.uploadAttachment(task.id, emailData.html, emailData.subject || 'Email', emailData);
            } catch (e) {
                console.error('[ClickUp] Failed to upload attachment:', e);
            }
        }

        await saveEmailTaskMapping(emailData.threadId, task);
    }

    if (timeTracked && teamId) {
        try {
            await clickupAPI!.trackTime(task.id, teamId, timeTracked);
        } catch (e) {
            console.error('[ClickUp] Failed to track time:', e);
        }
    }

    if (chrome.tabs && emailData?.threadId) {
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

// ============================================================================
// Storage Functions
// ============================================================================

async function saveEmailTaskMapping(threadId: string, task: ClickUpTask): Promise<void> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.EMAIL_TASKS);
    const mappings = (data[STORAGE_KEYS.EMAIL_TASKS] || {}) as Record<string, EmailTaskMapping[]>;

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

    await chrome.storage.local.set({ [STORAGE_KEYS.EMAIL_TASKS]: mappings });
}

async function validateTask(taskId: string): Promise<ValidationResult> {
    try {
        await ensureAPI();
        const task = await clickupAPI!.getTask(taskId);

        if (task.archived) {
            return { exists: false, reason: 'archived' };
        }

        return { exists: !!(task && task.id), reason: 'exists' };
    } catch (error: any) {
        const status = error.status || 0;
        const errorMsg = (error.message || '').toLowerCase();

        if (status === 404 || status === 403) {
            return { exists: false, reason: 'api_error', errorStatus: status };
        }

        if (errorMsg.includes('not found') || errorMsg.includes('deleted') || errorMsg.includes('does not exist')) {
            return { exists: false, reason: 'deleted', error: error.message };
        }

        return { exists: true, error: error.message };
    }
}

async function findLinkedTasks(threadIds: string[]): Promise<Record<string, EmailTaskMapping[]>> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.EMAIL_TASKS);
    const mappings = (data[STORAGE_KEYS.EMAIL_TASKS] || {}) as Record<string, EmailTaskMapping[]>;

    const result: Record<string, EmailTaskMapping[]> = {};
    for (const threadId of threadIds) {
        if (mappings[threadId]) {
            result[threadId] = mappings[threadId];
        }
    }

    return result;
}

async function ensureAPI(): Promise<void> {
    if (!clickupAPI) {
        const data = await chrome.storage.local.get(STORAGE_KEYS.TOKEN);
        if (data[STORAGE_KEYS.TOKEN]) {
            clickupAPI = new ClickUpAPIWrapper(data[STORAGE_KEYS.TOKEN]);
        } else {
            throw new Error('Not authenticated');
        }
    }
}

// ============================================================================
// ClickUp API Wrapper Class
// ============================================================================

interface ApiError extends Error {
    status?: number;
    requiresReauth?: boolean;
}

class ClickUpAPIWrapper {
    private token: string;

    constructor(token: string) {
        this.token = token;
    }

    private static readonly MAX_RETRIES = 3;
    private static readonly RETRY_STATUS_CODES = [429, 500, 502, 503, 504];

    async request<T = any>(endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<T> {
        try {
            const response = await fetch(`${CLICKUP_API_BASE}${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': this.token,
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            // Handle 401 Unauthorized - try to refresh token once
            if (response.status === 401 && retryCount === 0) {
                console.log('[ClickUp] Got 401 Unauthorized, attempting token refresh...');
                const refreshed = await refreshToken();
                if (refreshed) {
                    const data = await chrome.storage.local.get(STORAGE_KEYS.TOKEN);
                    this.token = data[STORAGE_KEYS.TOKEN];
                    return this.request(endpoint, options, 1);
                }
                const err: ApiError = new Error('Authentication failed. Please sign out and sign in again.');
                err.status = 401;
                err.requiresReauth = true;
                throw err;
            }

            // Handle rate limiting and server errors with exponential backoff
            if (ClickUpAPIWrapper.RETRY_STATUS_CODES.includes(response.status) && retryCount < ClickUpAPIWrapper.MAX_RETRIES) {
                const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
                console.log(`[ClickUp] Got ${response.status}, retrying in ${delay}ms (attempt ${retryCount + 1}/${ClickUpAPIWrapper.MAX_RETRIES})`);
                await this.sleep(delay);
                return this.request(endpoint, options, retryCount + 1);
            }

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                const err: ApiError = new Error(error.err || `API Error: ${response.status}`);
                err.status = response.status;
                throw err;
            }

            return response.json();
        } catch (error: any) {
            // Handle network errors with retry
            if (error.name === 'TypeError' && error.message.includes('fetch') && retryCount < ClickUpAPIWrapper.MAX_RETRIES) {
                const delay = Math.pow(2, retryCount) * 1000;
                console.log(`[ClickUp] Network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${ClickUpAPIWrapper.MAX_RETRIES})`);
                await this.sleep(delay);
                return this.request(endpoint, options, retryCount + 1);
            }
            throw error;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getUser(): Promise<ClickUpUserResponse> {
        return this.request('/user');
    }

    async getTeams(): Promise<ClickUpTeamsResponse> {
        return this.request('/team');
    }

    async getSpaces(teamId: string): Promise<ClickUpSpacesResponse> {
        return this.request(`/team/${teamId}/space`);
    }

    async getFolders(spaceId: string): Promise<ClickUpFoldersResponse> {
        return this.request(`/space/${spaceId}/folder`);
    }

    async getListsInSpace(spaceId: string): Promise<ClickUpListsResponse> {
        return this.request(`/space/${spaceId}/list`);
    }

    async getListsInFolder(folderId: string): Promise<ClickUpListsResponse> {
        return this.request(`/folder/${folderId}/list`);
    }

    async getListMembers(listId: string): Promise<any> {
        return this.request(`/list/${listId}/member`);
    }

    async createTask(listId: string, taskData: CreateTaskPayload): Promise<ClickUpTask> {
        return this.request(`/list/${listId}/task`, {
            method: 'POST',
            body: JSON.stringify(taskData)
        });
    }

    async getTask(taskId: string): Promise<ClickUpTask> {
        return this.request(`/task/${taskId}`);
    }

    async addComment(taskId: string, commentText: string): Promise<any> {
        return this.request(`/task/${taskId}/comment`, {
            method: 'POST',
            body: JSON.stringify({ comment_text: commentText })
        });
    }

    async searchTasks(teamId: string, query: string): Promise<ClickUpTasksResponse> {
        return this.request(`/team/${teamId}/task?query=${encodeURIComponent(query)}`);
    }

    async uploadAttachment(
        taskId: string,
        html: string,
        subject: string,
        emailData: EmailData | null = null
    ): Promise<any> {
        const formData = new FormData();
        const filename = (subject || 'Email').replace(/[<>:"/\\|?*]/g, '').substring(0, 100) + '.html';

        const htmlBlob = new Blob([html], { type: 'text/html' });
        formData.append('attachment', htmlBlob, filename);

        if (emailData?.threadId) {
            const emailLinkData = JSON.stringify({
                id: emailData.threadId,
                subject: emailData.subject || subject,
                from: emailData.from || '',
                email: emailData.email || emailData.userEmail || '',
                msg: emailData.threadId,
                client: 'gmail'
            });
            formData.append('email', emailLinkData);
        }

        const response = await fetch(`${CLICKUP_API_BASE}/task/${taskId}/attachment`, {
            method: 'POST',
            headers: { 'Authorization': this.token },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
        }

        return response.json();
    }

    async trackTime(taskId: string, teamId: string, duration: number): Promise<any> {
        const now = Date.now();
        return this.request(`/team/${teamId}/time_entries`, {
            method: 'POST',
            body: JSON.stringify({
                tid: taskId,
                start: now - duration,
                duration: duration
            })
        });
    }
}
