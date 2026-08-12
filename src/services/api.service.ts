/**
 * ClickUp API Service
 * Wrapper for ClickUp API v2 with retry logic and token refresh handling
 */

import type {
    ClickUpUserResponse,
    ClickUpTeamsResponse,
    ClickUpSpacesResponse,
    ClickUpFoldersResponse,
    ClickUpListsResponse,
    ClickUpList,
    ClickUpTask,
    ClickUpTasksResponse,
    CreateTaskPayload,
    EmailData,
    TimeEntry,
    ClickUpCustomFieldsResponse
} from '../types/clickup';
import { calculateRetryDelayMs } from '../link-hardening';
import { wrapSanitizedEmailHtml } from '../utils/sanitize.utils';

// ============================================================================
// Constants
// ============================================================================

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';
const MAX_RESTORED_BLOCK_MS = 15 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

interface ApiError extends Error {
    status?: number;
    requiresReauth?: boolean;
}

interface TimeEntryResponse {
    data: TimeEntry[];
}

export type TokenRefreshCallback = () => Promise<{ success: boolean; token?: string }>;

export interface RateGovernorState {
    intervalMs?: unknown;
    blockedUntil?: unknown;
}

export type RateGovernorStateCallback = (state: { intervalMs: number; blockedUntil: number }) => void | Promise<void>;

export interface TaskPageProgress {
    page: number;
    pageSize: number;
    totalFetched: number;
}

function sanitizeRateGovernorState(state?: RateGovernorState | null, now = Date.now()): { intervalMs?: number; blockedUntil?: number } {
    if (!state || typeof state !== 'object') return {};
    const intervalMs = Number(state.intervalMs);
    const blockedUntil = Number(state.blockedUntil);
    const maxBlockedUntil = now + MAX_RESTORED_BLOCK_MS;
    return {
        ...(Number.isFinite(intervalMs) && intervalMs >= 50 && intervalMs <= 60_000 ? { intervalMs: Math.floor(intervalMs) } : {}),
        ...(Number.isFinite(blockedUntil) && blockedUntil >= 0 && blockedUntil <= maxBlockedUntil ? { blockedUntil: Math.floor(blockedUntil) } : {}),
    };
}

export class ClickUpRateGovernor {
    private nextSlotAt = 0;
    private intervalMs = 600; // conservative 100 req/min default
    private blockedUntil = 0;
    private reserveQueue: Promise<void> = Promise.resolve();

    constructor(
        private readonly sleepFn: (ms: number) => Promise<void> = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
        private readonly nowFn: () => number = () => Date.now(),
        initialState?: RateGovernorState | null,
        private readonly onStateChange?: RateGovernorStateCallback,
    ) {
        const sanitized = sanitizeRateGovernorState(initialState, this.nowFn());
        if (sanitized.intervalMs !== undefined) this.intervalMs = sanitized.intervalMs;
        if (sanitized.blockedUntil !== undefined) this.blockedUntil = sanitized.blockedUntil;
    }

    async reserve(): Promise<void> {
        const next = this.reserveQueue.then(() => this.reserveInternal());
        this.reserveQueue = next.catch(() => undefined);
        return next;
    }

    private async reserveInternal(): Promise<void> {
        let logicalNow = this.nowFn();
        for (let i = 0; i < 10; i++) {
            const waitUntil = Math.max(this.nextSlotAt, this.blockedUntil);
            const waitMs = Math.max(0, waitUntil - logicalNow);
            if (waitMs <= 0) break;
            await this.sleepFn(waitMs);
            logicalNow = Math.max(this.nowFn(), logicalNow + waitMs);
        }
        const afterWait = Math.max(this.nowFn(), logicalNow);
        this.nextSlotAt = Math.max(afterWait, this.nextSlotAt) + this.intervalMs;
    }

    observe(headers: Headers | null | undefined): void {
        if (!headers) return;
        const previousInterval = this.intervalMs;
        const previousBlockedUntil = this.blockedUntil;
        const limit = Number(headers.get('X-RateLimit-Limit'));
        const remaining = Number(headers.get('X-RateLimit-Remaining'));
        const reset = Number(headers.get('X-RateLimit-Reset'));
        if (Number.isFinite(limit) && limit > 0) {
            this.intervalMs = Math.max(50, Math.ceil(60_000 / limit));
        }
        if (Number.isFinite(remaining) && remaining <= 0 && Number.isFinite(reset) && reset > 0) {
            const resetMs = reset > 10_000_000_000 ? reset : reset * 1000;
            const boundedResetMs = Math.min(resetMs, this.nowFn() + MAX_RESTORED_BLOCK_MS);
            this.blockedUntil = Math.max(this.blockedUntil, boundedResetMs);
        }
        if (this.intervalMs !== previousInterval || this.blockedUntil !== previousBlockedUntil) {
            this.persistStateSafely();
        }
    }

