export const GOOGLE_CALENDAR_CORE_SCOPES = Object.freeze([
    'https://www.googleapis.com/auth/calendar.events.owned.readonly',
]);

export const GOOGLE_MEET_SETTINGS_SCOPE = 'https://www.googleapis.com/auth/meetings.space.settings';

export function isCoreGoogleScope(scope: string): boolean {
    return (GOOGLE_CALENDAR_CORE_SCOPES as readonly string[]).includes(scope);
}

export function sanitizeGrantedScopes(scopes: unknown): string[] {
    if (!Array.isArray(scopes)) return [];
    return scopes.filter((scope): scope is string => typeof scope === 'string' && (isCoreGoogleScope(scope) || scope === GOOGLE_MEET_SETTINGS_SCOPE));
}

export interface GoogleIdentityPort {
    getAuthToken(
        details: { interactive: boolean; scopes: string[] },
        callback: (token?: string, grantedScopes?: string[]) => void,
    ): void;
    removeCachedAuthToken(details: { token: string }, callback: () => void): void;
    getLastErrorMessage(): string | null;
}

export type GoogleCalendarTokenFailureCode =
    | 'USER_CANCELLED'
    | 'INTERACTION_REQUIRED'
    | 'TOKEN_UNAVAILABLE'
    | 'SCOPES_NOT_GRANTED'
    | 'IDENTITY_UNAVAILABLE';

export type GoogleCalendarTokenResult =
    | { ok: true; token: string; grantedScopes: string[] }
    | { ok: false; code: GoogleCalendarTokenFailureCode; missingScopes?: string[] };

export type GoogleTokenInvalidationResult =
    | { ok: true }
    | { ok: false; code: 'TOKEN_UNAVAILABLE' | 'IDENTITY_UNAVAILABLE' };

export function createChromeGoogleIdentityPort(): GoogleIdentityPort {
    return {
        getAuthToken(details, callback) {
            chrome.identity.getAuthToken(details, callback);
        },
        removeCachedAuthToken(details, callback) {
            chrome.identity.removeCachedAuthToken(details, callback);
        },
        getLastErrorMessage() {
            return chrome.runtime.lastError?.message ?? null;
        },
    };
}

function classifyIdentityError(message: string, interactive: boolean): GoogleCalendarTokenFailureCode {
    const normalized = message.toLowerCase();
    if (/cancel|canceled|cancelled|denied|did not approve|user rejected/.test(normalized)) {
        return 'USER_CANCELLED';
    }
    return interactive ? 'IDENTITY_UNAVAILABLE' : 'INTERACTION_REQUIRED';
}

export function requestGoogleCalendarToken(
    interactive: boolean,
    identity: GoogleIdentityPort = createChromeGoogleIdentityPort(),
): Promise<GoogleCalendarTokenResult> {
    return new Promise((resolve) => {
        identity.getAuthToken(
            { interactive, scopes: [...GOOGLE_CALENDAR_CORE_SCOPES] },
            (token, grantedScopes) => {
                const lastError = identity.getLastErrorMessage();
                if (lastError) {
                    resolve({ ok: false, code: classifyIdentityError(lastError, interactive) });
                    return;
                }

                if (typeof token !== 'string' || token.trim().length === 0) {
                    resolve({ ok: false, code: 'TOKEN_UNAVAILABLE' });
                    return;
                }

                const sanitizedScopes = sanitizeGrantedScopes(grantedScopes);
                const missingScopes = GOOGLE_CALENDAR_CORE_SCOPES.filter((scope) => !sanitizedScopes.includes(scope));
                if (missingScopes.length > 0) {
                    resolve({ ok: false, code: 'SCOPES_NOT_GRANTED', missingScopes });
                    return;
                }

                resolve({ ok: true, token, grantedScopes: sanitizedScopes });
            },
        );
    });
}

export function invalidateGoogleCalendarToken(
    token: string,
    identity: GoogleIdentityPort = createChromeGoogleIdentityPort(),
): Promise<GoogleTokenInvalidationResult> {
    if (token.trim().length === 0) {
        return Promise.resolve({ ok: false, code: 'TOKEN_UNAVAILABLE' });
    }

    return new Promise((resolve) => {
        identity.removeCachedAuthToken({ token }, () => {
            resolve(identity.getLastErrorMessage()
                ? { ok: false, code: 'IDENTITY_UNAVAILABLE' }
                : { ok: true });
        });
    });
}
