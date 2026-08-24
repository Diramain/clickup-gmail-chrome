import type { ExtensionMessage } from './types/clickup';
import { isConfirmedThreadId } from './link-hardening';
import { isValidBulkTaskChange } from './bulk-task-update';
import { isValidGmailAttachmentUploadPayload } from './gmail-attachment-security';
import { normalizePersonalToken } from './clickup-auth';

export interface MessageValidationResult {
    ok: boolean;
    code?: string;
}

const GMAIL_ACTIONS = new Set([
    'openTaskModal', 'getStatus', 'getHierarchy', 'getHierarchyCache', 'getPreferredTeam', 'getTeams', 'getSpaces',
    'getFolders', 'getLists', 'getFolderlessLists', 'getMembers', 'getList', 'searchTasks', 'getTaskById',
    'preloadFullHierarchy', 'createTaskFull', 'attachToTask', 'uploadGmailAttachment', 'validateTaskLink', 'getEmailTaskMappings', 'getDefaultListConfig',
    'getGmailIntegrationPreference'
]);
const CLICKUP_ACTIONS = new Set(['startTimer', 'stopTimer', 'getRunningTimer', 'createTimeEntry', 'addTimeEntry', 'updateTimerBadge', 'focusedClickUpNavigation']);
const MEET_ACTIONS = new Set([
    'meetSessionEvent', 'getMeetDetectionEnabled', 'getMeetTaskPromptState',
    'suggestMeetTasks', 'assignMeetPromptTask', 'dismissMeetPrompt'
]);
const DIAGNOSTIC_ACTIONS = new Set(['getDiagnosticStatus', 'setDiagnosticEnabled', 'exportDiagnostics', 'clearDiagnostics']);
const EXTENSION_ACTIONS = new Set([
    'authenticate', 'authenticatePersonalToken', 'logout', 'checkAuth', 'getStatus', 'getLocalConnectionStatus', 'getTeams', 'getHierarchy', 'getUser', 'getSpaces', 'getFolders',
    'getLists', 'getFolderlessLists', 'getMembers', 'getList', 'createTaskSimple', 'saveOAuthConfig', 'savePreferredTeam',
    'getPreferredTeam', 'getTaskById', 'preloadFullHierarchy', 'getHierarchyCache', 'getEmailTasksSyncStatus', 'findLinkedTasks',
    'searchTasks', 'syncEmailTasks', 'clearLocalData', 'getTimeEntries',
    'getMeetPriorityStatus', 'getMeetMappings', 'assignMeetTask', 'ignoreMeetSession', 'endMeetSession', 'resumeMeetSession',
    'deleteMeetMapping', 'setMeetMappingEnabled', 'setMeetPriorityEnabled',
    'getDiagnosticStatus', 'setDiagnosticEnabled', 'exportDiagnostics', 'clearDiagnostics',
    'getMeetingLinkUiState', 'previewMeetingLink', 'beginMeetingLinkCreate', 'resumeMeetingOperation', 'repairMeetingOperation',
    // CGC-UX-V2-D2: sólo para la app en pestaña. Fuera de GMAIL_ACTIONS y
    // CLICKUP_ACTIONS a propósito: ningún content script debe escribir destino.
    'getDestinationOptions', 'setDefaultDestination', 'getDashboardSummary', 'refreshDashboardSummary', 'applyBulkTaskChange',
    'getGoogleCalendarAgenda', 'connectGoogleCalendar', 'refreshGoogleCalendarAgenda', 'disconnectGoogleCalendar',
    'linkGoogleCalendarEventTask', 'createGoogleCalendarEventTask', 'getCalendarTaskTypeConfig', 'getClickUpCustomTaskTypes',
    'setCalendarTaskTypeConfig', 'openGoogleCalendarMeet', 'getGmailIntegrationPreference', 'setGmailIntegrationPreference'
]);
const CREDENTIAL_ACTIONS = new Set(['authenticate', 'authenticatePersonalToken', 'saveOAuthConfig']);

