import {
    CALENDAR_AGENDA_MAX_ITEMS,
    CALENDAR_AGENDA_WINDOW_DAYS,
    sanitizeGoogleCalendarEvents,
    type CalendarAgendaCandidateV1,
} from './calendar-agenda';

export const GOOGLE_CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';
export const GOOGLE_CALENDAR_API_ORIGIN = 'https://www.googleapis.com';
const MAX_RESPONSE_BYTES = 1_000_000;

export type GoogleCalendarReadFailureCode =
    | 'AUTH_REQUIRED'
    | 'PERMISSION_DENIED'
    | 'RATE_LIMITED'
    | 'REMOTE_UNAVAILABLE'
    | 'INVALID_RESPONSE';

export type GoogleCalendarReadResult =
    | { ok: true; events: CalendarAgendaCandidateV1[] }
    | { ok: false; code: GoogleCalendarReadFailureCode };

export interface GoogleCalendarFetchPort {
    fetch(input: string, init: RequestInit): Promise<Response>;
}

const browserFetchPort: GoogleCalendarFetchPort = {
    fetch: (input, init) => fetch(input, init),
};

export function createPrimaryAgendaUrl(now: Date): string {
    const timeMin = new Date(now.getTime());
    const timeMax = new Date(now.getTime() + CALENDAR_AGENDA_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const url = new URL('/calendar/v3/calendars/primary/events', GOOGLE_CALENDAR_API_ORIGIN);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('showDeleted', 'false');
    url.searchParams.set('timeMin', timeMin.toISOString());
    url.searchParams.set('timeMax', timeMax.toISOString());
    url.searchParams.set('maxResults', String(CALENDAR_AGENDA_MAX_ITEMS));
    url.searchParams.set('fields', 'items(id,summary,status,start(date,dateTime),end(date,dateTime),recurringEventId,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),attendees(self,responseStatus))');
    return url.toString();
}

export async function readPrimaryCalendarAgenda(
    token: string,
    now = new Date(),
    port: GoogleCalendarFetchPort = browserFetchPort,
): Promise<GoogleCalendarReadResult> {
    if (typeof token !== 'string' || token.trim().length === 0 || token.length > 4096) {
        return { ok: false, code: 'AUTH_REQUIRED' };
    }

    try {
        const response = await port.fetch(createPrimaryAgendaUrl(now), {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
        });
        if (response.status === 401) return { ok: false, code: 'AUTH_REQUIRED' };
        if (response.status === 403) return { ok: false, code: 'PERMISSION_DENIED' };
        if (response.status === 429) return { ok: false, code: 'RATE_LIMITED' };
        if (response.status >= 500) return { ok: false, code: 'REMOTE_UNAVAILABLE' };
        if (!response.ok) return { ok: false, code: 'INVALID_RESPONSE' };

        const contentLength = Number(response.headers.get('content-length') || '0');
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
            return { ok: false, code: 'INVALID_RESPONSE' };
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('application/json')) {
            return { ok: false, code: 'INVALID_RESPONSE' };
        }
        const body = await response.text();
        if (body.length > MAX_RESPONSE_BYTES) return { ok: false, code: 'INVALID_RESPONSE' };
        let parsed: unknown;
        try { parsed = JSON.parse(body) as unknown; }
        catch { return { ok: false, code: 'INVALID_RESPONSE' }; }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray((parsed as { items?: unknown }).items)) {
            return { ok: false, code: 'INVALID_RESPONSE' };
        }
        return { ok: true, events: sanitizeGoogleCalendarEvents(parsed) };
    } catch {
        return { ok: false, code: 'REMOTE_UNAVAILABLE' };
    }
}
