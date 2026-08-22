import { isValidClickUpTaskId } from '../clickup-focus';
import { createMeetRoomKey } from '../meet/meet-room';
import type { MeetTaskMappingV1 } from '../meet/meet-priority';
import {
    CALENDAR_AGENDA_MAX_ITEMS,
    createCalendarEventKey,
    createCalendarSeriesKey,
    type CalendarAgendaCandidateV1,
    type CalendarAgendaItemV1,
    type CalendarLinkedTaskV1,
} from './calendar-agenda';
import { selectCalendarLinkedTask, type CalendarTaskMappingStoreV1 } from './calendar-linking';

export const CALENDAR_AGENDA_CACHE_TTL_MS = 60_000;

interface CachedCalendarAgendaEvent {
    candidate: CalendarAgendaCandidateV1;
    seriesKey?: string;
    expiresAt: number;
}

export class CalendarAgendaMemoryCache {
    private entries = new Map<string, CachedCalendarAgendaEvent>();

    async replace(
        candidates: readonly CalendarAgendaCandidateV1[],
        now = Date.now(),
        canCommit: () => boolean = () => true,
    ): Promise<CalendarAgendaItemV1[]> {
        const next = new Map<string, CachedCalendarAgendaEvent>();
        const items: CalendarAgendaItemV1[] = [];
        for (const candidate of candidates.slice(0, CALENDAR_AGENDA_MAX_ITEMS)) {
            const key = await createCalendarEventKey(candidate.eventId);
            if (!key) continue;
            const seriesKey = candidate.recurringEventId ? await createCalendarSeriesKey(candidate.recurringEventId) : null;
            const safeCandidate = cloneCandidate(candidate);
            next.set(key, { candidate: safeCandidate, ...(seriesKey ? { seriesKey } : {}), expiresAt: now + CALENDAR_AGENDA_CACHE_TTL_MS });
            items.push(toAgendaItem(key, safeCandidate, undefined, seriesKey || undefined));
        }
        if (!canCommit()) return [];
        this.entries = next;
        return items;
    }

    get(eventKey: string, now = Date.now()): CalendarAgendaCandidateV1 | null {
        const entry = this.entries.get(eventKey);
        if (!entry) return null;
        if (entry.expiresAt <= now) {
            this.entries.delete(eventKey);
            return null;
        }
        return cloneCandidate(entry.candidate);
    }

    list(
        now = Date.now(),
        resolveLinkedTask: (meetRoomCode: string) => CalendarLinkedTaskV1 | undefined = () => undefined,
        calendarMappings?: CalendarTaskMappingStoreV1,
    ): CalendarAgendaItemV1[] {
        const items: CalendarAgendaItemV1[] = [];
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) {
                this.entries.delete(key);
                continue;
            }
            const linkedTask = entry.candidate.meetRoomCode
                ? resolveLinkedTask(entry.candidate.meetRoomCode)
                : undefined;
            items.push(toAgendaItem(
                key,
                entry.candidate,
                linkedTask || (calendarMappings ? selectCalendarLinkedTask(calendarMappings, key, entry.seriesKey) : undefined),
                entry.seriesKey,
            ));
        }
        return items;
    }

    clear(): void {
        this.entries.clear();
    }
}

export async function createMeetMappingFromCalendarAgenda(
    cache: CalendarAgendaMemoryCache,
    input: { eventKey: string; taskId: string; teamId: string; now?: number },
): Promise<MeetTaskMappingV1 | null> {
    const now = input.now ?? Date.now();
    if (!/^[a-f0-9]{64}$/.test(input.eventKey)
        || !isValidClickUpTaskId(input.taskId)
        || !isBoundedTeamId(input.teamId)) return null;
    const candidate = cache.get(input.eventKey, now);
    if (!candidate?.meetRoomCode) return null;
    const roomKey = await createMeetRoomKey(candidate.meetRoomCode);
    if (!roomKey) return null;
    return {
        roomKey,
        taskId: input.taskId,
        teamId: input.teamId,
        createdAt: now,
        lastUsedAt: now,
        enabled: true,
    };
}

export function canonicalMeetUrlFromCalendarAgenda(
    cache: CalendarAgendaMemoryCache,
    eventKey: string,
    now = Date.now(),
): string | null {
    const candidate = cache.get(eventKey, now);
    return candidate?.meetRoomCode ? `https://meet.google.com/${candidate.meetRoomCode}` : null;
}

function toAgendaItem(
    key: string,
    candidate: CalendarAgendaCandidateV1,
    linkedTask?: CalendarLinkedTaskV1,
    seriesKey?: string,
): CalendarAgendaItemV1 {
    return {
        key,
        ...(seriesKey ? { seriesKey } : {}),
        title: candidate.title,
        start: candidate.start,
        end: candidate.end,
        allDay: candidate.allDay,
        status: candidate.status,
        ...(candidate.attendanceStatus ? { attendanceStatus: candidate.attendanceStatus } : {}),
        hasMeet: Boolean(candidate.meetRoomCode),
        ...(linkedTask ? { linkedTask: { ...linkedTask } } : {}),
    };
}

function cloneCandidate(candidate: CalendarAgendaCandidateV1): CalendarAgendaCandidateV1 {
    return {
        eventId: candidate.eventId,
        ...(candidate.recurringEventId ? { recurringEventId: candidate.recurringEventId } : {}),
        title: candidate.title,
        start: candidate.start,
        end: candidate.end,
        allDay: candidate.allDay,
        status: candidate.status,
        ...(candidate.attendanceStatus ? { attendanceStatus: candidate.attendanceStatus } : {}),
        ...(candidate.meetRoomCode ? { meetRoomCode: candidate.meetRoomCode } : {}),
    };
}

function isBoundedTeamId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 100 && !/\s/.test(value);
}