const MAX_SUBJECT = 500;
const MAX_FROM = 320;
const MAX_HTML = 500_000;
const MAX_ATTACHMENTS = 20;

export function validateExtensionMessage(
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    runtimeId: string,
    extensionRoot: string = `chrome-extension://${runtimeId}/`,
): MessageValidationResult {
    if (sender.id !== runtimeId) return { ok: false, code: 'INVALID_SENDER' };
    if (!message || typeof message.action !== 'string') return { ok: false, code: 'INVALID_ACTION' };

    const origin = sender.url || sender.origin || '';
    if (!isAllowedOriginForAction(message.action, origin, extensionRoot)) return { ok: false, code: 'INVALID_ORIGIN' };
    if (!hasValidSchema(message)) return { ok: false, code: 'INVALID_SCHEMA' };

    return { ok: true };
}

export function isAllowedOriginForAction(action: string, origin: string, extensionRoot?: string): boolean {
    if (isTrustedExtensionOrigin(origin, extensionRoot)) {
        if (CREDENTIAL_ACTIONS.has(action)) return isTrustedSetupPage(origin, extensionRoot);
        return action !== 'uploadGmailAttachment'
            && (EXTENSION_ACTIONS.has(action) || GMAIL_ACTIONS.has(action) || CLICKUP_ACTIONS.has(action));
    }
    if (DIAGNOSTIC_ACTIONS.has(action)) return false;
    if (hasExactHttpsHost(origin, 'mail.google.com')) return GMAIL_ACTIONS.has(action);
    if (hasExactHttpsHost(origin, 'app.clickup.com')) return CLICKUP_ACTIONS.has(action);
    if (hasExactHttpsHost(origin, 'meet.google.com')) return MEET_ACTIONS.has(action);
    return false;
}

function isTrustedExtensionOrigin(value: string, extensionRoot?: string): boolean {
    try {
        const url = new URL(value);
        if (url.protocol !== 'chrome-extension:' && url.protocol !== 'moz-extension:') return false;
        if (!extensionRoot) return url.host.length > 0;
        const trusted = new URL(extensionRoot);
        return url.protocol === trusted.protocol && url.host === trusted.host;
    } catch {
        return false;
    }
}

function isTrustedSetupPage(value: string, extensionRoot?: string): boolean {
    try {
        const url = new URL(value);
        return isTrustedExtensionOrigin(value, extensionRoot)
            && (url.pathname === '/popup/popup.html' || url.pathname === '/app/app.html');
    } catch {
        return false;
    }
}

function hasExactHttpsHost(value: string, hostname: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === hostname && url.port === '';
    } catch {
        return false;
    }
}

