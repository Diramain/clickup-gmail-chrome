const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { createHash, webcrypto } = require('crypto');
const { TextEncoder: NodeTextEncoder } = require('util');

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

const room = loadTsModule('src/meet/meet-room.ts');
const detector = loadTsModule('src/meet/meet-detector.ts');
const priority = loadTsModule('src/meet/meet-priority.ts');
const security = loadTsModule('src/message-security.ts');
const ROOM_KEY = 'a'.repeat(64);

describe('Google Meet minimal room identity', () => {
    test('home, malformed paths, and foreign origins never become room candidates', () => {
        expect(room.resolveMeetPageContext('https://meet.google.com/home')).toEqual({ kind: 'home' });
        expect(room.resolveMeetPageContext('https://meet.google.com/abc-def-hij')).toEqual({ kind: 'home' });
        expect(room.resolveMeetPageContext('https://example.test/abc-defg-hij')).toEqual({ kind: 'outside-meet' });
        expect(room.resolveMeetPageContext('not a url')).toEqual({ kind: 'outside-meet' });
    });

    test('valid room paths expose only the canonical room code to the local hasher', () => {
        expect(room.resolveMeetPageContext('https://meet.google.com/abc-defg-hij?authuser=7#private')).toEqual({
            kind: 'candidate',
            roomCode: 'abc-defg-hij',
        });
    });

    test('room keys use the versioned SHA-256 salt and reject invalid codes', async () => {
        const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        const encoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder');
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
        Object.defineProperty(globalThis, 'TextEncoder', { value: NodeTextEncoder, configurable: true });
        try {
            const key = await room.createMeetRoomKey('abc-defg-hij');
            const expected = createHash('sha256').update('cgc-meet-v1:abc-defg-hij').digest('hex');
            expect(key).toBe(expected);
            expect(key).toMatch(/^[a-f0-9]{64}$/);
            expect(key).not.toContain('abc-defg-hij');
            await expect(room.createMeetRoomKey('home')).resolves.toBeNull();
        } finally {
            if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
            else delete globalThis.crypto;
            if (encoderDescriptor) Object.defineProperty(globalThis, 'TextEncoder', encoderDescriptor);
            else delete globalThis.TextEncoder;
        }
    });

    test('synthetic joined signal requires the leave-call control and ignores prejoin controls', () => {
        document.body.innerHTML = '<button aria-label="Join now">Join</button>';
        expect(room.hasConfirmedMeetSession(document)).toBe(false);
        document.body.innerHTML = '<button data-tooltip="Leave call">Leave</button>';
        expect(room.hasConfirmedMeetSession(document)).toBe(true);
        document.body.innerHTML = '<button aria-label="Salir de la llamada">Salir</button>';
        expect(room.hasConfirmedMeetSession(document)).toBe(true);
        document.body.innerHTML = '<button aria-label="Leave call" hidden>Leave</button>';
        expect(room.hasConfirmedMeetSession(document)).toBe(false);
        document.body.innerHTML = '<button aria-label="Leave call" aria-disabled="true">Leave</button>';
        expect(room.hasConfirmedMeetSession(document)).toBe(false);
    });
});

