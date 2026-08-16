export interface CalendarEventDraft {
    calendarId: string;
    eventId: string;
    conferenceRequestId: string;
    cgcLinkId: string;
    payloadHash: string;
    startTime: string;
    endTime: string;
}

export interface CalendarEventRecord {
    calendarId: string;
    eventId: string;
    etag?: string;
    conferenceStatus?: 'pending' | 'success' | 'failure';
    cgcLinkId?: string;
    payloadHash?: string;
    clickupTaskId?: string;
    attendeesPublished?: boolean;
}

export interface CalendarPort {
    insertPrivateEvent(draft: CalendarEventDraft): Promise<CalendarEventRecord>;
    getEvent(calendarId: string, eventId: string): Promise<CalendarEventRecord | null>;
    patchTaskAndInvite(input: { calendarId: string; eventId: string; etag: string; taskId: string; attendees: readonly { email: string }[]; sendUpdates: 'all' }): Promise<CalendarEventRecord>;
}

export interface MeetSettingsPort {
    applyAutoArtifacts(spaceName: string): Promise<{ ok: true } | { ok: false; reason: 'unsupported' | 'license_denied' | 'permission_denied' }>;
}

export interface ClickUpMeetingPort {
    findTasksByExactLink(workspaceId: string, fieldId: string, cgcLinkId: string): Promise<{ count: number; taskId?: string }>;
    createMeetingTask(input: { listId: string; customItemId: number; linkFieldId?: string; cgcLinkId: string; dueDate: number; estimateMs: number; parentTaskId?: string }): Promise<{ taskId: string }>;
    getTask(taskId: string): Promise<{ taskId: string; listId: string; parentTaskId?: string; customItemId?: number; linkValue?: string }>;
}
