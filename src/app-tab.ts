export const APP_TAB_PATH = 'app/app.html';
export const APP_TAB_ID_KEY = 'clickupGmailAppTabId';

export interface AppTabPort {
    getStoredTabId(): Promise<number | null>;
    clearStoredTabId(): Promise<void>;
    storeTabId(tabId: number): Promise<void>;
    activateTab(tabId: number): Promise<{ windowId?: number }>;
    focusWindow(windowId: number): Promise<void>;
    createTab(url: string): Promise<{ id?: number }>;
    getExtensionUrl(path: string): string;
}

export type OpenAppTabResult = 'created' | 'focused';

export function createChromeAppTabPort(): AppTabPort {
    return {
        async getStoredTabId() {
            const stored = await chrome.storage.session.get(APP_TAB_ID_KEY);
            const tabId = Number(stored[APP_TAB_ID_KEY]);
            return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
        },
        async clearStoredTabId() {
            await chrome.storage.session.remove(APP_TAB_ID_KEY);
        },
        async storeTabId(tabId) {
            await chrome.storage.session.set({ [APP_TAB_ID_KEY]: tabId });
        },
        async activateTab(tabId) {
            const tab = await chrome.tabs.update(tabId, { active: true });
            return { windowId: tab.windowId };
        },
        async focusWindow(windowId) {
            await chrome.windows.update(windowId, { focused: true });
        },
        async createTab(url) {
            return chrome.tabs.create({ url, active: true });
        },
        getExtensionUrl(path) {
            return chrome.runtime.getURL(path);
        },
    };
}

export async function openOrFocusAppTab(
    port: AppTabPort = createChromeAppTabPort(),
): Promise<OpenAppTabResult> {
    const storedTabId = await port.getStoredTabId();
    if (storedTabId) {
        try {
            const tab = await port.activateTab(storedTabId);
            if (Number.isInteger(tab.windowId) && Number(tab.windowId) > 0) {
                await port.focusWindow(Number(tab.windowId));
            }
            return 'focused';
        } catch {
            await port.clearStoredTabId();
        }
    }

    const created = await port.createTab(port.getExtensionUrl(APP_TAB_PATH));
    if (!created.id) throw new Error('APP_TAB_CREATE_FAILED');
    await port.storeTabId(created.id);
    return 'created';
}
