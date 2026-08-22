export const GMAIL_INTEGRATION_PREFERENCE_KEY = 'cgcGmailIntegrationV1';

export interface GmailIntegrationPreferenceV1 {
    version: 1;
    enabled: boolean;
}

export function normalizeGmailIntegrationPreference(value: unknown): GmailIntegrationPreferenceV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: 1, enabled: true };
    const candidate = value as Partial<GmailIntegrationPreferenceV1>;
    return {
        version: 1,
        enabled: candidate.version === 1 && typeof candidate.enabled === 'boolean' ? candidate.enabled : true,
    };
}
