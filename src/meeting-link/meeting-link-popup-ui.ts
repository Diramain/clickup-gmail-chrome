export interface MeetingLinkUiState {
    ok: true;
    status: 'disabled';
    canCreate: false;
    integrationBlocked: true;
    runtimeCapabilityEnabled: false;
}

export const MEETING_LINK_UI_TIMEOUT_MS = 500;

export interface MeetingLinkSectionLike {
    hidden: boolean;
    classList: { add(className: string): void };
    replaceChildren(): void;
}

export function keepMeetingLinkSectionHidden(section: MeetingLinkSectionLike | null): void {
    if (!section) return;
    section.hidden = true;
    section.classList.add('hidden');
    section.replaceChildren();
}

export function isMeetingLinkUiState(value: unknown): value is MeetingLinkUiState {
    const state = value as MeetingLinkUiState;
    return !!state
        && state.ok === true
        && state.status === 'disabled'
        && state.canCreate === false
        && state.integrationBlocked === true
        && state.runtimeCapabilityEnabled === false
        && Object.keys(state).every((key) => ['ok', 'status', 'canCreate', 'integrationBlocked', 'runtimeCapabilityEnabled'].includes(key));
}

export async function initMeetingLinkSectionFailClosed(
    section: MeetingLinkSectionLike | null,
    getState: () => Promise<unknown>,
    timeoutMs = MEETING_LINK_UI_TIMEOUT_MS,
): Promise<void> {
    keepMeetingLinkSectionHidden(section);
    try {
        const state = await withTimeout(getState(), timeoutMs);
        if (!isMeetingLinkUiState(state)) keepMeetingLinkSectionHidden(section);
        keepMeetingLinkSectionHidden(section);
    } catch {
        keepMeetingLinkSectionHidden(section);
    }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('MEETING_LINK_UI_TIMEOUT')), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeout);
                reject(error);
            },
        );
    });
}
