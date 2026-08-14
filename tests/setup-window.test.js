const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { mockSessionStorage, mockWindows, mockRuntime } = require('./setup');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(source(relativePath), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

const { SETUP_WINDOW_ID_KEY, isSetupStandalone, openOrFocusSetupWindow, shouldLaunchDurableSetup } = loadTsModule('src/setup-window.ts');

describe('OAuth durable setup window helpers', () => {
    test('detects standalone setup mode without sensitive URL data', () => {
        expect(isSetupStandalone('?mode=setup')).toBe(true);
        expect(isSetupStandalone('?mode=setup&client_secret=nope')).toBe(true);
        expect(isSetupStandalone('')).toBe(false);
    });

    test('launches only from unauthenticated action popup', () => {
        expect(shouldLaunchDurableSetup({ authenticated: false }, false)).toBe(true);
        expect(shouldLaunchDurableSetup({ authenticated: false }, true)).toBe(false);
        expect(shouldLaunchDurableSetup({ authenticated: true }, false)).toBe(false);
        expect(shouldLaunchDurableSetup({ authenticated: false, authUnavailable: true }, false)).toBe(false);
    });

    test('focuses stored setup window id', async () => {
        await mockSessionStorage.set({ [SETUP_WINDOW_ID_KEY]: 42 });
        mockWindows.update.mockResolvedValue({ id: 42, focused: true });

        await expect(openOrFocusSetupWindow()).resolves.toBe(true);

        expect(mockWindows.update).toHaveBeenCalledWith(42, { focused: true });
        expect(mockWindows.create).not.toHaveBeenCalled();
    });

    test('recreates stale setup window id with internal mode URL only', async () => {
        await mockSessionStorage.set({ [SETUP_WINDOW_ID_KEY]: 42 });
        mockWindows.update.mockRejectedValue(new Error('stale'));
        mockWindows.create.mockResolvedValue({ id: 84, focused: true });

        await expect(openOrFocusSetupWindow()).resolves.toBe(true);

        expect(mockWindows.create).toHaveBeenCalledWith(expect.objectContaining({
            url: 'chrome-extension://mock-id/popup/popup.html?mode=setup',
            type: 'popup',
            focused: true,
            width: 560,
            height: 760,
        }));
        expect(mockRuntime.getURL).toHaveBeenCalledWith('popup/popup.html?mode=setup');
        expect(mockSessionStorage.data[SETUP_WINDOW_ID_KEY]).toBe(84);
    });

    test('creates setup window without singleton if storage.session is unavailable', async () => {
        const originalSession = chrome.storage.session;
        delete chrome.storage.session;
        mockWindows.create.mockResolvedValue({ id: 21, focused: true });

        await expect(openOrFocusSetupWindow()).resolves.toBe(true);

        expect(mockWindows.update).not.toHaveBeenCalled();
        expect(mockWindows.create).toHaveBeenCalledWith(expect.objectContaining({
            url: 'chrome-extension://mock-id/popup/popup.html?mode=setup',
        }));
        chrome.storage.session = originalSession;
    });
});
