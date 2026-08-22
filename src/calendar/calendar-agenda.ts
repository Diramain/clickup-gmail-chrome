import { resolveMeetPageContext } from '../meet/meet-room';

export const CALENDAR_AGENDA_MAX_ITEMS = 20;
export const CALENDAR_AGENDA_TITLE_MAX_LENGTH = 160;
export const CALENDAR_AGENDA_WINDOW_DAYS = 7;

export type CalendarAgendaState =
    | 'disabled'
    | 'disconnected'
    | 'loading'
    | 'ready'
    | 'empty'
    | 'error'
    | 'reconnect-required';

export interface CalendarLinkedTaskV1 {
    id: string;
    name: string;
}

export interface CalendarAgendaItemV1 {
    key: string;
    seriesKey?: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    status: 'confirmed' | 'tentative';
    attendanceStatus?: CalendarAttendanceStatus;
    hasMeet: boolean;
    linkedTask?: CalendarLinkedTaskV1;
}

export interface CalendarAgendaViewV1 {
    state: CalendarAgendaState;
    capabilityEnabled: boolean;
    items: CalendarAgendaItemV1[];
    errorCode?: 'AUTH_REQUIRED' | 'PERMISSION_DENIED' | 'RATE_LIMITED' | 'REMOTE_UNAVAILABLE' | 'INVALID_RESPONSE';
}

export interface CalendarAgendaCandidateV1 {
    eventId: string;
    recurringEventId?: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    status: 'confirmed' | 'tentative';
    attendanceStatus?: CalendarAttendanceStatus;
    meetRoomCode?: string;
}

export type CalendarAttendanceStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction';

interface GoogleCalendarEventLike {
    id?: unknown;
    summary?: unknown;
    status?: unknown;
    start?: { dateTime?: unknown; date?: unknown };
    end?: { dateTime?: unknown; date?: unknown };
    recurringEventId?: unknown;
    attendees?: unknown;
    hangoutLink?: unknown;
    conferenceData?: { entryPoints?: unknown };
}

export function disabledCalendarAgendaView(): CalendarAgendaViewV1 {
    return { state: 'disabled', capabilityEnabled: false, items: [] };
}

export function sanitizeGoogleCalendarEvents(response: unknown): CalendarAgendaCandidateV1[] {
    if (!isRecord(response) || !Array.isArray(response.items)) return [];
    const candidates: CalendarAgendaCandidateV1[] = [];

    for (const raw of response.items) {
        if (candidates.length >= CALENDAR_AGENDA_MAX_ITEMS) break;
        const candidate = sanitizeGoogleCalendarEvent(raw);
        if (candidate) candidates.push(candidate);
    }

    return candidates;
}

export function normalizeCalendarAgendaView(value: unknown): CalendarAgendaViewV1 {
    if (!isRecord(value)) return disabledCalendarAgendaView();
    const state = isCalendarAgendaState(value.state) ? value.state : 'disabled';
    const capabilityEnabled = value.capabilityEnabled === true;
    const items = Array.isArray(value.items)
        ? value.items.slice(0, CALENDAR_AGENDA_MAX_ITEMS).flatMap((item) => {
            const normalized = sanitizeCalendarAgendaItem(item);
            return normalized ? [normalized] : [];
        })
        : [];
    const errorCode = isCalendarErrorCode(value.errorCode) ? value.errorCode : undefined;

    if (!capabilityEnabled) return disabledCalendarAgendaView();
    return { state, capabilityEnabled, items, ...(errorCode ? { errorCode } : {}) };
}

