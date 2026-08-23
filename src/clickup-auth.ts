export type ClickUpAuthMethod = 'personal-token' | 'oauth';

const PERSONAL_TOKEN_PATTERN = /^pk_[A-Za-z0-9_-]{20,300}$/;

export function normalizePersonalToken(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const token = value.trim().replace(/^Bearer\s+/i, '');
    return PERSONAL_TOKEN_PATTERN.test(token) ? token : null;
}

export function resolveClickUpAuthMethod(value: unknown, hasOAuthConfig: boolean): ClickUpAuthMethod | undefined {
    if (value === 'personal-token' || value === 'oauth') return value;
    return hasOAuthConfig ? 'oauth' : undefined;
}
