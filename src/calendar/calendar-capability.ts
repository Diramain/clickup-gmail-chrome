export function isGoogleCalendarRuntimeSupported(_extensionUrl: string): boolean {
    return false;
}

// Calendar remains visible as a future integration, but no browser may invoke its runtime yet.
export const GOOGLE_CALENDAR_RUNTIME_ENABLED = false;
