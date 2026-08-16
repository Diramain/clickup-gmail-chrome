export const GOOGLE_CALENDAR_CORE_SCOPES = Object.freeze([
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.freebusy',
    'https://www.googleapis.com/auth/calendar.events.owned',
]);

export const GOOGLE_MEET_SETTINGS_SCOPE = 'https://www.googleapis.com/auth/meetings.space.settings';

export function isCoreGoogleScope(scope: string): boolean {
    return (GOOGLE_CALENDAR_CORE_SCOPES as readonly string[]).includes(scope);
}

export function sanitizeGrantedScopes(scopes: unknown): string[] {
    if (!Array.isArray(scopes)) return [];
    return scopes.filter((scope): scope is string => typeof scope === 'string' && (isCoreGoogleScope(scope) || scope === GOOGLE_MEET_SETTINGS_SCOPE));
}
