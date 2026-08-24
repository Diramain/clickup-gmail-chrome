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
    const previousBrowser = globalThis.browser;
    const previousChrome = globalThis.chrome;

    if (browser === undefined) delete globalThis.browser;
    else globalThis.browser = browser;
    if (chrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = chrome;

    try {
        new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
        return module.exports;
    } finally {
        if (previousBrowser === undefined) delete globalThis.browser;
        else globalThis.browser = previousBrowser;
        if (previousChrome === undefined) delete globalThis.chrome;
        else globalThis.chrome = previousChrome;
    }
}

function api(id, extensionUrl) {
    return {
        runtime: {
            id,
            getURL: jest.fn(() => extensionUrl),
        },
        storage: {},
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

    test('prefers the Promise-native Firefox browser API', () => {
        const browser = api('firefox-id', 'moz-extension://firefox-id/');
        const chrome = api('compat-alias', 'moz-extension://compat-alias/');
        const adapter = loadAdapter({ browser, chrome });

        expect(adapter.webExtensions).toBe(browser);
        expect(adapter.extensionPlatform).toBe('firefox');
        expect(browser.runtime.getURL).toHaveBeenCalledTimes(1);
        expect(chrome.runtime.getURL).not.toHaveBeenCalled();
    });

    test('fails closed without an extension runtime or with an unknown protocol', () => {
        expect(() => loadAdapter()).toThrow('WebExtensions API unavailable');
        expect(loadAdapter({ chrome: api('unknown-id', 'https://example.test/') }).extensionPlatform)
            .toBe('unsupported');
    });
});