describe('Meet detector transitions', () => {
    test('prejoin emits one candidate and never joins from URL alone', () => {
        const first = detector.advanceMeetDetector(detector.INITIAL_MEET_DETECTOR_STATE, {
            roomKey: ROOM_KEY,
            confirmedSignal: false,
            visible: true,
            now: 100,
        });
        expect(first.events).toEqual([{ event: 'candidate', roomKey: ROOM_KEY }]);
        expect(first.state.phase).toBe('candidate');

        const second = detector.advanceMeetDetector(first.state, {
            roomKey: ROOM_KEY,
            confirmedSignal: false,
            visible: true,
            now: 1_000,
        });
        expect(second.events).toEqual([]);
        expect(second.state.phase).toBe('candidate');
    });

    test('confirmed visible signal joins and emits bounded heartbeats', () => {
        const candidate = detector.advanceMeetDetector(detector.INITIAL_MEET_DETECTOR_STATE, {
            roomKey: ROOM_KEY, confirmedSignal: false, visible: true, now: 0,
        });
        const joined = detector.advanceMeetDetector(candidate.state, {
            roomKey: ROOM_KEY, confirmedSignal: true, visible: true, now: 100,
        });
        expect(joined.events).toEqual([{ event: 'joined', roomKey: ROOM_KEY }]);
        expect(joined.state.phase).toBe('joined');

        const early = detector.advanceMeetDetector(joined.state, {
            roomKey: ROOM_KEY, confirmedSignal: true, visible: true, now: 10_000,
        });
        expect(early.events).toEqual([]);
        const heartbeat = detector.advanceMeetDetector(early.state, {
            roomKey: ROOM_KEY, confirmedSignal: true, visible: true, now: 15_100,
        });
        expect(heartbeat.events).toEqual([{ event: 'heartbeat', roomKey: ROOM_KEY }]);
    });

    test('transient signal loss is debounced and a hidden tab remains live only while its signal exists', () => {
        const joined = {
            phase: 'joined', roomKey: ROOM_KEY, missingSignalSince: null, lastHeartbeatAt: 100,
        };
        const hidden = detector.advanceMeetDetector(joined, {
            roomKey: ROOM_KEY, confirmedSignal: true, visible: false, now: 1_000,
        });
        expect(hidden.state.phase).toBe('joined');
        expect(hidden.events).toEqual([]);

        const missing = detector.advanceMeetDetector(hidden.state, {
            roomKey: ROOM_KEY, confirmedSignal: false, visible: true, now: 2_000,
        });
        expect(missing.events).toEqual([]);
        const stillDebouncing = detector.advanceMeetDetector(missing.state, {
            roomKey: ROOM_KEY, confirmedSignal: false, visible: true, now: 5_999,
        });
        expect(stillDebouncing.events).toEqual([]);
        const left = detector.advanceMeetDetector(stillDebouncing.state, {
            roomKey: ROOM_KEY, confirmedSignal: false, visible: true, now: 6_000,
        });
        expect(left.events).toEqual([{ event: 'left', roomKey: ROOM_KEY }]);
        expect(left.state.phase).toBe('candidate');
    });

    test('navigation away from the room ends a joined session immediately', () => {
        const joined = {
            phase: 'joined', roomKey: ROOM_KEY, missingSignalSince: null, lastHeartbeatAt: 100,
        };
        const result = detector.advanceMeetDetector(joined, {
            roomKey: null, confirmedSignal: false, visible: true, now: 200,
        });
        expect(result.events).toEqual([{ event: 'left', roomKey: ROOM_KEY }]);
        expect(result.state).toEqual(detector.INITIAL_MEET_DETECTOR_STATE);
    });
});

describe('Meet mappings and single-session authority', () => {
    const mapping = {
        roomKey: ROOM_KEY,
        taskId: 'task-1',
        teamId: 'team-1',
        createdAt: 10,
        lastUsedAt: 20,
        enabled: true,
    };

    test('mapping store is closed and strips URL/title/content fields', () => {
        const store = priority.sanitizeMeetMappingStore({
            schemaVersion: 999,
            mappings: {
                [ROOM_KEY]: { ...mapping, url: 'https://meet.google.com/private', title: 'Private Daily', participants: ['x'] },
                invalid: { ...mapping, roomKey: 'invalid' },
            },
        });
        expect(store).toEqual({ schemaVersion: 1, mappings: { [ROOM_KEY]: mapping } });
        expect(JSON.stringify(store)).not.toMatch(/meet\.google|Private Daily|participants/);
        expect(priority.selectMeetMapping(store, ROOM_KEY)).toEqual(mapping);
        store.mappings[ROOM_KEY].enabled = false;
        expect(priority.selectMeetMapping(store, ROOM_KEY)).toBeNull();
    });

    test('persisted session is validated and rebuilt without unknown fields', () => {
        const session = priority.sanitizeMeetPrioritySession({
            roomKey: ROOM_KEY,
            tabId: 1,
            windowId: 2,
            status: 'tracking',
            taskId: 'task-1',
            teamId: 'team-1',
            startedAt: 10,
            joinedAt: 10,
            lastSeenAt: 20,
            url: 'https://meet.google.com/private',
            title: 'Private Daily',
        });
        expect(session).not.toHaveProperty('url');
        expect(session).not.toHaveProperty('title');
        expect(priority.sanitizeMeetPrioritySession({ ...session, roomKey: 'bad' })).toBeNull();
        expect(priority.sanitizeMeetPrioritySession({ ...session, status: 'tracking', taskId: undefined })).toBeNull();
    });

    test('same tab continues while only the focused incoming Meet can replace authority', () => {
        const current = {
            roomKey: ROOM_KEY,
            tabId: 1,
            windowId: 2,
            status: 'tracking',
            joinedAt: 10,
            lastSeenAt: 20,
        };
        expect(priority.decideMeetJoinAuthority(current, { roomKey: ROOM_KEY, tabId: 1, windowId: 2 }, null)).toBe('continue');
        expect(priority.decideMeetJoinAuthority(current, { roomKey: 'b'.repeat(64), tabId: 3, windowId: 4 }, { tabId: 1, windowId: 2 })).toBe('conflict');
        expect(priority.decideMeetJoinAuthority(current, { roomKey: 'b'.repeat(64), tabId: 3, windowId: 4 }, { tabId: 3, windowId: 4 })).toBe('replace');
        expect(priority.decideMeetJoinAuthority(null, { roomKey: ROOM_KEY, tabId: 1, windowId: 2 }, { tabId: 1, windowId: 2 })).toBe('accept');
    });
});

