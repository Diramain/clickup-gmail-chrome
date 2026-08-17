import {
    requestGoogleCalendarToken,
    type GoogleCalendarTokenResult,
    type GoogleIdentityPort,
} from './google-identity.service';

export const GOOGLE_OAUTH_RUNTIME_CAPABILITY_ENABLED = false;
export const GOOGLE_OAUTH_DISABLED_COPY = 'Google Calendar estará disponible en una próxima fase. OAuth permanece desactivado.';

export interface GoogleOAuthUiState {
    visible: true;
    canConnect: false;
    status: 'disabled-preview';
    runtimeCapabilityEnabled: false;
}

export type GoogleOAuthConnectionResult =
    | GoogleCalendarTokenResult
    | { ok: false; code: 'FEATURE_DISABLED'; runtimeCapabilityEnabled: false };

export interface GoogleOAuthButtonLike {
    disabled: boolean;
    setAttribute(name: string, value: string): void;
    addEventListener(type: 'click', listener: () => void): void;
}

export interface GoogleOAuthStatusLike {
    textContent: string | null;
}

export interface GoogleOAuthSurface {
    button: GoogleOAuthButtonLike | null;
    status: GoogleOAuthStatusLike | null;
}

export function getGoogleOAuthUiState(): GoogleOAuthUiState {
    return {
        visible: true,
        canConnect: false,
        status: 'disabled-preview',
        runtimeCapabilityEnabled: GOOGLE_OAUTH_RUNTIME_CAPABILITY_ENABLED,
    };
}

export async function beginGoogleCalendarConnection(
    identity?: GoogleIdentityPort,
): Promise<GoogleOAuthConnectionResult> {
    if (!GOOGLE_OAUTH_RUNTIME_CAPABILITY_ENABLED) {
        return { ok: false, code: 'FEATURE_DISABLED', runtimeCapabilityEnabled: false };
    }

    return requestGoogleCalendarToken(true, identity);
}

export function initGoogleOAuthConnectionPreview(
    surfaces: readonly GoogleOAuthSurface[],
    identity?: GoogleIdentityPort,
): void {
    const state = getGoogleOAuthUiState();
    for (const surface of surfaces) {
        if (!surface.button || !surface.status) continue;
        surface.button.disabled = !state.canConnect;
        surface.button.setAttribute('aria-disabled', String(!state.canConnect));
        surface.button.setAttribute('data-oauth-state', state.status);
        surface.status.textContent = GOOGLE_OAUTH_DISABLED_COPY;
        surface.button.addEventListener('click', () => {
            void beginGoogleCalendarConnection(identity).then((result) => {
                if (!result.ok && result.code === 'FEATURE_DISABLED') {
                    surface.status!.textContent = GOOGLE_OAUTH_DISABLED_COPY;
                }
            });
        });
    }
}
