const MEET_ORIGIN = 'https://meet.google.com';
const ROOM_CODE_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export type MeetPageContext =
    | { kind: 'home' }
    | { kind: 'candidate'; roomCode: string }
    | { kind: 'outside-meet' };

export function resolveMeetPageContext(rawUrl: string | undefined | null): MeetPageContext {
    if (!rawUrl) return { kind: 'outside-meet' };

    try {
        const url = new URL(rawUrl);
        if (url.origin !== MEET_ORIGIN) return { kind: 'outside-meet' };
        const roomCode = url.pathname.split('/').filter(Boolean)[0] || '';
        if (!ROOM_CODE_PATTERN.test(roomCode)) return { kind: 'home' };
        return { kind: 'candidate', roomCode };
    } catch {
        return { kind: 'outside-meet' };
    }
}

export async function createMeetRoomKey(roomCode: string): Promise<string | null> {
    if (!ROOM_CODE_PATTERN.test(roomCode) || !globalThis.crypto?.subtle) return null;
    const bytes = new TextEncoder().encode(`cgc-meet-v1:${roomCode}`);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export function hasConfirmedMeetSession(documentRoot: Document): boolean {
    const leaveButton = documentRoot.querySelector<HTMLElement>(
        '[data-tooltip*="Leave call" i], [data-tooltip*="Salir de la llamada" i], [aria-label*="Leave call" i], [aria-label*="Salir de la llamada" i]'
    );
    if (!leaveButton || leaveButton.hidden || leaveButton.hasAttribute('disabled')) return false;
    if (leaveButton.getAttribute('aria-hidden') === 'true' || leaveButton.getAttribute('aria-disabled') === 'true') return false;
    return leaveButton.style.display !== 'none' && leaveButton.style.visibility !== 'hidden';
}
