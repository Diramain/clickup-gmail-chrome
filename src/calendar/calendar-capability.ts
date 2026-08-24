import { extensionPlatform } from '../webextensions';

export function isGoogleCalendarRuntimeSupported(extensionUrl: string): boolean {
    try {
        return new URL(extensionUrl).protocol === 'chrome-extension:';
    } catch {
        return false;
    }
}

// Firefox stays fail-closed until its separate Google OAuth adapter exists.
export const GOOGLE_CALENDAR_RUNTIME_ENABLED = extensionPlatform === 'chromium';