export function hasValidSchema(message: ExtensionMessage): boolean {
    const data = message.data || message;
    switch (message.action) {
        case 'authenticatePersonalToken':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && hasOnlyDataKeys(data, ['token'])
                && normalizePersonalToken(data.token) !== null;
        case 'saveOAuthConfig':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && hasOnlyDataKeys(data, ['clientId', 'clientSecret'])
                && isShortString(data.clientId, 300)
                && isShortString(data.clientSecret, 1000);
        case 'savePreferredTeam':
            return isShortString(data.teamId, 100);
        case 'setDefaultDestination':
            return isShortString(data.listId, 100)
                && (data.listName === undefined || isShortString(data.listName, 500))
                && (data.path === undefined || isShortString(data.path, 1000));
        case 'getSpaces':
            return !data.teamId || isShortString(data.teamId, 100);
        case 'searchTasks':
            return isShortString(data.query || message.query, 200) && (!data.teamId || isShortString(data.teamId, 100));
        case 'getFolders':
        case 'getFolderlessLists':
            return !data.spaceId || isShortString(data.spaceId, 100);
        case 'getLists':
            return (!data.folderId || isShortString(data.folderId, 100)) && (!data.spaceId || isShortString(data.spaceId, 100));
        case 'getMembers':
        case 'getList':
            return !data.listId || isShortString(data.listId, 100);
        case 'validateTask':
        case 'getTaskById':
            return isShortString(data.taskId, 100);
        case 'validateTaskLink':
            return isShortString(data.taskId, 100) && isShortString(data.threadId, 200);
        case 'findLinkedTasks':
            return isConfirmedThreadId(data.threadId || message.threadId);
        case 'attachToTask':
            return isShortString(message.taskId || data.taskId, 100) && isValidEmailData(message.emailData || data.emailData, true);
        case 'uploadGmailAttachment':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && hasOnlyDataKeys(data, ['taskId', 'filename', 'mimeType', 'byteLength', 'base64'])
                && isValidGmailAttachmentUploadPayload(data);
        case 'setGmailIntegrationPreference':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && hasOnlyDataKeys(data, ['enabled'])
                && typeof data.enabled === 'boolean';
        case 'createTaskFull':
            return isValidCreateTaskFull(message);
        case 'createTaskSimple':
            return isShortString(data.listId, 100) && isShortString(data.name, 500) && (!data.description || isShortString(data.description, 5000));
        case 'syncEmailTasks':
            return Number.isInteger(data.days) && data.days > 0 && data.days <= 365 && data.emailData === undefined;
        case 'clearLocalData':
            return data === message || data === undefined || Object.keys(data).length === 0;
        case 'startTimer':
            return isShortString(data.teamId, 100) && isShortString(data.taskId, 100);
        case 'createTimeEntry':
            return isShortString(data.teamId, 100) && isValidTimeEntryTaskAndDuration(data);
        case 'addTimeEntry':
            return isShortString(data.teamId, 100) && isShortString(data.taskId, 100) && isValidDuration(data.duration);
        case 'stopTimer':
        case 'getRunningTimer':
            return isShortString(data.teamId, 100);
        case 'getTimeEntries':
            return isShortString(data.teamId, 100)
                && data.start_date === undefined
                && data.end_date === undefined
                && data.startDate === undefined
                && data.endDate === undefined
                && data.assignee === undefined;
        case 'focusedClickUpNavigation':
            return data === message || data === undefined || Object.keys(data).length === 0;
        case 'getMeetDetectionEnabled':
        case 'getMeetTaskPromptState':
        case 'getEmailTaskMappings':
            case 'getDefaultListConfig':
            case 'getGmailIntegrationPreference':
        case 'getDashboardSummary':
        case 'refreshDashboardSummary':
        case 'getGoogleCalendarAgenda':
        case 'connectGoogleCalendar':
        case 'refreshGoogleCalendarAgenda':
        case 'disconnectGoogleCalendar':
        case 'getCalendarTaskTypeConfig':
        case 'getClickUpCustomTaskTypes':
            return hasOnlyRootKeys(message, ['action']);
        case 'linkGoogleCalendarEventTask':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && isHexRoomKey(data.eventKey)
                && isShortString(data.taskId, 100)
                && isCalendarLinkScope(data.scope)
                && Object.keys(data).every((key) => ['eventKey', 'taskId', 'scope'].includes(key));
        case 'createGoogleCalendarEventTask':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && isHexRoomKey(data.eventKey)
                && isCalendarLinkScope(data.scope)
                && Number.isInteger(data.customItemId) && data.customItemId > 0
                && isShortString(data.listId, 100)
                && (data.parentTaskId === undefined || isShortString(data.parentTaskId, 100))
                && Object.keys(data).every((key) => ['eventKey', 'scope', 'customItemId', 'listId', 'parentTaskId'].includes(key));
        case 'setCalendarTaskTypeConfig':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && Number.isInteger(data.customItemId) && data.customItemId > 0
                && Object.keys(data).every((key) => key === 'customItemId');
        case 'openGoogleCalendarMeet':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && isHexRoomKey(data.eventKey)
                && Object.keys(data).every((key) => key === 'eventKey');
        case 'suggestMeetTasks':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && isHexRoomKey(data.roomKey)
                && isShortString(data.query, 100)
                && Object.keys(data).every((key) => ['roomKey', 'query'].includes(key));
        case 'assignMeetPromptTask':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && isHexRoomKey(data.roomKey)
                && isShortString(data.taskId, 100)
                && typeof data.remember === 'boolean'
                && Object.keys(data).every((key) => ['roomKey', 'taskId', 'remember'].includes(key));
        case 'dismissMeetPrompt':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && isHexRoomKey(data.roomKey)
                && Object.keys(data).every((key) => key === 'roomKey');
        case 'applyBulkTaskChange':
            return hasOnlyRootKeys(message, ['action', 'data']) && isValidBulkTaskChange(data);
        case 'meetSessionEvent':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && ['candidate', 'joined', 'left', 'heartbeat'].includes(data.event)
                && isHexRoomKey(data.roomKey)
                && Object.keys(data).every((key) => ['event', 'roomKey'].includes(key));
        case 'getMeetPriorityStatus':
        case 'getMeetMappings':
        case 'endMeetSession':
        case 'resumeMeetSession':
        case 'ignoreMeetSession':
            return hasOnlyRootKeys(message, ['action']);
        case 'assignMeetTask':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && isShortString(data.taskId, 100)
                && isShortString(data.teamId, 100)
                && typeof data.remember === 'boolean'
                && Object.keys(data).every((key) => ['taskId', 'teamId', 'remember'].includes(key));
        case 'setMeetPriorityEnabled':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && typeof data.enabled === 'boolean'
                && Object.keys(data).every((key) => key === 'enabled');
        case 'setDiagnosticEnabled':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && typeof data.enabled === 'boolean'
                && Object.keys(data).every((key) => key === 'enabled');
        case 'getDiagnosticStatus':
        case 'exportDiagnostics':
        case 'clearDiagnostics':
            return hasOnlyRootKeys(message, ['action']);
        case 'getMeetingLinkUiState':
            return hasOnlyRootKeys(message, ['action']);
        case 'previewMeetingLink':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && hasOnlyDataKeys(data, ['clientRequestId', 'payloadHash'])
                && isUuidV4(data.clientRequestId)
                && isPayloadHash(data.payloadHash);
        case 'beginMeetingLinkCreate':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && hasOnlyDataKeys(data, ['clientRequestId', 'cgcLinkId', 'payloadHash', 'calendarId', 'workspaceId', 'listId', 'customItemId'])
                && isUuidV4(data.clientRequestId)
                && isUuidV4(data.cgcLinkId)
                && isPayloadHash(data.payloadHash)
                && isBoundedOpaqueId(data.calendarId, 256)
                && isBoundedOpaqueId(data.workspaceId, 100)
                && isBoundedOpaqueId(data.listId, 100)
                && Number.isInteger(data.customItemId) && data.customItemId > 0;
        case 'resumeMeetingOperation':
        case 'repairMeetingOperation':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && hasOnlyDataKeys(data, ['cgcLinkId'])
                && isUuidV4(data.cgcLinkId);
        case 'deleteMeetMapping':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && isHexRoomKey(data.roomKey)
                && Object.keys(data).every((key) => key === 'roomKey');
        case 'setMeetMappingEnabled':
            return hasOnlyRootKeys(message, ['action', 'data'])
                && isHexRoomKey(data.roomKey)
                && typeof data.enabled === 'boolean'
                && Object.keys(data).every((key) => ['roomKey', 'enabled'].includes(key));
        default:
            return true;
    }
}