export async function createCalendarEventKey(eventId: string): Promise<string | null> {
    if (!isValidEventId(eventId) || !globalThis.crypto?.subtle) return null;
    const bytes = new TextEncoder().encode(`cgc-calendar-v1:primary:${eventId}`);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function createCalendarSeriesKey(recurringEventId: string): Promise<string | null> {
    if (!isValidEventId(recurringEventId) || !globalThis.crypto?.subtle) return null;
    const bytes = new TextEncoder().encode(`cgc-calendar-series-v1:primary:${recurringEventId}`);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function sanitizeGoogleCalendarEvent(value: unknown): CalendarAgendaCandidateV1 | null {
    if (!isRecord(value)) return null;
    const event = value as GoogleCalendarEventLike;
    if (!isValidEventId(event.id)) return null;
    if (event.status !== 'confirmed' && event.status !== 'tentative') return null;
    const start = sanitizeCalendarDate(event.start);
    const end = sanitizeCalendarDate(event.end);
    if (!start || !end || !isOrderedDateRange(start, end)) return null;
    const allDay = isAllDayDate(event.start) && isAllDayDate(event.end);

    const title = sanitizeTitle(event.summary);
    const meetRoomCode = extractMeetRoomCode(event);
    const attendanceStatus = extractOwnAttendanceStatus(event.attendees);
    return {
        eventId: event.id,
        ...(isValidEventId(event.recurringEventId) ? { recurringEventId: event.recurringEventId } : {}),
        title: title || 'Evento sin título',
        start,
        end,
        allDay,
        status: event.status,
        ...(attendanceStatus ? { attendanceStatus } : {}),
        ...(meetRoomCode ? { meetRoomCode } : {}),
    };
}

function sanitizeCalendarAgendaItem(value: unknown): CalendarAgendaItemV1 | null {
    if (!isRecord(value) || !isHexKey(value.key)) return null;
    const title = sanitizeTitle(value.title);
    const start = sanitizeCalendarScalar(value.start);
    const end = sanitizeCalendarScalar(value.end);
    if (!title || !start || !end || !isOrderedDateRange(start, end)) return null;
    if (value.status !== 'confirmed' && value.status !== 'tentative') return null;
    if (typeof value.hasMeet !== 'boolean') return null;
    if (typeof value.allDay !== 'boolean') return null;

    const linkedTask = sanitizeLinkedTask(value.linkedTask);
    return {
        key: value.key,
        ...(isHexKey(value.seriesKey) ? { seriesKey: value.seriesKey } : {}),
        title,
        start,
        end,
        allDay: value.allDay,
        status: value.status,
        ...(isAttendanceStatus(value.attendanceStatus) ? { attendanceStatus: value.attendanceStatus } : {}),
        hasMeet: value.hasMeet,
        ...(linkedTask ? { linkedTask } : {}),
    };
}

function extractOwnAttendanceStatus(value: unknown): CalendarAttendanceStatus | null {
    if (!Array.isArray(value)) return null;
    for (const attendee of value.slice(0, 100)) {
        if (!isRecord(attendee) || attendee.self !== true) continue;
        return isAttendanceStatus(attendee.responseStatus) ? attendee.responseStatus : null;
    }
    return null;
}

function isAttendanceStatus(value: unknown): value is CalendarAttendanceStatus {
    return value === 'accepted' || value === 'declined' || value === 'tentative' || value === 'needsAction';
}

function extractMeetRoomCode(event: GoogleCalendarEventLike): string | null {
    const urls: unknown[] = [event.hangoutLink];
    const entryPoints = event.conferenceData?.entryPoints;
    if (Array.isArray(entryPoints)) {
        for (const entry of entryPoints.slice(0, 10)) {
            if (isRecord(entry) && entry.entryPointType === 'video') urls.push(entry.uri);
        }
    }

    for (const value of urls) {
        if (typeof value !== 'string' || value.length > 500) continue;
        const context = resolveMeetPageContext(value);
        if (context.kind === 'candidate') return context.roomCode;
    }
    return null;
}

function sanitizeLinkedTask(value: unknown): CalendarLinkedTaskV1 | null {
    if (!isRecord(value)) return null;
    const id = boundedText(value.id, 100);
    const name = boundedText(value.name, 500);
    return id && name ? { id, name } : null;
}

function sanitizeCalendarDate(value: unknown): string | null {
    if (!isRecord(value)) return null;
    return sanitizeCalendarScalar(value.dateTime) || sanitizeCalendarScalar(value.date);
}

function isAllDayDate(value: unknown): boolean {
    return isRecord(value) && typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date);
}

function sanitizeCalendarScalar(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 64) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    return Number.isFinite(Date.parse(value)) ? value : null;
}

function isOrderedDateRange(start: string, end: string): boolean {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

function sanitizeTitle(value: unknown): string {
    return boundedText(value, CALENDAR_AGENDA_TITLE_MAX_LENGTH)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function boundedText(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isValidEventId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 1024 && /^[a-z0-9_]+$/i.test(value);
}

function isHexKey(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isCalendarAgendaState(value: unknown): value is CalendarAgendaState {
    return ['disabled', 'disconnected', 'loading', 'ready', 'empty', 'error', 'reconnect-required'].includes(String(value));
}

function isCalendarErrorCode(value: unknown): value is NonNullable<CalendarAgendaViewV1['errorCode']> {
    return ['AUTH_REQUIRED', 'PERMISSION_DENIED', 'RATE_LIMITED', 'REMOTE_UNAVAILABLE', 'INVALID_RESPONSE'].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
