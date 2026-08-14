import { createMeetRoomKey, hasConfirmedMeetSession, resolveMeetPageContext } from './meet-room';
import { advanceMeetDetector, INITIAL_MEET_DETECTOR_STATE, type MeetDetectorState } from './meet-detector';

const POLL_MS = 1_000;
let detectorState: MeetDetectorState = { ...INITIAL_MEET_DETECTOR_STATE };
let featureEnabled = false;

async function evaluateMeetState(): Promise<void> {
    if (!featureEnabled) return;
    const page = resolveMeetPageContext(location.href);
    const roomKey = page.kind === 'candidate' ? await createMeetRoomKey(page.roomCode) : null;
    const result = advanceMeetDetector(detectorState, {
        roomKey,
        confirmedSignal: page.kind === 'candidate' && hasConfirmedMeetSession(document),
        visible: document.visibilityState === 'visible',
        now: Date.now(),
    });
    detectorState = result.state;
    for (const event of result.events) await notify(event.event, event.roomKey);
}

async function notify(event: 'candidate' | 'joined' | 'left' | 'heartbeat', roomKey: string): Promise<void> {
    await chrome.runtime.sendMessage({ action: 'meetSessionEvent', data: { event, roomKey } }).catch(() => undefined);
}

async function getConfirmedRoomKey(): Promise<string | null> {
    if (!featureEnabled) return null;
    const page = resolveMeetPageContext(location.href);
    if (page.kind !== 'candidate' || !hasConfirmedMeetSession(document)) return null;
    return await createMeetRoomKey(page.roomCode);
}

async function refreshMeetAuthority(): Promise<void> {
    const roomKey = await getConfirmedRoomKey();
    if (roomKey && document.visibilityState === 'visible') {
        await notify('joined', roomKey);
        return;
    }
    await evaluateMeetState();
}

void chrome.runtime.sendMessage({ action: 'getMeetDetectionEnabled' }).then((status) => {
    featureEnabled = status?.enabled === true;
    if (featureEnabled) void evaluateMeetState();
}).catch(() => undefined);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        detectorState = { ...detectorState, lastHeartbeatAt: null };
        void refreshMeetAuthority();
    }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.action === 'setMeetDetectionEnabled' && typeof message?.data?.enabled === 'boolean') {
        featureEnabled = message.data.enabled;
        detectorState = { ...INITIAL_MEET_DETECTOR_STATE };
        if (!featureEnabled) {
            sendResponse({ success: true });
            return false;
        }
        void evaluateMeetState().then(() => sendResponse({ success: true }));
        return true;
    }
    if (message?.action === 'refreshMeetAuthority') {
        void refreshMeetAuthority().then(() => sendResponse({ success: true }));
        return true;
    }
    if (message?.action === 'confirmMeetSession') {
        void getConfirmedRoomKey().then((roomKey) => sendResponse({ active: !!roomKey, roomKey }));
        return true;
    }
    return false;
});
window.addEventListener('pagehide', () => {
    if (detectorState.phase === 'joined' && detectorState.roomKey) {
        void notify('left', detectorState.roomKey);
    }
}, { once: true });
setInterval(() => void evaluateMeetState(), POLL_MS);
