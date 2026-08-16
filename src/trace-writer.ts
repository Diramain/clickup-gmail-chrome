export const TRACE_FILE_LIMIT_BYTES = 2_147_483_648;
export const TRACE_MAX_QUEUE_EVENTS = 4096;
export const TRACE_DEFAULT_BATCH_SIZE = 50;

export type TraceWriterStopReason = 'manual-stop' | 'scheduled-stop' | 'page-close' | 'writer-limit' | 'writer-overflow' | 'writer-error' | 'permission-error';

export interface TraceWritable {
    seek(position: number): Promise<void> | void;
    truncate?(size: number): Promise<void> | void;
    write(data: Blob | string): Promise<void> | void;
    close(): Promise<void> | void;
}

export interface TraceFileHandle {
    createWritable(options?: { keepExistingData?: boolean }): Promise<TraceWritable>;
}

export interface TraceWriterStatus {
    stopped: boolean;
    reason: TraceWriterStopReason | null;
    bytesWritten: number;
    pendingBytes: number;
    queued: number;
    acceptedEvents: number;
    rejectedEvents: number;
    unwrittenEvents: number;
    inFlight: boolean;
}

export interface JsonlBatchWriterOptions {
    limitBytes?: number;
    maxQueueEvents?: number;
    batchSize?: number;
    flushDelayMs?: number;
    encoder?: TextEncoder;
    setTimeoutFn?: typeof setTimeout;
    clearTimeoutFn?: typeof clearTimeout;
    onStop?: (reason: TraceWriterStopReason, status: TraceWriterStatus) => void;
}

export class JsonlBatchWriter {
    private readonly limitBytes: number;
    private readonly maxQueueEvents: number;
    private readonly batchSize: number;
    private readonly flushDelayMs: number;
    private readonly encoder: TextEncoder;
    private readonly setTimeoutFn: typeof setTimeout;
    private readonly clearTimeoutFn: typeof clearTimeout;
    private readonly queue: Array<{ line: string; size: number }> = [];
    private bytesWritten = 0;
    private pendingByteCount = 0;
    private acceptedEvents = 0;
    private rejectedEvents = 0;
    private stopped = false;
    private stopReason: TraceWriterStopReason | null = null;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private flushQueue: Promise<void> = Promise.resolve();
    private stopPromise: Promise<void> | null = null;
    private initialized = false;
    private inFlight = false;
    private stopNotified = false;

    constructor(
        private readonly handle: TraceFileHandle,
        private readonly options: JsonlBatchWriterOptions = {},
    ) {
        this.limitBytes = options.limitBytes ?? TRACE_FILE_LIMIT_BYTES;
        this.maxQueueEvents = options.maxQueueEvents ?? TRACE_MAX_QUEUE_EVENTS;
        this.batchSize = options.batchSize ?? TRACE_DEFAULT_BATCH_SIZE;
        this.flushDelayMs = options.flushDelayMs ?? 500;
        this.encoder = options.encoder ?? new TextEncoder();
        this.setTimeoutFn = options.setTimeoutFn ?? globalThis.setTimeout.bind(globalThis);
        this.clearTimeoutFn = options.clearTimeoutFn ?? globalThis.clearTimeout.bind(globalThis);
    }

    get status(): TraceWriterStatus {
        return {
            stopped: this.stopped,
            reason: this.stopReason,
            bytesWritten: this.bytesWritten,
            pendingBytes: this.pendingByteCount,
            queued: this.queue.length,
            acceptedEvents: this.acceptedEvents,
            rejectedEvents: this.rejectedEvents,
            unwrittenEvents: this.queue.length,
            inFlight: this.inFlight,
        };
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        let writable: TraceWritable | null = null;
        try {
            writable = await this.handle.createWritable({ keepExistingData: false });
            if (writable.truncate) await writable.truncate(0);
            await writable.close();
            writable = null;
            this.bytesWritten = 0;
            this.initialized = true;
        } catch (error) {
            this.failClosed(isPermissionError(error) ? 'permission-error' : 'writer-error');
            throw error;
        } finally {
            if (writable) await Promise.resolve(writable.close()).catch(() => undefined);
        }
    }

