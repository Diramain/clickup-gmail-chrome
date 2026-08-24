import { createFirefoxStorageFacade, isTrustedExtensionContext } from './private-storage';

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

const nativeWebExtensions = selectWebExtensionsApi();
export const extensionPlatform = detectExtensionPlatform(nativeWebExtensions.runtime.getURL('/'));

export function createWebExtensionsFacade(
    api: ExtensionApi,
    contextUrl: string = globalThis.location?.href ?? '',
): ExtensionApi {
    if (extensionPlatform !== 'firefox') return api;
    const facade = Object.create(api) as ExtensionApi;
    Object.defineProperty(facade, 'storage', {
        value: createFirefoxStorageFacade(
            api.storage,
            isTrustedExtensionContext(api.runtime.getURL('/'), contextUrl),
        ),
        enumerable: true,
    });
    return facade;
}

export const webExtensions = createWebExtensionsFacade(nativeWebExtensions);

// esbuild injects this export for legacy call sites, keeping selection centralized.
export { webExtensions as chrome };