    deferFor(delayMs: number): void {
        if (!Number.isFinite(delayMs) || delayMs <= 0) return;
        const boundedDelay = Math.min(Math.floor(delayMs), MAX_RESTORED_BLOCK_MS);
        const previousBlockedUntil = this.blockedUntil;
        this.blockedUntil = Math.max(this.blockedUntil, this.nowFn() + boundedDelay);
        if (this.blockedUntil !== previousBlockedUntil) this.persistStateSafely();
    }

    getIntervalMs(): number {
        return this.intervalMs;
    }

    getState(): { intervalMs: number; blockedUntil: number } {
        return { intervalMs: this.intervalMs, blockedUntil: this.blockedUntil };
    }

    private async persistState(): Promise<void> {
        if (!this.onStateChange) return;
        await this.onStateChange(this.getState());
    }

    private persistStateSafely(): void {
        void this.persistState().catch(() => undefined);
    }
}

// ============================================================================
// ClickUp API Wrapper Class
// ============================================================================

export class ClickUpAPIWrapper {
    private token: string;
    private onTokenRefresh: TokenRefreshCallback | null = null;
    private governor: ClickUpRateGovernor;

    private static readonly MAX_RETRIES = 3;
    private static readonly RETRY_STATUS_CODES = [429, 500, 502, 503, 504];

    constructor(token: string, governor: ClickUpRateGovernor = new ClickUpRateGovernor()) {
        this.token = token;
        this.governor = governor;
    }

    /**
     * Set callback for token refresh (injected to avoid circular dependency)
     */
    setTokenRefreshCallback(callback: TokenRefreshCallback): void {
        this.onTokenRefresh = callback;
    }

    /**
     * Update the token (called after refresh)
     */
    updateToken(newToken: string): void {
        this.token = newToken;
    }

    /**
     * Generic API request with retry and 401 handling
     */
    async request<T = any>(endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<T> {
        try {
            const method = normalizeRequestMethod(options.method);
            const response = await this.fetchWithGovernor(`${CLICKUP_API_BASE}${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': this.token,
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            // Handle 401 Unauthorized - try to refresh token once
            if (response.status === 401 && retryCount === 0 && this.onTokenRefresh) {
                console.log('[API] AUTH_RETRY');
                const result = await this.onTokenRefresh();
                if (result.success && result.token) {
                    this.token = result.token;
                    return this.request(endpoint, options, 1);
                }
                const err: ApiError = new Error('Authentication failed. Please sign out and sign in again.');
                err.status = 401;
                err.requiresReauth = true;
                throw err;
            }

            // Handle rate limiting and server errors with exponential backoff
            if (this.shouldRetryResponse(response.status, method) && retryCount < ClickUpAPIWrapper.MAX_RETRIES) {
                const delay = response.status === 429
                    ? calculateRetryDelayMs(response.headers, retryCount)
                    : Math.min(Math.pow(2, retryCount) * 1000 + Math.floor(Math.random() * 250), 60_000);
                if (response.status === 429) this.governor.deferFor(delay);
                console.log('[API] RETRY_STATUS');
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
            const method = normalizeRequestMethod(options.method);
            if (this.shouldRetryNetworkError(error, method) && retryCount < ClickUpAPIWrapper.MAX_RETRIES) {
                const delay = Math.min(Math.pow(2, retryCount) * 1000 + Math.floor(Math.random() * 250), 60_000);
                console.log('[API] RETRY_NETWORK');
                await this.sleep(delay);
                return this.request(endpoint, options, retryCount + 1);
            }
            throw error;
        }
    }

    private shouldRetryResponse(status: number, method: string): boolean {
        if (!ClickUpAPIWrapper.RETRY_STATUS_CODES.includes(status)) return false;
        if (status === 429) return true;
        return isSafeReadMethod(method);
    }

    private shouldRetryNetworkError(error: any, method: string): boolean {
        return error?.name === 'TypeError' && String(error?.message || '').includes('fetch') && isSafeReadMethod(method);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async fetchWithGovernor(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        await this.governor.reserve();
        const response = await fetch(input, init);
        this.governor.observe(response.headers);
        return response;
    }

    private async requestFormData<T = any>(endpoint: string, formData: FormData, retryCount = 0): Promise<T> {
        try {
            const response = await this.fetchWithGovernor(`${CLICKUP_API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Authorization': this.token },
                body: formData
            });

            if (response.status === 401 && retryCount === 0 && this.onTokenRefresh) {
                console.log('[API] AUTH_RETRY');
                const result = await this.onTokenRefresh();
                if (result.success && result.token) {
                    this.token = result.token;
                    return this.requestFormData(endpoint, formData, 1);
                }
                const err: ApiError = new Error('Authentication failed. Please sign out and sign in again.');
                err.status = 401;
                err.requiresReauth = true;
                throw err;
            }

            if (this.shouldRetryResponse(response.status, 'POST') && retryCount < ClickUpAPIWrapper.MAX_RETRIES) {
                const delay = response.status === 429
                    ? calculateRetryDelayMs(response.headers, retryCount)
                    : Math.min(Math.pow(2, retryCount) * 1000 + Math.floor(Math.random() * 250), 60_000);
                if (response.status === 429) this.governor.deferFor(delay);
                console.log('[API] RETRY_STATUS');
                await this.sleep(delay);
                return this.requestFormData(endpoint, formData, retryCount + 1);
            }

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                const err: ApiError = new Error(error.err || `API Error: ${response.status}`);
                err.status = response.status;
                throw err;
            }

            return response.json();
        } catch (error: any) {
            if (this.shouldRetryNetworkError(error, 'POST') && retryCount < ClickUpAPIWrapper.MAX_RETRIES) {
                const delay = Math.min(Math.pow(2, retryCount) * 1000 + Math.floor(Math.random() * 250), 60_000);
                console.log('[API] RETRY_NETWORK');
                await this.sleep(delay);
                return this.requestFormData(endpoint, formData, retryCount + 1);
            }
            throw error;
        }
    }