    enqueue(event: unknown): boolean {
        if (this.stopped) {
            this.rejectedEvents += 1;
            return false;
        }
        const line = `${JSON.stringify(event)}\n`;
        const size = this.encoder.encode(line).byteLength;
        if (this.bytesWritten + this.pendingByteCount + size > this.limitBytes) {
            this.rejectedEvents += 1;
            void this.stop('writer-limit');
            return false;
        }
        if (this.queue.length >= this.maxQueueEvents) {
            this.rejectedEvents += 1;
            void this.stop('writer-overflow');
            return false;
        }
        this.queue.push({ line, size });
        this.pendingByteCount += size;
        this.acceptedEvents += 1;
        if (this.queue.length >= this.batchSize) void this.flush().catch(() => undefined);
        else this.scheduleFlush();
        return true;
    }

    async flush(): Promise<void> {
        this.cancelTimer();
        this.flushQueue = this.flushQueue.then(() => this.flushAll(), () => this.flushAll());
        return this.flushQueue;
    }

    stop(reason: TraceWriterStopReason = 'manual-stop'): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        this.stopped = true;
        this.stopReason = reason;
        this.cancelTimer();
        this.stopPromise = (async () => {
            await this.flush();
            this.notifyStopOnce(reason);
        })();
        return this.stopPromise;
    }

    private scheduleFlush(): void {
        if (this.flushTimer || this.stopped) return;
        const setTimeoutFn = this.setTimeoutFn;
        this.flushTimer = setTimeoutFn(() => {
            this.flushTimer = null;
            void this.flush().catch(() => undefined);
        }, this.flushDelayMs);
    }

    private cancelTimer(): void {
        if (!this.flushTimer) return;
        const clearTimeoutFn = this.clearTimeoutFn;
        clearTimeoutFn(this.flushTimer);
        this.flushTimer = null;
    }

    private async flushAll(): Promise<void> {
        if (this.queue.length === 0) return;
        if (!this.initialized) {
            try { await this.initialize(); } catch { return; }
        }
        while (this.queue.length > 0) {
            const drained = await this.flushOneBatch();
            if (!drained) break;
        }
    }

    private async flushOneBatch(): Promise<boolean> {
        const batch = this.queue.splice(0, this.batchSize);
        const size = batch.reduce((total, item) => total + item.size, 0);
        const chunk = batch.map(item => item.line).join('');
        this.pendingByteCount -= size;
        if (this.bytesWritten + size > this.limitBytes) {
            this.queue.unshift(...batch);
            this.pendingByteCount += size;
            this.failClosed('writer-limit');
            return false;
        }

        let writable: TraceWritable | null = null;
        this.inFlight = true;
        try {
            writable = await this.handle.createWritable({ keepExistingData: true });
            await writable.seek(this.bytesWritten);
            await writable.write(chunk);
            await writable.close();
            writable = null;
            this.bytesWritten += size;
            return true;
        } catch (error) {
            this.queue.unshift(...batch);
            this.pendingByteCount += size;
            this.failClosed(isPermissionError(error) ? 'permission-error' : 'writer-error');
            return false;
        } finally {
            this.inFlight = false;
            if (writable) await Promise.resolve(writable.close()).catch(() => undefined);
        }
    }

    private failClosed(reason: TraceWriterStopReason): void {
        this.stopped = true;
        this.stopReason = reason;
        this.cancelTimer();
        this.notifyStopOnce(reason);
    }

    private notifyStopOnce(reason: TraceWriterStopReason): void {
        if (this.stopNotified) return;
        this.stopNotified = true;
        this.options.onStop?.(reason, this.status);
    }
}

function isPermissionError(error: unknown): boolean {
    const name = typeof (error as { name?: unknown } | null)?.name === 'string' ? String((error as { name?: unknown }).name) : '';
    return /permission|security|notallowed/i.test(name);
}
