import { assertNoRawTraceSecrets, CAUSAL_TRACE_PORT_NAME, normalizeCausalTraceEvent, type SafeCausalTraceEvent } from '../src/causal-trace';
import { JsonlBatchWriter, TRACE_FILE_LIMIT_BYTES, type TraceWriterStopReason } from '../src/trace-writer';

type SavePickerWindow = Window & { showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle> };

const startButton = document.getElementById('startRecorder') as HTMLButtonElement;
const stopButton = document.getElementById('stopRecorder') as HTMLButtonElement;
const state = document.getElementById('state') as HTMLElement;
const eventCount = document.getElementById('eventCount') as HTMLElement;
const byteCount = document.getElementById('byteCount') as HTMLElement;
const queueCount = document.getElementById('queueCount') as HTMLElement;
const scheduledStop = document.getElementById('scheduledStop') as HTMLElement;
const message = document.getElementById('message') as HTMLElement;

let writer: JsonlBatchWriter | null = null;
let port: chrome.runtime.Port | null = null;
let events = 0;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let intentionalStop = false;

startButton.addEventListener('click', () => { void start(); });
stopButton.addEventListener('click', () => { void stop('manual-stop'); });
window.addEventListener('pagehide', () => { void stop('page-close'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void writer?.flush(); });
document.addEventListener('freeze', () => { void writer?.flush(); });

async function start(): Promise<void> {
    if (writer) return;
    const pickerWindow = window as SavePickerWindow;
    if (!pickerWindow.showSaveFilePicker) {
        renderMessage('File System Access no está disponible en este navegador.', true);
        return;
    }
    startButton.disabled = true;
    try {
        const handle = await pickerWindow.showSaveFilePicker({
            suggestedName: `cgc-main-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
            types: [{ description: 'JSON Lines', accept: { 'application/jsonl': ['.jsonl'] } }],
        });
        writer = new JsonlBatchWriter(handle, {
            onStop: (reason, status) => renderMessage(`Captura detenida: ${reason}. No escritos: ${status.unwrittenEvents}.`, reason !== 'manual-stop' && reason !== 'scheduled-stop'),
        });
        await writer.initialize();
        events = 0;
        intentionalStop = false;
        connectPort(false);
        scheduleStopAt1800();
        stopButton.disabled = false;
        renderState('armado');
        renderMessage('Captura iniciada. Cada flush cierra el archivo.', false);
    } catch (error) {
        writer = null;
        startButton.disabled = false;
        renderMessage(isPermissionError(error) ? 'Permiso cancelado o revocado.' : 'No se pudo iniciar la captura.', true);
    }
}

function handlePortMessage(payload: unknown): void {
    if (!writer || !payload || typeof payload !== 'object') return;
    const event = normalizeCausalTraceEvent((payload as { event?: unknown }).event, 'extension-main');
    if (!event || !assertNoRawTraceSecrets(JSON.stringify(event))) {
        void stop('writer-error');
        return;
    }
    reconnectAttempts = 0;
    const ok = writer.enqueue(event satisfies SafeCausalTraceEvent);
    if (!ok) {
        void stop(writer.status.reason || 'writer-error');
        return;
    }
    events += 1;
    renderState('grabando');
}

async function stop(reason: TraceWriterStopReason): Promise<void> {
    intentionalStop = true;
    if (scheduleTimer) {
        clearTimeout(scheduleTimer);
        scheduleTimer = null;
    }
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    const currentWriter = writer;
    writer = null;
    if (port) {
        try { port.disconnect(); } catch { /* closed */ }
        port = null;
    }
    if (currentWriter) await currentWriter.stop(reason);
    startButton.disabled = false;
    stopButton.disabled = true;
    renderState(`detenido: ${reason}`);
}

function connectPort(isReconnect: boolean): void {
    if (!writer || intentionalStop) return;
    try {
        port = chrome.runtime.connect({ name: CAUSAL_TRACE_PORT_NAME });
        port.onMessage.addListener(handlePortMessage);
        port.onDisconnect.addListener(() => {
            port = null;
            if (!writer || intentionalStop) return;
            scheduleReconnect();
        });
        if (isReconnect) renderMessage('Recorder reconectado; el siguiente evento del service worker marca un nuevo capture boundary.', false);
    } catch {
        scheduleReconnect();
    }
}

function scheduleReconnect(): void {
    if (!writer || intentionalStop || reconnectTimer) return;
    if (reconnectAttempts >= 5) {
        renderMessage('No se pudo reconectar al service worker después de 5 intentos.', true);
        void stop('writer-error');
        return;
    }
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectPort(true);
    }, Math.min(1000 * reconnectAttempts, 5000));
}

function scheduleStopAt1800(): void {
    const now = new Date();
    const target = new Date(now);
    target.setHours(18, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
        scheduledStop.textContent = '18:00 ya pasó hoy; usá stop manual';
        return;
    }
    const ms = target.getTime() - now.getTime();
    scheduleTimer = setTimeout(() => { void stop('scheduled-stop'); }, ms);
    scheduledStop.textContent = target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderState(label: string): void {
    const status = writer?.status;
    state.textContent = label;
    eventCount.textContent = String(events);
    byteCount.textContent = String(status?.bytesWritten ?? 0);
    queueCount.textContent = String(status?.queued ?? 0);
    if ((status?.bytesWritten ?? 0) >= TRACE_FILE_LIMIT_BYTES) renderMessage('Límite de 2 GiB alcanzado; captura cerrada.', true);
}

function renderMessage(text: string, isError: boolean): void {
    message.textContent = text;
    message.style.color = isError ? '#f87171' : '#67e8f9';
}

function isPermissionError(error: unknown): boolean {
    const name = typeof (error as { name?: unknown } | null)?.name === 'string' ? String((error as { name?: unknown }).name) : '';
    return /permission|security|notallowed|abort/i.test(name);
}