    // ========================================================================
    // User & Teams
    // ========================================================================

    async getUser(): Promise<ClickUpUserResponse> {
        return this.request('/user');
    }

    async getTeams(): Promise<ClickUpTeamsResponse> {
        return this.request('/team');
    }

    // ========================================================================
    // Hierarchy
    // ========================================================================

    async getSpaces(teamId: string): Promise<ClickUpSpacesResponse> {
        return this.request(`/team/${teamId}/space`);
    }

    async getFolders(spaceId: string): Promise<ClickUpFoldersResponse> {
        return this.request(`/space/${spaceId}/folder`);
    }

    async getListsInSpace(spaceId: string): Promise<ClickUpListsResponse> {
        return this.request(`/space/${spaceId}/list`);
    }

    // Alias for background.ts compatibility
    async getFolderlessLists(spaceId: string): Promise<ClickUpListsResponse> {
        return this.getListsInSpace(spaceId);
    }

    // ... (existing code) ...

    async getListsInFolder(folderId: string): Promise<ClickUpListsResponse> {
        return this.request(`/folder/${folderId}/list`);
    }

    // Alias for background.ts compatibility
    async getLists(folderId: string): Promise<ClickUpListsResponse> {
        return this.getListsInFolder(folderId);
    }

    async getListMembers(listId: string): Promise<any> {
        return this.request(`/list/${listId}/member`);
    }

    async getList(listId: string): Promise<ClickUpList> {
        return this.request(`/list/${listId}`);
    }

    // Alias for background.ts compatibility
    async getMembers(listId: string): Promise<any> {
        return this.getListMembers(listId);
    }

    // ========================================================================
    // Custom Fields
    // ========================================================================

    async getAccessibleCustomFields(listId: string): Promise<ClickUpCustomFieldsResponse> {
        return this.request(`/list/${listId}/field`);
    }

    async setCustomFieldValue(taskId: string, fieldId: string, value: any): Promise<any> {
        return this.request(`/task/${taskId}/field/${fieldId}`, {
            method: 'POST',
            body: JSON.stringify({ value })
        });
    }

    // ========================================================================
    // Tasks
    // ========================================================================

    async createTask(listId: string, taskData: CreateTaskPayload): Promise<ClickUpTask> {
        return this.request(`/list/${listId}/task`, {
            method: 'POST',
            body: JSON.stringify(taskData)
        });
    }

    async getTask(taskId: string): Promise<ClickUpTask> {
        return this.request(`/task/${taskId}`);
    }

    async getWorkspaceTasksPage(teamId: string, page: number): Promise<ClickUpTasksResponse> {
        const safePage = Number.isInteger(page) && page >= 0 ? page : 0;
        return this.request(`/team/${teamId}/task?include_closed=true&subtasks=true&page=${safePage}`);
    }

    async getTasks(listId: string): Promise<ClickUpTasksResponse> {
        return this.request(`/list/${listId}/task`);
    }

