import {
    type GoogleCalendarTokenResult,
    type GoogleTokenInvalidationResult,
} from '../google/google-identity.service';
import { CalendarAgendaMemoryCache } from './calendar-agenda-cache';
import type { CalendarAgendaViewV1 } from './calendar-agenda';
import type { GoogleCalendarReadResult } from './google-calendar.service';

export interface GoogleCalendarRuntimePort {
    requestToken(interactive: boolean): Promise<GoogleCalendarTokenResult>;
    invalidateToken(token: string): Promise<GoogleTokenInvalidationResult>;
    readAgenda(token: string): Promise<GoogleCalendarReadResult>;
}

export class GoogleCalendarAgendaRuntime {
    private token: string | null = null;
    private state: CalendarAgendaViewV1['state'] = 'disconnected';
    private generation = 0;

    constructor(
        private readonly port: GoogleCalendarRuntimePort,
        private readonly cache = new CalendarAgendaMemoryCache(),
    ) {}

    getAgenda(): Promise<CalendarAgendaViewV1> {
        return this.load(false);
    }

    connect(): Promise<CalendarAgendaViewV1> {
        return this.load(true);
    }

    refresh(): Promise<CalendarAgendaViewV1> {
        return this.load(false);
    }

    currentView(): CalendarAgendaViewV1 {
        return {
            state: this.state,
            capabilityEnabled: true,
            items: this.cache.list(),
        };
    }

    async disconnect(): Promise<CalendarAgendaViewV1> {
        const generation = ++this.generation;
        let token = this.token;
        this.token = null;
        this.cache.clear();
        this.state = 'disconnected';
        if (!token) {
            const result = await this.port.requestToken(false);
            if (generation !== this.generation) return this.currentView();
            if (result.ok) token = result.token;
        }

        if (token) {
            const invalidated = await this.port.invalidateToken(token);
            if (generation !== this.generation) return this.currentView();
            if (!invalidated.ok) {
                this.state = 'error';
                return this.currentView();
            }
        }

        this.state = 'disconnected';
        return this.currentView();
    }

    private async load(interactive: boolean): Promise<CalendarAgendaViewV1> {
        const generation = ++this.generation;
        this.state = 'loading';
        const tokenResult = await this.port.requestToken(interactive);
        if (generation !== this.generation) return this.currentView();
        if (!tokenResult.ok) {
            this.token = null;
            this.cache.clear();
            this.state = tokenResult.code === 'USER_CANCELLED' || tokenResult.code === 'INTERACTION_REQUIRED'
                || tokenResult.code === 'TOKEN_UNAVAILABLE'
                ? 'disconnected'
                : 'error';
            return this.currentView();
        }

        this.token = tokenResult.token;
        const agendaResult = await this.port.readAgenda(tokenResult.token);
        if (generation !== this.generation) return this.currentView();
        if (!agendaResult.ok) {
            this.cache.clear();
            if (agendaResult.code === 'AUTH_REQUIRED' || agendaResult.code === 'PERMISSION_DENIED') {
                const rejectedToken = this.token;
                this.token = null;
                if (rejectedToken) {
                    await this.port.invalidateToken(rejectedToken);
                    if (generation !== this.generation) return this.currentView();
                }
                this.state = 'reconnect-required';
            } else {
                this.state = 'error';
            }
            return {
                ...this.currentView(),
                errorCode: agendaResult.code,
            };
        }

        const items = await this.cache.replace(agendaResult.events, Date.now(), () => generation === this.generation);
        if (generation !== this.generation) return this.currentView();
        this.state = items.length > 0 ? 'ready' : 'empty';
        return this.currentView();
    }
}
