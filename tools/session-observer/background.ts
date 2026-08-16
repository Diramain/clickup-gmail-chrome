import { CAUSAL_TRACE_PORT_NAME, CausalTraceSanitizer, createCaptureRef, type CausalTraceInput } from '../../src/causal-trace';

const ports = new Map<chrome.runtime.Port, CausalTraceSanitizer>();

function emit(input: CausalTraceInput): void {
    for (const [port, sanitizer] of [...ports.entries()]) {
        try { port.postMessage({ type: 'cgc-causal-trace-event', event: sanitizer.event(input) }); }
        catch { ports.delete(port); }
    }
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== CAUSAL_TRACE_PORT_NAME) return;
    const sanitizer = new CausalTraceSanitizer('session-observer', createCaptureRef('sidecar'));
    ports.set(port, sanitizer);
    try { port.postMessage({ type: 'cgc-causal-trace-event', event: sanitizer.event({ event: 'capture', action: 'recording-started', outcome: 'armed' }) }); }
    catch { ports.delete(port); return; }
    port.onDisconnect.addListener(() => { ports.delete(port); });
});

chrome.action.onClicked.addListener(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('recorder.html') });
});

chrome.tabs.onCreated.addListener((tab) => {
    emit({ event: 'listener', action: 'tab-created', outcome: 'received', rawUrl: tab.url, tabId: tab.id, windowId: tab.windowId });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url && changeInfo.status !== 'complete') return;
    emit({ event: 'listener', action: 'tab-updated', outcome: 'received', rawUrl: changeInfo.url || tab.url, tabId, windowId: tab.windowId });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    emit({ event: 'listener', action: 'tab-activated', outcome: 'received', tabId: activeInfo.tabId, windowId: activeInfo.windowId });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    emit({ event: 'listener', action: 'tab-removed', outcome: 'received', tabId });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    emit({ event: 'listener', action: 'window-focus', outcome: 'received', windowId });
});

chrome.windows.onRemoved.addListener((windowId) => {
    emit({ event: 'listener', action: 'window-removed', outcome: 'received', windowId });
});
