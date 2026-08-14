const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const normalizedPath = path.normalize(relativePath);
    const filename = path.join(__dirname, '..', normalizedPath);
    const compiled = ts.transpileModule(source(normalizedPath), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    const localRequire = (request) => {
        if (request.startsWith('.')) {
            const resolved = path.normalize(path.join(path.dirname(normalizedPath), request));
            return loadTsModule(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
        }
        return require(request);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

function response(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => body,
        clone() { return response(status, body); },
    };
}

describe('CGC-DIAG-005 safe session diagnostics', () => {
    const diagnostics = loadTsModule('src/diagnostic-log.ts');

    test('is off by default and ignores records without persisting state', async () => {
        const log = new diagnostics.SafeDiagnosticLog(chrome.storage.session, () => 1_700_000_000_000);

        await expect(log.getStatus()).resolves.toEqual({
            enabled: false,
            eventCount: 0,
            droppedCount: 0,
            maxEvents: 200,
        });
        await expect(log.record('auth_state', { stage: 'status', outcome: 'remote' })).resolves.toBe(false);

        expect(chrome.storage.session.data.safeDiagnosticLogV1).toBeUndefined();
        expect(chrome.storage.local.data.safeDiagnosticLogV1).toBeUndefined();
    });

    test('exports only allowlisted categorical fields and discards sensitive or unknown values', async () => {
        let now = 1_700_000_000_000;
        const log = new diagnostics.SafeDiagnosticLog(chrome.storage.session, () => now++);
        await log.setEnabled(true);
        await log.record('api_request', {
            route: 'task-direct',
            method: 'read',
            authorizationMode: 'bearer',
            attempt: 1,
            fallback: false,
            token: 'synthetic-secret-token',
            url: 'https://api.example.test/private/TASK-REAL-123',
            taskId: 'TASK-REAL-123',
            workspaceId: 'WORKSPACE-REAL-456',
            email: 'person@example.test',
            headers: { Authorization: 'Bearer synthetic-secret-token' },
        });
        await log.record('task_validation', {
            stage: 'direct',
            outcome: 'failure',
            failureClass: 'workspace-not-authorized',
            clickupCode: 'OAUTH_027',
            name: 'Private task name',
            payload: { private: true },
        });
        await log.record('api_request', {
            route: 'https://api.example.test/private',
            method: 'read',
            authorizationMode: 'invalid-mode',
            attempt: 99,
            fallback: 'yes',
        });

        const exported = await log.createExport('1.2.3');
        expect(exported).toMatchObject({
            schemaVersion: 1,
            extensionVersion: '1.2.3',
            storageScope: 'browser-session',
            enabled: true,
            eventCount: 4,
            droppedCount: 0,
            maxEvents: 200,
        });
        expect(exported.events[1]).toEqual(expect.objectContaining({
            event: 'api_request',
            details: {
                route: 'task-direct',
                method: 'read',
                authorizationMode: 'bearer',
                attempt: 1,
                fallback: false,
            },
        }));
        expect(exported.events[2].details.clickupCode).toBe('OAUTH_027');
        expect(exported.events[3].details).toEqual({ method: 'read' });

        const restoredWorkerLog = new diagnostics.SafeDiagnosticLog(chrome.storage.session, () => now++);
        await expect(restoredWorkerLog.getStatus()).resolves.toEqual({
            enabled: true,
            eventCount: 4,
            droppedCount: 0,
            maxEvents: 200,
        });

        const serialized = JSON.stringify(exported);
        expect(serialized).not.toMatch(/synthetic-secret-token|TASK-REAL-123|WORKSPACE-REAL-456|person@example\.test|Private task name|api\.example\.test|Authorization|workspaceId|taskId|payload/);
        expect(chrome.storage.local.data.safeDiagnosticLogV1).toBeUndefined();
    });

    test('keeps a hard 200-event bound, counts dropped entries, and clears without enabling', async () => {
        let now = 1_700_000_000_000;
        const log = new diagnostics.SafeDiagnosticLog(chrome.storage.session, () => now++);
        await log.setEnabled(true);
        for (let index = 0; index < 205; index += 1) {
            await log.record('timer_poll', { outcome: index % 2 === 0 ? 'running' : 'stopped' });
        }

        const exported = await log.createExport('1.2.3');
        expect(exported.eventCount).toBe(200);
        expect(exported.droppedCount).toBe(6);
        expect(exported.events).toHaveLength(200);
        expect(exported.events[0].sequence).toBe(7);
        expect(exported.events[199].sequence).toBe(206);

        await expect(log.clear()).resolves.toEqual({
            enabled: true,
            eventCount: 0,
            droppedCount: 0,
            maxEvents: 200,
        });
        await log.setEnabled(false);
        await expect(log.record('timer_poll', { outcome: 'running' })).resolves.toBe(false);
        const disabledExport = await log.createExport('not a version');
        expect(disabledExport.enabled).toBe(false);
        expect(disabledExport.extensionVersion).toBe('unknown');
        expect(disabledExport.events.at(-1).event).toBe('diagnostic_disabled');
    });

    test('keeps last-tab close as a bounded categorical transition without task identity', async () => {
        const log = new diagnostics.SafeDiagnosticLog(chrome.storage.session, () => 1_700_000_000_000);
        await log.setEnabled(true);
        await log.record('timer_transition', {
            action: 'stop',
            outcome: 'stopped',
            reason: 'last-task-tab-closed',
            taskId: 'TASK-PRIVATE-123',
            url: 'https://app.clickup.com/t/private',
        });

        const exported = await log.createExport('1.2.3');
        expect(exported.events.at(-1)).toEqual(expect.objectContaining({
            event: 'timer_transition',
            details: {
                action: 'stop',
                outcome: 'stopped',
                reason: 'last-task-tab-closed',
            },
        }));
        expect(JSON.stringify(exported)).not.toMatch(/TASK-PRIVATE-123|clickup\.com/);
    });

    test('sanitizes corrupted session state again before export', async () => {
        chrome.storage.session.data.safeDiagnosticLogV1 = {
            enabled: true,
            nextSequence: Number.MAX_SAFE_INTEGER,
            droppedCount: Number.MAX_SAFE_INTEGER,
            events: [
                {
                    sequence: 1,
                    timestamp: 1,
                    event: 'api_response',
                    details: {
                        route: 'task-direct',
                        method: 'read',
                        outcome: 'failure',
                        failureClass: 'unauthorized',
                        clickupCode: 'OAUTH_999',
                        token: 'must-not-survive',
                    },
                },
                { sequence: 2, timestamp: 2, event: 'unknown_event', details: { url: 'private' } },
            ],
        };
        const log = new diagnostics.SafeDiagnosticLog(chrome.storage.session, () => 1_700_000_000_000);
        const exported = await log.createExport('1.2.3');

        expect(exported.events).toEqual([{
            sequence: 1,
            timestamp: 1,
            event: 'api_response',
            details: {
                route: 'task-direct',
                method: 'read',
                outcome: 'failure',
                failureClass: 'unauthorized',
            },
        }]);
        expect(exported.droppedCount).toBe(1_000_000);
        expect(JSON.stringify(exported)).not.toMatch(/OAUTH_999|must-not-survive|unknown_event|private/);
    });

    test('diagnostic messages are extension-only and strictly shaped', () => {
        const security = loadTsModule('src/message-security.ts');
        const runtimeId = 'ext-id';
        const extensionSender = { id: runtimeId, url: 'chrome-extension://ext-id/popup/popup.html' };
        const gmailSender = { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' };
        const clickupSender = { id: runtimeId, url: 'https://app.clickup.com/t/TASK' };
        const meetSender = { id: runtimeId, url: 'https://meet.google.com/abc-defg-hij' };

        for (const action of ['getDiagnosticStatus', 'exportDiagnostics', 'clearDiagnostics']) {
            expect(security.validateExtensionMessage({ action }, extensionSender, runtimeId).ok).toBe(true);
            expect(security.validateExtensionMessage({ action }, gmailSender, runtimeId).ok).toBe(false);
            expect(security.validateExtensionMessage({ action }, clickupSender, runtimeId).ok).toBe(false);
            expect(security.validateExtensionMessage({ action }, meetSender, runtimeId).ok).toBe(false);
            expect(security.validateExtensionMessage({ action, data: {} }, extensionSender, runtimeId).ok).toBe(false);
        }
        expect(security.validateExtensionMessage({ action: 'setDiagnosticEnabled', data: { enabled: true } }, extensionSender, runtimeId).ok).toBe(true);
        expect(security.validateExtensionMessage({ action: 'setDiagnosticEnabled', data: { enabled: true } }, gmailSender, runtimeId).ok).toBe(false);
        expect(security.validateExtensionMessage({ action: 'setDiagnosticEnabled', data: { enabled: true, taskId: 'TASK' } }, extensionSender, runtimeId).ok).toBe(false);
        expect(security.validateExtensionMessage({ action: 'setDiagnosticEnabled', data: { enabled: 'true' } }, extensionSender, runtimeId).ok).toBe(false);
    });

    test('API instrumentation emits categorical routes without identifiers, headers, or token values', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-secret-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'bearer',
        );
        const events = [];
        api.setDiagnosticCallback(event => events.push(event));
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(401, { ECODE: 'OAUTH_027', err: 'private remote text' }))
            .mockResolvedValueOnce(response(401, { ECODE: 'OAUTH_027', err: 'private remote text' }))
            .mockResolvedValueOnce(response(200, { user: { id: 1 } }));

        await expect(api.getTask('TASK-REAL-123')).rejects.toMatchObject({ status: 401, clickupCode: 'OAUTH_027' });

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ event: 'api_request', details: expect.objectContaining({ route: 'task-direct', method: 'read', authorizationMode: 'bearer' }) }),
            expect.objectContaining({ event: 'api_response', details: expect.objectContaining({ route: 'task-direct', failureClass: 'workspace-not-authorized', clickupCode: 'OAUTH_027' }) }),
            expect.objectContaining({ event: 'api_request', details: expect.objectContaining({ route: 'user-probe', method: 'read' }) }),
        ]));
        expect(JSON.stringify(events)).not.toMatch(/synthetic-secret-token|TASK-REAL-123|private remote text|api\.clickup\.com|Authorization/);
    });

    test('background and popup wire session-only storage, controls, export, and clear', () => {
        const moduleSource = source('src/diagnostic-log.ts');
        const background = source('background.ts');
        const popup = source('popup/popup.ts');
        const html = source('popup/popup.html');

        expect(moduleSource).not.toMatch(/chrome\.storage\.local|chrome\.storage\.sync/);
        expect(background).toMatch(/new SafeDiagnosticLog\(chrome\.storage\.session\)/);
        expect(background).toMatch(/chrome\.storage\.session\.setAccessLevel\(\{ accessLevel: 'TRUSTED_CONTEXTS' \}\)/);
        expect(background).not.toMatch(/new SafeDiagnosticLog\(chrome\.storage\.local\)/);
        expect(background).toMatch(/case 'getDiagnosticStatus'/);
        expect(background).toMatch(/case 'setDiagnosticEnabled'/);
        expect(background).toMatch(/case 'exportDiagnostics'/);
        expect(background).toMatch(/case 'clearDiagnostics'/);
        expect(popup).toMatch(/action: 'setDiagnosticEnabled'/);
        expect(popup).toMatch(/action: 'exportDiagnostics'/);
        expect(popup).toMatch(/action: 'clearDiagnostics'/);
        expect(html).toMatch(/id="diagnosticToggle"/);
        expect(html).toMatch(/no guarda tokens, headers, URLs, IDs, nombres, emails, payloads ni contenido de Gmail o Meet/);
    });
});