describe('Meet privacy, message, manifest, and release guardrails', () => {
    const runtimeId = 'ext-id';
    const meetSender = { id: runtimeId, url: 'https://meet.google.com/abc-defg-hij', tab: { id: 1, windowId: 2 } };
    const popupSender = { id: runtimeId, url: 'chrome-extension://ext-id/popup/popup.html' };

    test('Meet origin can send only closed room-key events and read the feature flag', () => {
        expect(security.validateExtensionMessage({ action: 'meetSessionEvent', data: { event: 'joined', roomKey: ROOM_KEY } }, meetSender, runtimeId).ok).toBe(true);
        expect(security.validateExtensionMessage({ action: 'getMeetDetectionEnabled' }, meetSender, runtimeId).ok).toBe(true);
        expect(security.validateExtensionMessage({ action: 'getEmailTaskMappings' }, meetSender, runtimeId).ok).toBe(false);
        expect(security.validateExtensionMessage({ action: 'getDefaultListConfig' }, meetSender, runtimeId).ok).toBe(false);
        expect(security.validateExtensionMessage({ action: 'meetSessionEvent', data: { event: 'joined', roomKey: ROOM_KEY, title: 'Daily' } }, meetSender, runtimeId).ok).toBe(false);
        expect(security.validateExtensionMessage({ action: 'meetSessionEvent', data: { event: 'joined', roomKey: ROOM_KEY }, url: 'https://meet.google.com/private' }, meetSender, runtimeId).ok).toBe(false);
        expect(security.validateExtensionMessage({ action: 'meetSessionEvent', data: { event: 'joined', roomCode: 'abc-defg-hij' } }, meetSender, runtimeId).ok).toBe(false);
        expect(security.validateExtensionMessage({ action: 'assignMeetTask', data: { taskId: 'task-1', teamId: 'team-1', remember: false } }, meetSender, runtimeId).ok).toBe(false);
    });

    test('popup Meet management schemas are bounded and fail closed', () => {
        const valid = (message) => security.validateExtensionMessage(message, popupSender, runtimeId).ok;
        expect(valid({ action: 'setMeetPriorityEnabled', data: { enabled: true } })).toBe(true);
        expect(valid({ action: 'assignMeetTask', data: { taskId: 'task-1', teamId: 'team-1', remember: true } })).toBe(true);
        expect(valid({ action: 'deleteMeetMapping', data: { roomKey: ROOM_KEY } })).toBe(true);
        expect(valid({ action: 'setMeetMappingEnabled', data: { roomKey: ROOM_KEY, enabled: false } })).toBe(true);
        expect(valid({ action: 'ignoreMeetSession' })).toBe(true);
        expect(valid({ action: 'deleteMeetMapping', data: { roomKey: 'abc-defg-hij' } })).toBe(false);
        expect(valid({ action: 'assignMeetTask', data: { taskId: 'task-1', teamId: 'team-1', remember: true, title: 'Daily' } })).toBe(false);
    });

    test('manifest adds only exact Meet access and explicitly blocks incognito/capture permissions', () => {
        const manifest = JSON.parse(source('manifest.json'));
        expect(manifest.version).toBe('1.2.3');
        expect(manifest.minimum_chrome_version).toBe('102');
        expect(manifest.incognito).toBe('not_allowed');
        expect(manifest.host_permissions).toContain('https://meet.google.com/*');
        expect(manifest.host_permissions).not.toContain('<all_urls>');
        expect(manifest.permissions).not.toEqual(expect.arrayContaining([
            'audioCapture', 'videoCapture', 'desktopCapture', 'tabCapture', 'history', 'notifications', 'idle',
        ]));
        const meetScript = manifest.content_scripts.find((entry) => entry.matches.includes('https://meet.google.com/*'));
        expect(meetScript).toEqual(expect.objectContaining({
            matches: ['https://meet.google.com/*'],
            js: ['src/meet/meet-tracker.js'],
            run_at: 'document_idle',
        }));
    });

    test('runtime content script and popup do not retain or render meeting content', () => {
        const tracker = source('src/meet/meet-tracker.ts');
        const popup = source('popup/popup.ts');
        const exportSource = source('src/data-management.ts');
        expect(tracker).not.toMatch(/innerHTML|textContent|caption|participant|MediaStream|getUserMedia|audio|video|chat/i);
        expect(tracker).toMatch(/data: \{ event, roomKey \}/);
        expect(popup).not.toMatch(/`[^`]*\$\{mapping\.roomKey\}/);
        expect(exportSource).not.toMatch(/meetTaskMappings|roomKey/);
    });

    test('content scripts cannot read local extension storage directly', () => {
        const background = source('background.ts');
        expect(background).toMatch(/storage\.local\.setAccessLevel\(\{ accessLevel: 'TRUSTED_CONTEXTS' \}\)/);
        ['src/meet/meet-tracker.ts', 'src/gmail-native.ts', 'src/modal.ts', 'src/clickup-tracker.ts'].forEach((file) => {
            expect(source(file)).not.toMatch(/chrome\.storage\.local/);
        });
        const gmailSender = { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' };
        expect(security.validateExtensionMessage({ action: 'getEmailTaskMappings' }, gmailSender, runtimeId).ok).toBe(true);
        expect(security.validateExtensionMessage({ action: 'getDefaultListConfig' }, gmailSender, runtimeId).ok).toBe(true);
    });

    test('background serializes Meet writes and verifies the live session after stop before start', () => {
        const background = source('background.ts');
        expect(background).toMatch(/case 'meetSessionEvent':\s*return await runTimerWrite/);
        expect(background).toMatch(/if \(runningTaskId && runningTaskId !== taskId\) await clickupAPI!\.stopTimer\(teamId\);\s*if \(!await isSameMeetSessionAlive\(expectedSession\)\)/);
        expect(background).toMatch(/await isMeetSessionTabAlive\(meetPrioritySession\)\s*&& await hasConfirmedMeetSignal\(expected\)/);
        expect(background).toMatch(/requestMeetAuthorityRefresh\(activeInfo\.tabId\)/);
        expect(background).toMatch(/requestMeetAuthorityRefreshForWindow\(windowId\)/);
        expect(background).toMatch(/if \(startedMeetTimer\)[\s\S]{0,220}clickupAPI!\.stopTimer\(teamId\)/);
        expect(background).toMatch(/MEET_MAX_DURATION_MS = 4 \* 60 \* 60 \* 1000/);
        expect(background).toMatch(/if \(meetPrioritySession && \['awaiting-task', 'tracking', 'paused'\]\.includes\(meetPrioritySession\.status\)\) return/);
        expect(background).toMatch(/MEET_MAPPINGS_KEY/);
        expect(background).toMatch(/async function stopCurrentTimerForUnassignedMeet\(\)[\s\S]{0,350}getRunningTimer[\s\S]{0,150}stopTimer/);
        expect(background).not.toMatch(/async function stopCurrentTimerForUnassignedMeet\(\)[\s\S]{0,180}autoStopTimer/);
        expect(background).toMatch(/\['manual', 'logout'\]\.includes\(_reason\)[\s\S]{0,120}persistManualStopSuppression/);
        expect(source('scripts/release-allowlist.js')).toContain("'src/meet/meet-tracker.js'");
        const tracker = source('src/meet/meet-tracker.ts');
        expect(tracker).toMatch(/message\?\.action === 'refreshMeetAuthority'/);
        expect(tracker).toMatch(/message\?\.action === 'confirmMeetSession'/);
    });
});
