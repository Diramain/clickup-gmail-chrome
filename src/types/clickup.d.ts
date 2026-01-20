/**
 * ClickUp API Type Definitions
 * Based on ClickUp API v2
 */

// ============================================================================
// User & Team Types
// ============================================================================

export interface ClickUpUser {
    id: number;
    username: string;
    email: string;
    color: string;
    profilePicture: string | null;
    initials: string;
    role?: number;
}

export interface ClickUpUserResponse {
    user: ClickUpUser;
}

export interface ClickUpTeam {
    id: string;
    name: string;
    color: string;
    avatar: string | null;
    members: ClickUpMember[];
}

export interface ClickUpMember {
    user: ClickUpUser;
}

export interface ClickUpTeamsResponse {
    teams: ClickUpTeam[];
}

// ============================================================================
// Workspace Hierarchy Types
// ============================================================================

export interface ClickUpSpace {
    id: string;
    name: string;
    private: boolean;
    statuses: ClickUpStatus[];
    multiple_assignees: boolean;
    features: Record<string, { enabled: boolean }>;
}

export interface ClickUpSpacesResponse {
    spaces: ClickUpSpace[];
}

export interface ClickUpFolder {
    id: string;
    name: string;
    orderindex: number;
    hidden: boolean;
    space: { id: string; name: string };
    task_count: string;
    lists: ClickUpList[];
}

export interface ClickUpFoldersResponse {
    folders: ClickUpFolder[];
}

export interface ClickUpList {
    id: string;
    name: string;
    orderindex: number;
    status: { status: string; color: string } | null;
    priority: { priority: string; color: string } | null;
    assignee: ClickUpUser | null;
    task_count: number | null;
    due_date: string | null;
    start_date: string | null;
    folder: { id: string; name: string; hidden: boolean; access: boolean };
    space: { id: string; name: string; access: boolean };
    archived: boolean;
    override_statuses: boolean;
    permission_level: string;
    statuses?: ClickUpStatus[];
}

export interface ClickUpListsResponse {
    lists: ClickUpList[];
}

// ============================================================================
// Task Types
// ============================================================================

export interface ClickUpStatus {
    id?: string;
    status: string;
    color: string;
    type: string;
    orderindex: number;
}

export interface ClickUpPriority {
    id: string;
    priority: string;
    color: string;
    orderindex: string;
}

export interface ClickUpTask {
    id: string;
    custom_id: string | null;
    name: string;
    text_content: string | null;
    description: string | null;
    status: ClickUpStatus;
    orderindex: string;
    date_created: string;
    date_updated: string;
    date_closed: string | null;
    archived: boolean;
    creator: ClickUpUser;
    assignees: ClickUpUser[];
    watchers: ClickUpUser[];
    checklists: any[];
    tags: { name: string; tag_fg: string; tag_bg: string }[];
    parent: string | null;
    priority: ClickUpPriority | null;
    due_date: string | null;
    start_date: string | null;
    points: number | null;
    time_estimate: number | null;
    time_spent: number | null;
    custom_fields: any[];
    dependencies: any[];
    linked_tasks: any[];
    team_id: string;
    url: string;
    permission_level: string;
    list: { id: string; name: string; access: boolean };
    project: { id: string; name: string; hidden: boolean; access: boolean };
    folder: { id: string; name: string; hidden: boolean; access: boolean };
    space: { id: string };
}

export interface ClickUpTasksResponse {
    tasks: ClickUpTask[];
}

export interface ClickUpCustomField {
    id: string;
    name: string;
    type: string;
    type_config: any;
    date_created: string;
    hide_from_guests: boolean;
    required: boolean;
}

export interface ClickUpCustomFieldsResponse {
    fields: ClickUpCustomField[];
}

// ============================================================================
// Create Task Types
// ============================================================================

export interface CreateTaskPayload {
    name: string;
    description?: string;
    markdown_description?: string;
    assignees?: number[];
    tags?: string[];
    status?: string;
    priority?: number | null;
    due_date?: number | null;
    due_date_time?: boolean;
    time_estimate?: number | null;
    start_date?: number | null;
    start_date_time?: boolean;
    notify_all?: boolean;
    parent?: string | null;
    links_to?: string | null;
    custom_fields?: { id: string; value: any }[];
}