    async getRecentTasks(teamId: string, dateFrom: number): Promise<ClickUpTask[]> {
        // Note: Custom fields are included by default in task responses
        const result = await this.request(
            `/team/${teamId}/task?include_closed=true&date_updated_gt=${dateFrom}&page=0`
        );
        return result.tasks || [];
    }

    /**
     * Get ALL tasks modified since a date, with pagination
     * Iterates through all pages until no more results
     */
    async getAllTasksSince(
        teamId: string,
        dateFrom: number,
        onPage?: (progress: TaskPageProgress) => void
    ): Promise<ClickUpTask[]> {
        const allTasks: ClickUpTask[] = [];
        let page = 0;
        let hasMore = true;

        while (hasMore) {
            const result = await this.request(
                `/team/${teamId}/task?include_closed=true&date_updated_gt=${dateFrom}&page=${page}`
            );

            const tasks = result.tasks || [];
            allTasks.push(...tasks);
            onPage?.({
                page: page + 1,
                pageSize: tasks.length,
                totalFetched: allTasks.length,
            });

            // ClickUp returns max 100 per page, if less then we're done
            if (tasks.length < 100) {
                hasMore = false;
            } else {
                page++;
            }

            // Safety limit to prevent infinite loops
            if (page > 50) {
                console.warn('[API] getAllTasksSince: Reached page limit (50)');
                hasMore = false;
            }
        }

        return allTasks;
    }

    // ========================================================================
    // Comments & Attachments
    // ========================================================================

    async addComment(taskId: string, commentText: string): Promise<any> {
        return this.request(`/task/${taskId}/comment`, {
            method: 'POST',
            body: JSON.stringify({ comment_text: commentText })
        });
    }

    async getTaskComments(taskId: string): Promise<any[]> {
        const result = await this.request(`/task/${taskId}/comment`);
        return result.comments || [];
    }

    async uploadAttachment(
        taskId: string,
        html: string,
        subject: string,
        emailData: EmailData | null = null
    ): Promise<any> {
        if (html && emailData?.htmlSanitized !== true) {
            throw new Error('El HTML del email debe estar sanitizado antes de subirlo.');
        }
        const formData = new FormData();
        const filename = (subject || 'Email sanitizado').replace(/[<>:"/\\|?*]/g, '').substring(0, 100) + '.html';

        const safeHtml = wrapSanitizedEmailHtml(html, emailData?.htmlSanitized === true);
        const htmlBlob = new Blob([safeHtml], { type: 'text/html' });
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

        return this.requestFormData(`/task/${taskId}/attachment`, formData);
    }

    // ========================================================================
    // Time Tracking
    // ========================================================================

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

    async startTimer(teamId: string, taskId: string): Promise<any> {
        return this.request(`/team/${teamId}/time_entries/start`, {
            method: 'POST',
            body: JSON.stringify({
                tid: taskId,
                billable: true
            })
        });
    }

    async stopTimer(teamId: string): Promise<any> {
        return this.request(`/team/${teamId}/time_entries/stop`, {
            method: 'POST'
        });
    }

    async getRunningTimer(teamId: string): Promise<TimeEntry | null> {
        const response = await this.request<TimeEntryResponse>(
            `/team/${teamId}/time_entries/current`
        );
        return (response.data as any) || null;
    }

    async createTimeEntry(
        teamId: string,
        taskId: string,
        duration: number,
        start?: number
    ): Promise<any> {
        const startTime = start || (Date.now() - duration);
        return this.request(`/team/${teamId}/time_entries`, {
            method: 'POST',
            body: JSON.stringify({
                tid: taskId,
                start: startTime,
                duration: duration,
                billable: true
            })
        });
    }

    async getTimeEntries(
        teamId: string,
        startDate?: number,
        endDate?: number,
        assigneeId?: number
    ): Promise<TimeEntry[]> {
        const params = new URLSearchParams();

        if (startDate) params.append('start_date', startDate.toString());
        if (endDate) params.append('end_date', endDate.toString());
        if (Number.isInteger(assigneeId) && (assigneeId as number) > 0) {
            params.append('assignee', String(assigneeId));
        }

        const queryString = params.toString();
        const url = `/team/${teamId}/time_entries${queryString ? '?' + queryString : ''}`;

        const response = await this.request<TimeEntryResponse>(url);
        return response.data || [];
    }
}

function normalizeRequestMethod(method: RequestInit['method']): string {
    return String(method || 'GET').toUpperCase();
}

function isSafeReadMethod(method: string): boolean {
    return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}
