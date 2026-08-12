export const SETUP_MODE_QUERY = 'mode=setup';
export const SETUP_WINDOW_ID_KEY = 'oauthSetupWindowId';
export const SETUP_WINDOW_PATH = `popup/popup.html?${SETUP_MODE_QUERY}`;

export function isSetupStandalone(search: string = window.location.search): boolean {
    return new URLSearchParams(search).get('mode') === 'setup';
}

export function shouldLaunchDurableSetup(status: { authenticated?: boolean }, standalone: boolean): boolean {
    return !standalone && status.authenticated !== true;
}

export async function openOrFocusSetupWindow(): Promise<boolean> {
    const session = chrome.storage.session;
    const stored = session ? await session.get(SETUP_WINDOW_ID_KEY) : {};
    const storedId = Number(stored[SETUP_WINDOW_ID_KEY]);

    if (Number.isInteger(storedId) && storedId > 0) {
        try {
            await chrome.windows.update(storedId, { focused: true });
            return true;
        } catch (_error) {
            await session?.remove(SETUP_WINDOW_ID_KEY);
        }
    }

    const created = await chrome.windows.create({
        url: chrome.runtime.getURL(SETUP_WINDOW_PATH),
        type: 'popup',
        width: 560,
        height: 760,
        focused: true,
    });

    if (!created?.id) return false;
    await session?.set({ [SETUP_WINDOW_ID_KEY]: created.id });
    return true;
}
