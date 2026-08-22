import type { GoogleIdentityPort } from './google-identity.service';
import { GOOGLE_CALENDAR_RUNTIME_ENABLED } from '../calendar/calendar-capability';

export const GOOGLE_OAUTH_RUNTIME_CAPABILITY_ENABLED = GOOGLE_CALENDAR_RUNTIME_ENABLED;
export const GOOGLE_OAUTH_DISABLED_COPY = 'Agenda Calendar preparada en modo lectura. OAuth permanece desactivado hasta el canario autorizado.';

export interface GoogleOAuthUiState {
    visible: true;
    canConnect: false;
    status: 'disabled-preview';
    runtimeCapabilityEnabled: boolean;
}

export type GoogleOAuthConnectionResult =
    { ok: false; code: 'FEATURE_DISABLED'; runtimeCapabilityEnabled: boolean };

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
    _identity?: GoogleIdentityPort,
): Promise<GoogleOAuthConnectionResult> {
    // Gate A: legacy popup surfaces never own Google Identity. Gate B must
    // materialize OAuth through the background authority, not flip this path.
    return {
        ok: false,
        code: 'FEATURE_DISABLED',
        runtimeCapabilityEnabled: GOOGLE_OAUTH_RUNTIME_CAPABILITY_ENABLED,
    };
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
