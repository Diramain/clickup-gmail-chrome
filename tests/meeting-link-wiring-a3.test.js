const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath, cache = new Map()) {
    const normalized = path.normalize(relativePath);
    if (cache.has(normalized)) return cache.get(normalized).exports;
    const filename = path.join(__dirname, '..', normalized);
    const compiled = ts.transpileModule(source(normalized), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    cache.set(normalized, module);
    const localRequire = (request) => {
        if (!request.startsWith('.')) return require(request);
        const withoutExtension = request.endsWith('.ts') ? request.slice(0, -3) : request;
        return loadTsModule(`${path.join(path.dirname(normalized), withoutExtension)}.ts`, cache);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

const UUID = '12345678-1234-4234-9234-123456789abc';
const HASH = 'b'.repeat(64);
const WRITE_ACTIONS = ['previewMeetingLink', 'beginMeetingLinkCreate', 'resumeMeetingOperation', 'repairMeetingOperation'];
const ALL_C12_ACTIONS = ['getMeetingLinkUiState', ...WRITE_ACTIONS];

describe('CGC-C12 CODE A3 inert meeting link controller', () => {
    const controllerModule = loadTsModule('src/meeting-link/meeting-link.controller.ts');

    function makeController(flagValue) {
        const calls = [];
        const storage = {
            async get(key) {
                calls.push(`get:${key}`);
                return { [key]: flagValue };
            },
            async set() { calls.push('set'); },
            async remove() { calls.push('remove'); },
        };
        return { controller: new controllerModule.MeetingLinkController(storage), calls };
    }

    function makeRejectingController() {
        const calls = [];
        const storage = {
            async get(key) {
                calls.push(`get:${key}`);
                throw new Error('STORAGE_UNAVAILABLE');
            },
            async set() { calls.push('set'); },
            async remove() { calls.push('remove'); },
        };
        return { controller: new controllerModule.MeetingLinkController(storage), calls };
    }

    test('compiled runtime capability is false and cannot be bypassed by undefined, corrupt, false, or true flags', async () => {
        expect(controllerModule.MEETING_RUNTIME_CAPABILITY_ENABLED).toBe(false);
        const allTrueFlags = {
            schemaVersion: 1,
            calendarIntegrationEnabled: true,
            calendarWriteEnabled: true,
            meetAutoArtifactsEnabled: true,
            meetingRecurrenceEnabled: true,
        };

        for (const flags of [undefined, 'corrupt', { calendarIntegrationEnabled: false }, allTrueFlags]) {
            const { controller, calls } = makeController(flags);
            await expect(controller.getUiState()).resolves.toEqual({
                ok: true,
                status: 'disabled',
                canCreate: false,
                integrationBlocked: true,
                runtimeCapabilityEnabled: false,
            });
            await expect(controller.handleWriteAction('beginMeetingLinkCreate')).resolves.toEqual({
                ok: false,
                code: 'FEATURE_DISABLED',
                runtimeCapabilityEnabled: false,
            });
            expect(calls).toEqual(['get:meetingFeatureFlagsV1']);
            expect(calls).not.toContain('set');
            expect(calls).not.toContain('remove');
        }
    });

    test('getUiState fails closed when storage rejects and write actions do not read storage', async () => {
        const { controller, calls } = makeRejectingController();

        await expect(controller.getUiState()).resolves.toEqual({
            ok: true,
            status: 'disabled',
            canCreate: false,
            integrationBlocked: true,
            runtimeCapabilityEnabled: false,
        });
        await expect(controller.handleWriteAction('previewMeetingLink')).resolves.toEqual({ ok: false, code: 'FEATURE_DISABLED', runtimeCapabilityEnabled: false });
        expect(calls).toEqual(['get:meetingFeatureFlagsV1']);
    });

    test('write actions never echo ids, hashes, read storage, or expose provider contract', async () => {
        const { controller, calls } = makeController({
            schemaVersion: 1,
            calendarIntegrationEnabled: true,
            calendarWriteEnabled: true,
            meetAutoArtifactsEnabled: true,
            meetingRecurrenceEnabled: true,
        });

        for (const action of WRITE_ACTIONS) {
            const response = await controller.handleWriteAction(action);
            expect(response).toEqual({ ok: false, code: 'FEATURE_DISABLED', runtimeCapabilityEnabled: false });
            expect(JSON.stringify(response)).not.toMatch(new RegExp(`${UUID}|${HASH}`));
        }
        expect(calls).toEqual([]);
        expect(source('src/meeting-link/meeting-link.controller.ts')).not.toMatch(/providers|calendar\?|clickup\?|meet\?|RuntimeProviders/);
    });
});

describe('CGC-C12 CODE A3 message security and background delegation', () => {
    const security = loadTsModule('src/message-security.ts');

    test('only extension pages may use the five C12 actions', () => {
        for (const action of ALL_C12_ACTIONS) {
            expect(security.isAllowedOriginForAction(action, 'chrome-extension://mock-id/popup/popup.html')).toBe(true);
            expect(security.isAllowedOriginForAction(action, 'https://mail.google.com/mail/u/0/')).toBe(false);
            expect(security.isAllowedOriginForAction(action, 'https://app.clickup.com/t/abc123')).toBe(false);
            expect(security.isAllowedOriginForAction(action, 'https://meet.google.com/abc-defg-hij')).toBe(false);
        }
    });

    test('five C12 actions are schema-closed and reject extra fields or invalid payloads', () => {
        expect(security.hasValidSchema({ action: 'getMeetingLinkUiState' })).toBe(true);
        expect(security.hasValidSchema({ action: 'getMeetingLinkUiState', data: {} })).toBe(false);
        expect(security.hasValidSchema({ action: 'previewMeetingLink', data: { clientRequestId: UUID, payloadHash: HASH } })).toBe(true);
        expect(security.hasValidSchema({ action: 'previewMeetingLink', data: { clientRequestId: UUID, payloadHash: HASH, title: 'private' } })).toBe(false);
        expect(security.hasValidSchema({ action: 'beginMeetingLinkCreate', data: { clientRequestId: UUID, cgcLinkId: UUID, payloadHash: HASH, calendarId: 'cal_1', workspaceId: 'team_1', listId: 'list_1', customItemId: 1 } })).toBe(true);
        expect(security.hasValidSchema({ action: 'resumeMeetingOperation', data: { cgcLinkId: UUID } })).toBe(true);
        expect(security.hasValidSchema({ action: 'repairMeetingOperation', data: { cgcLinkId: UUID } })).toBe(true);
        expect(security.hasValidSchema({ action: 'repairMeetingOperation', data: { cgcLinkId: 'bad' } })).toBe(false);
    });

    test('background has minimal controller delegation and no C12 provider/API path', () => {
        const background = source('background.ts');
        expect(background).toMatch(/new MeetingLinkController\(\{[\s\S]{0,180}chrome\.storage\.local\.get\(key\)[\s\S]{0,80}\}\)/);
        expect(background).toMatch(/case 'getMeetingLinkUiState':[\s\S]{0,80}meetingLinkController\.getUiState\(\)/);
        for (const action of WRITE_ACTIONS) {
            expect(background).toMatch(new RegExp(`case '${action}':`));
        }
        expect(background).toMatch(/meetingLinkController\.handleWriteAction\(action as MeetingLinkWriteAction\)/);
        const c12Block = background.slice(background.indexOf("case 'getMeetingLinkUiState':"), background.indexOf("case 'preloadFullHierarchy':"));
        expect(c12Block).not.toMatch(/fetch|chrome\.identity|ensureAPI|clickupAPI|Calendar|saga/);
    });
});

describe('CGC-C12 CODE A3 popup remains hidden and fail-closed', () => {
    const popupUi = loadTsModule('src/meeting-link/meeting-link-popup-ui.ts');

    function makeSection() {
        const added = [];
        const section = {
            hidden: false,
            children: ['stale-control'],
            classList: { add: (className) => added.push(className) },
            replaceChildren() { section.children = []; },
        };
        return { section, added };
    }

    test('HTML ships hidden with no controls, focus targets, or aria-live in the C12 section', () => {
        document.body.innerHTML = source('popup/popup.html');
        const section = document.getElementById('meetingLinkSection');
        expect(section).not.toBeNull();
        expect(section.hidden).toBe(true);
        expect(section.classList.contains('hidden')).toBe(true);
        expect(section.querySelector('button,input,select,textarea,a,[tabindex], [aria-live]')).toBeNull();
    });

    test('popup helper keeps section hidden and empty for invalid response, rejection, and timeout', async () => {
        const invalid = makeSection();
        await popupUi.initMeetingLinkSectionFailClosed(invalid.section, async () => ({ ok: true, status: 'disabled', canCreate: false, integrationBlocked: true, runtimeCapabilityEnabled: false, featureFlags: {} }));
        expect(invalid.section.hidden).toBe(true);
        expect(invalid.section.children).toEqual([]);
        expect(invalid.added).toContain('hidden');

        const rejected = makeSection();
        await popupUi.initMeetingLinkSectionFailClosed(rejected.section, async () => { throw new Error('MESSAGE_FAILED'); });
        expect(rejected.section.hidden).toBe(true);
        expect(rejected.section.children).toEqual([]);

        jest.useFakeTimers();
        const timedOut = makeSection();
        const pending = popupUi.initMeetingLinkSectionFailClosed(timedOut.section, () => new Promise(() => undefined), 5);
        await Promise.resolve();
        jest.advanceTimersByTime(5);
        await pending;
        expect(timedOut.section.hidden).toBe(true);
        expect(timedOut.section.children).toEqual([]);
        jest.useRealTimers();
    });

    test('popup only queries state and never sends C12 writes', () => {
        const popup = source('popup/popup.ts');
        expect(popup).toMatch(/sendMessage<MeetingLinkUiState>\(\{ action: 'getMeetingLinkUiState' \}\)/);
        expect(popup).toMatch(/initMeetingLinkSectionFailClosed\(/);
        for (const action of WRITE_ACTIONS) {
            expect(popup).not.toMatch(new RegExp(`sendMessage[\\s\\S]{0,80}${action}`));
        }
    });
});
