export interface OAuthConfigStateInput {
    hasStoredConfig: boolean;
    isDirty: boolean;
    clientId: string;
    clientSecret: string;
}

export interface OAuthConfigState {
    hasStoredConfig: boolean;
    isDirty: boolean;
    fieldsComplete: boolean;
    canSave: boolean;
    shouldSaveBeforeSignIn: boolean;
    canSignIn: boolean;
    isBlockedByIncompleteChanges: boolean;
}

export interface InitialOAuthDraftInput {
    hasStoredConfig: boolean;
    draftClientId?: unknown;
}

export interface InitialOAuthDraftResolution {
    clientId: string;
    isDirty: boolean;
    shouldClearDraftClientId: boolean;
}

export interface InitialOAuthDraftApplicationInput {
    isDirty: boolean;
    clientId: string;
    clientSecret: string;
}

export function normalizeOAuthField(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function evaluateOAuthConfigState(input: OAuthConfigStateInput): OAuthConfigState {
    const clientId = normalizeOAuthField(input.clientId);
    const clientSecret = normalizeOAuthField(input.clientSecret);
    const hasStoredConfig = Boolean(input.hasStoredConfig);
    const isDirty = Boolean(input.isDirty);
    const fieldsComplete = clientId.length > 0 && clientSecret.length > 0;

    return {
        hasStoredConfig,
        isDirty,
        fieldsComplete,
        canSave: fieldsComplete,
        shouldSaveBeforeSignIn: fieldsComplete && (isDirty || !hasStoredConfig),
        canSignIn: fieldsComplete || (hasStoredConfig && !isDirty),
        isBlockedByIncompleteChanges: isDirty && !fieldsComplete,
    };
}

export function resolveInitialOAuthDraft(input: InitialOAuthDraftInput): InitialOAuthDraftResolution {
    const draftClientId = normalizeOAuthField(input.draftClientId);

    if (input.hasStoredConfig) {
        return {
            clientId: '',
            isDirty: false,
            shouldClearDraftClientId: draftClientId.length > 0,
        };
    }

    return {
        clientId: draftClientId,
        isDirty: draftClientId.length > 0,
        shouldClearDraftClientId: false,
    };
}

export function shouldApplyInitialOAuthDraft(input: InitialOAuthDraftApplicationInput): boolean {
    return (
        !input.isDirty &&
        normalizeOAuthField(input.clientId).length === 0 &&
        normalizeOAuthField(input.clientSecret).length === 0
    );
}
