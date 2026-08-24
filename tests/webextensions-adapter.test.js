const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadAdapter({ browser, chrome } = {}) {
    const filename = path.join(__dirname, '..', 'src', 'webextensions.ts');
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    const privateStorageFilename = path.join(__dirname, '..', 'src', 'private-storage.ts');
    const privateStorageCompiled = ts.transpileModule(fs.readFileSync(privateStorageFilename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: privateStorageFilename,
    }).outputText;
    const privateStorageModule = { exports: {} };
    new Function('require', 'module', 'exports', privateStorageCompiled)(require, privateStorageModule, privateStorageModule.exports);
    const localRequire = (request) => request === './private-storage'
        ? privateStorageModule.exports
        : require(request);
    const previousBrowser = globalThis.browser;
    const previousChrome = globalThis.chrome;
    const previousLocation = globalThis.location;

    if (browser === undefined) delete globalThis.browser;
    else globalThis.browser = browser;
    if (chrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = chrome;

    try {
        new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
        return module.exports;
    } finally {
        if (previousBrowser === undefined) delete globalThis.browser;
        else globalThis.browser = previousBrowser;
        if (previousChrome === undefined) delete globalThis.chrome;
        else globalThis.chrome = previousChrome;
        if (previousLocation === undefined) delete globalThis.location;
    }
}

function api(id, extensionUrl) {
    const area = {
        get: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
    };
    const onChanged = {
        addListener: jest.fn(),
        removeListener: jest.fn(),
        hasListener: jest.fn().mockReturnValue(false),
    };
    return {
        runtime: {
            id,
            getURL: jest.fn(() => extensionUrl),
        },
        storage: { local: area, session: area, sync: area, managed: area, onChanged },
        tabs: {},
        windows: {},
        alarms: {},
        action: {},
        identity: {},
    };
}

describe('B2 WebExtensions adapter contract', () => {
    test('preserves the native Chrome API and Chromium platform', () => {
        const chrome = api('chrome-id', 'chrome-extension://chrome-id/');
        const adapter = loadAdapter({ chrome });

        expect(adapter.webExtensions).toBe(chrome);
        expect(adapter.chrome).toBe(chrome);
        expect(adapter.extensionPlatform).toBe('chromium');
        expect(chrome.runtime.getURL).toHaveBeenCalledTimes(1);
    });

    test('prefers the Promise-native Firefox browser API', async () => {
        const browser = api('firefox-id', 'moz-extension://firefox-id/');
        const chrome = api('compat-alias', 'moz-extension://compat-alias/');
        const adapter = loadAdapter({ browser, chrome });

        expect(Object.getPrototypeOf(adapter.webExtensions)).toBe(browser);
        expect(adapter.webExtensions.storage.local).not.toBe(browser.storage.local);
        expect(adapter.extensionPlatform).toBe('firefox');
        expect(browser.runtime.getURL).toHaveBeenCalledTimes(2);
        expect(chrome.runtime.getURL).not.toHaveBeenCalled();

        const trusted = adapter.createWebExtensionsFacade(
            browser,
            'moz-extension://firefox-id/app/app.html',
        );
        await expect(trusted.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }))
            .resolves.toBeUndefined();
        await expect(adapter.webExtensions.storage.local.get(null))
            .rejects.toThrow('unavailable in content scripts');
    });

    test('fails closed without an extension runtime or with an unknown protocol', () => {
        expect(() => loadAdapter()).toThrow('WebExtensions API unavailable');
        expect(loadAdapter({ chrome: api('unknown-id', 'https://example.test/') }).extensionPlatform)
            .toBe('unsupported');
    });
});