function isHexRoomKey(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isCalendarLinkScope(value: unknown): value is 'occurrence' | 'series' {
    return value === 'occurrence' || value === 'series';
}

function hasOnlyRootKeys(message: ExtensionMessage, allowed: string[]): boolean {
    return Object.keys(message).every((key) => allowed.includes(key));
}

function hasOnlyDataKeys(data: any, allowed: string[]): boolean {
    return !!data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).every((key) => allowed.includes(key));
}

function isUuidV4(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPayloadHash(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isBoundedOpaqueId(value: unknown, max: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\s/?#]/.test(value);
}

function isValidTimeEntryTaskAndDuration(data: any): boolean {
    const taskId = data.taskId || data.entry?.tid;
    const duration = data.duration ?? data.entry?.duration;
    const start = data.start ?? data.entry?.start;
    return isShortString(taskId, 100)
        && isValidDuration(duration)
        && (start === undefined || isValidDateLike(start));
}

function isValidCreateTaskFull(message: ExtensionMessage): boolean {
    const data = message as any;
    const taskData = data.taskData;
    if (!isShortString(data.listId, 100)) return false;
    if (!taskData || typeof taskData !== 'object') return false;
    if (!isShortString(taskData.name, 500)) return false;
    if (taskData.markdown_description && !isShortString(taskData.markdown_description, 50_000)) return false;
    if (taskData.description && !isShortString(taskData.description, 50_000)) return false;
    if (taskData.assignees && (!Array.isArray(taskData.assignees) || taskData.assignees.length > 50 || !taskData.assignees.every((id: unknown) => Number.isInteger(id) && Number(id) >= 0))) return false;
    if (taskData.priority !== undefined && ![1, 2, 3, 4, null].includes(taskData.priority)) return false;
    if (taskData.status !== undefined && !isShortString(taskData.status, 100)) return false;
    if (taskData.due_date !== undefined && !isValidDateLike(taskData.due_date)) return false;
    if (taskData.start_date !== undefined && !isValidDateLike(taskData.start_date)) return false;
    if (taskData.time_estimate !== undefined && !isValidDuration(taskData.time_estimate)) return false;
    if (data.timeTracked !== undefined && !isValidDuration(data.timeTracked)) return false;
    if (data.teamId !== undefined && !isShortString(data.teamId, 100)) return false;
    if (data.emailData && !isValidEmailData(data.emailData, true)) return false;
    return true;
}

function isValidEmailData(emailData: any, requireSanitized = false): boolean {
    if (!emailData || typeof emailData !== 'object') return false;
    if (!isShortString(emailData.threadId, 200)) return false;
    if (!isShortString(emailData.subject || '', MAX_SUBJECT)) return false;
    if (!isShortString(emailData.from || '', MAX_FROM)) return false;
    if (requireSanitized && emailData.html && emailData.htmlSanitized !== true) return false;
    if (typeof emailData.html === 'string' && emailData.html.length > MAX_HTML) return false;
    if (emailData.attachments && (!Array.isArray(emailData.attachments) || emailData.attachments.length > MAX_ATTACHMENTS || !emailData.attachments.every(isValidAttachment))) return false;
    return true;
}

function isValidAttachment(att: any): boolean {
    if (!att || typeof att !== 'object') return false;
    if (!isShortString(att.filename, 255)) return false;
    if (!isShortString(att.mimeType, 200)) return false;
    if (att.url && !isShortString(att.url, 2000)) return false;
    if (att.size !== undefined && (!Number.isInteger(att.size) || att.size < 0 || att.size > 50_000_000)) return false;
    return true;
}

function isValidDateLike(value: unknown): boolean {
    return typeof value === 'number' ? Number.isFinite(value) && value >= 0 : isShortString(value, 50);
}

function isValidDuration(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000 * 60 * 60 * 24 * 365;
}

function isShortString(value: unknown, max: number): boolean {
    return typeof value === 'string' && value.length > 0 && value.length <= max;
}
