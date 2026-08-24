export type ExtensionPlatform = 'chromium' | 'firefox' | 'unsupported';

type ExtensionApi = typeof chrome;
type ExtensionGlobals = typeof globalThis & {
    browser?: ExtensionApi;
    chrome?: ExtensionApi;
};

export function detectExtensionPlatform(extensionUrl: string): ExtensionPlatform {
    try {
        const protocol = new URL(extensionUrl).protocol;
        if (protocol === 'chrome-extension:') return 'chromium';
        if (protocol === 'moz-extension:') return 'firefox';
        return 'unsupported';
    } catch {
        return 'unsupported';
    }
}

export function selectWebExtensionsApi(globals: ExtensionGlobals = globalThis): ExtensionApi {
    const candidate = typeof globals.browser?.runtime?.getURL === 'function'
        ? globals.browser
        : globals.chrome;

    if (typeof candidate?.runtime?.getURL !== 'function') {
        throw new Error('WebExtensions API unavailable');
    }

    return candidate;
}

export const webExtensions = selectWebExtensionsApi();
export const extensionPlatform = detectExtensionPlatform(webExtensions.runtime.getURL('/'));

// esbuild injects this export for legacy call sites, keeping selection centralized.
export { webExtensions as chrome };
