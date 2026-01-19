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
    ClickUpTask,
    ClickUpTasksResponse,
    CreateTaskPayload,
    EmailData,
    TimeEntry,
    ClickUpCustomFieldsResponse
} from '../types/clickup';

// ============================================================================
// Constants
// ============================================================================

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

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

// ============================================================================
// ClickUp API Wrapper Class
// ============================================================================

export class ClickUpAPIWrapper {
    private token: string;
    private onTokenRefresh: TokenRefreshCallback | null = null;

    private static readonly MAX_RETRIES = 3;
    private static readonly RETRY_STATUS_CODES = [429, 500, 502, 503, 504];

    constructor(token: string) {
        this.token = token;
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
            const response = await fetch(`${CLICKUP_API_BASE}${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': this.token,
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            // Handle 401 Unauthorized - try to refresh token once
            if (response.status === 401 && retryCount === 0 && this.onTokenRefresh) {
                console.log('[API] Got 401 Unauthorized, attempting token refresh...');
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
            if (ClickUpAPIWrapper.RETRY_STATUS_CODES.includes(response.status) && retryCount < ClickUpAPIWrapper.MAX_RETRIES) {
                const delay = Math.pow(2, retryCount) * 1000;
                console.log(`[API] Got ${response.status}, retrying in ${delay}ms (attempt ${retryCount + 1}/${ClickUpAPIWrapper.MAX_RETRIES})`);
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
                console.log(`[API] Network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${ClickUpAPIWrapper.MAX_RETRIES})`);
                await this.sleep(delay);
                return this.request(endpoint, options, retryCount + 1);
            }
            throw error;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    async searchTasks(teamId: string, query: string): Promise<ClickUpTasksResponse> {
        return this.request(`/team/${teamId}/task?query=${encodeURIComponent(query)}`);
    }

    async getTasks(listId: string): Promise<ClickUpTasksResponse> {
        return this.request(`/list/${listId}/task`);
    }

    async getRecentTasks(teamId: string, dateFrom: number): Promise<ClickUpTask[]> {
        const result = await this.request(
            `/team/${teamId}/task?include_closed=true&date_updated_gt=${dateFrom}&page=0`
        );
        return result.tasks || [];
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

    async uploadFileFromUrl(
        taskId: string,
        fileUrl: string,
        filename: string,
        mimeType: string
    ): Promise<any> {
        console.log('[API] Downloading file:', filename);

        const fileResponse = await fetch(fileUrl, {
            credentials: 'include'
        });

        if (!fileResponse.ok) {
            throw new Error(`Failed to download file: ${fileResponse.status}`);
        }

        const fileBlob = await fileResponse.blob();

        const formData = new FormData();
        formData.append('attachment', fileBlob, filename);

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
            body: JSON.stringify({ tid: taskId })
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
                duration: duration
            })
        });
    }

    async getTimeEntries(
        teamId: string,
        startDate?: number,
        endDate?: number
    ): Promise<TimeEntry[]> {
        const params = new URLSearchParams();

        if (startDate) params.append('start_date', startDate.toString());
        if (endDate) params.append('end_date', endDate.toString());

        const queryString = params.toString();
        const url = `/team/${teamId}/time_entries${queryString ? '?' + queryString : ''}`;

        const response = await this.request<TimeEntryResponse>(url);
        return response.data || [];
    }
}