// ============================================================================
// Comment & Attachment Types
// ============================================================================

export interface ClickUpComment {
    id: string;
    comment: { text: string }[];
    comment_text: string;
    user: ClickUpUser;
    date: string;
}

export interface ClickUpAttachment {
    id: string;
    date: string;
    title: string;
    type: number;
    source: number;
    version: number;
    extension: string;
    thumbnail_small: string | null;
    thumbnail_medium: string | null;
    thumbnail_large: string | null;
    is_folder: boolean | null;
    mimetype: string;
    hidden: boolean;
    parent_id: string;
    size: number;
    total_comments: number;
    resolved_comments: number;
    user: ClickUpUser;
    deleted: boolean;
    orientation: string | null;
    url: string;
    parent_comment_type: string | null;
    parent_comment_parent: string | null;
    email_data: {
        id: string;
        subject: string;
        from: string;
        email: string;
        msg: string;
        client: string;
    } | null;
    url_w_query: string;
    url_w_host: string;
}

// ============================================================================
// Extension-specific Types
// ============================================================================

export interface EmailData {
    threadId: string;
    subject: string;
    from: string;
    html: string;
    email?: string;
    userEmail?: string;
    attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
    url: string;
    filename: string;
    mimeType: string;
    size?: number;
}

export interface EmailTaskMapping {
    id: string;
    name: string;
    url: string;
    status?: string;
    createdAt?: number;
}

export interface StorageData {
    clickupToken?: string;
    clickupRefreshToken?: string | null;
    oauthConfig?: {
        clientId: string;
        clientSecret: string;
        redirectUrl: string;
    };
    preferredTeamId?: string; // Replaces defaultList
    emailTaskMappings?: Record<string, EmailTaskMapping[]>;
    cachedTeams?: ClickUpTeamsResponse;
    cachedUser?: ClickUpUserResponse;
}

// ============================================================================
// Message Types (for chrome.runtime.sendMessage)
// ============================================================================

export type MessageAction =
    | 'authenticate'
    | 'logout'
    | 'checkAuth'
    | 'getStatus'
    | 'getTeams'
    | 'getHierarchy'
    | 'getUser'
    | 'getSpaces'
    | 'getFolders'
    | 'getLists'
    | 'getFolderlessLists'
    | 'getMembers'
    | 'getList'
    | 'createTask'
    | 'createTaskFull'
    | 'createTaskFromEmail'
    | 'createTaskSimple'
    | 'attachToTask'
    | 'validateTask'
    | 'validateTaskLink'
    | 'findLinkedTasks'
    | 'searchTasks'
    | 'testTokenRefresh'
    | 'saveOAuthConfig'
    | 'savePreferredTeam'
    | 'getPreferredTeam'
    | 'getTaskById'
    | 'preloadFullHierarchy'
    | 'getHierarchyCache'
    | 'syncEmailTasks'
    | 'getEmailTasksSyncStatus'
    // Time Tracking Actions
    | 'startTimer'
    | 'stopTimer'
    | 'getRunningTimer'
    | 'createTimeEntry'
    | 'addTimeEntry'
    | 'getTimeEntries'
    | 'updateTimerBadge';

export interface ExtensionMessage {
    action: MessageAction;
    data?: any;
    [key: string]: any;
}

// ============================================================================
// Shared Types (used by popup.ts, background.ts, modal.ts)
// ============================================================================

/** Time tracking entry from ClickUp API */
export interface TimeEntry {
    id: string;
    task?: { id: string; name: string } | null;
    wid?: string;
    user?: { id: number; username: string } | ClickUpUser;
    start: number | string;
    end?: number | string;
    duration: number | string;
    description?: string;
    running?: boolean;
}

/** Cached list item for quick search */
export interface CachedListItem {
    id: string;
    name: string;
    path: string;
    spaceName?: string;
    folderName?: string;
    spaceColor?: string;
    spaceAvatar?: string | null;
}

/** Extension status returned by getStatus */
export interface ExtensionStatus {
    authenticated: boolean;
    configured: boolean;
    user?: ClickUpUserResponse | ClickUpUser;
}

/** Test result for token refresh test */
export interface TestResult {
    success: boolean;
    message?: string;
    error?: string;
}

/** Task mapping for email-to-task linking */
export interface TaskMapping {
    id: string;
    name: string;
    url: string;
}

