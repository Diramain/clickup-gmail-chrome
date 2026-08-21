const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadMinimalModule() {
    const compiled = ts.transpileModule(source('popup/minimal.ts'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: 'popup/minimal.ts',
    }).outputText;
    const module = { exports: {} };
    const localRequire = (request) => {
        if (request === '../src/app-tab') return { openOrFocusAppTab: jest.fn().mockResolvedValue(true) };
        if (request === '../src/time-entry-history') return { toTimeEntryTimestamp: (value) => Number(value) };
        return {};
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

describe('minimal popup parity', () => {
    beforeEach(() => {
        document.documentElement.innerHTML = source('popup/minimal.html');
        localStorage.clear();
    });

    test('normalizes tab themes and rejects corrupt last-task state', () => {
        const popup = loadMinimalModule();
        expect(popup.resolveMinimalTheme('clickup')).toBe('clickup');
        expect(popup.resolveMinimalTheme('spiritfox')).toBe('spiritfox');
        expect(popup.resolveMinimalTheme('unknown')).toBe('paper');
        expect(popup.sanitizeLastTrackedTask({ id: '../bad', teamId: 'T', name: 'Bad' })).toBeNull();
        expect(popup.sanitizeLastTrackedTask({ id: 'A', teamId: 'T', name: 'Alpha' })).toEqual({ id: 'A', teamId: 'T', name: 'Alpha' });
    });

    test('follows the stored theme and exposes guarded play, stop and Meet priority', async () => {
        const messages = [];
        const sendMessage = jest.fn(async (message) => {
            messages.push(message);
            if (message.action === 'getStatus') return { authenticated: true };
            if (message.action === 'getPreferredTeam') return { teamId: 'TEAM' };
            if (message.action === 'getRunningTimer') return null;
            if (message.action === 'getMeetPriorityStatus') return { enabled: true, status: 'awaiting-task' };
            return { success: true };
        });
        global.chrome = {
            runtime: { sendMessage },
            storage: { local: {
                get: jest.fn().mockResolvedValue({ lastTrackedTaskV1: { id: 'TASK', name: 'Alpha', teamId: 'TEAM' } }),
                set: jest.fn().mockResolvedValue(undefined),
            } },
        };
        localStorage.setItem('cgc-app-theme-v1', 'clickup');
        const popup = loadMinimalModule();
        await popup.initMinimalPopup();

        expect(document.documentElement.dataset.theme).toBe('clickup');
        expect(document.getElementById('miniPlayTimer').disabled).toBe(false);
        expect(document.getElementById('miniStopTimer').disabled).toBe(true);
        expect(document.getElementById('miniMeetChooser').hidden).toBe(false);
        expect(document.getElementById('miniMeetStatus').textContent).toContain('elegí una tarea');
        document.getElementById('miniPlayTimer').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(messages).toContainEqual({ action: 'startTimer', data: { teamId: 'TEAM', taskId: 'TASK' } });

        const priority = document.getElementById('miniMeetPriority');
        priority.checked = true;
        priority.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(messages).toContainEqual({ action: 'setMeetPriorityEnabled', data: { enabled: true } });
        delete global.chrome;
    });
});
