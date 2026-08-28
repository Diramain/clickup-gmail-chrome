export type ClickUpAuthMethod = 'personal-token';

const PERSONAL_TOKEN_PATTERN = /^pk_[A-Za-z0-9_-]{20,300}$/;

export function normalizePersonalToken(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const token = value.trim().replace(/^Bearer\s+/i, '');
    return PERSONAL_TOKEN_PATTERN.test(token) ? token : null;
}

export function resolveClickUpAuthMethod(value: unknown, hasPersonalToken: boolean): ClickUpAuthMethod | undefined {
    return value === 'personal-token' || hasPersonalToken ? 'personal-token' : undefined;
}

export interface ClickUpTokenOnlyMigration {
    personalToken: string | null;
    requiresReauth: boolean;
}

export function planClickUpTokenOnlyMigration(
    token: unknown,
    legacyAuthMethod: unknown,
    hasLegacyOAuthConfig: boolean,
    wasReauthRequired: boolean,
    hadStoredCredential: boolean,
    legacyAuthorizationMode?: unknown,
): ClickUpTokenOnlyMigration {
    const personalToken = normalizePersonalToken(token);
    const hasBearerPrefix = typeof token === 'string' && /^Bearer\s+/i.test(token.trim());
    const hasAmbiguousBearerState = legacyAuthMethod !== 'personal-token'
        && (legacyAuthorizationMode === 'bearer' || hasBearerPrefix);
    const hasOAuthProvenance = legacyAuthMethod === 'oauth' || hasLegacyOAuthConfig || hasAmbiguousBearerState;
    if (personalToken && !wasReauthRequired && !hasOAuthProvenance) {
        return { personalToken, requiresReauth: false };
    }

    return {
        personalToken: null,
        requiresReauth: wasReauthRequired
            || hadStoredCredential
            || legacyAuthMethod === 'personal-token'
            || hasOAuthProvenance,
    };
}
