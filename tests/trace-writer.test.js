const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { TextEncoder } = require('util');

function loadTsModule(relativePath) {
  const filename = path.join(__dirname, '..', relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}

class MemoryHandle {
  constructor(fail = null, initial = '') { this.data = initial; this.closes = 0; this.fail = fail; this.createOptions = []; }
  async createWritable(options) {
    this.createOptions.push(options || {});
    if (this.fail) throw this.fail;
    let position = 0;
    if (options?.keepExistingData === false) this.data = '';
    return {
      seek: async (pos) => { position = pos; },
      truncate: async (size) => { this.data = this.data.slice(0, size); },
      write: async (chunk) => { this.data = `${this.data.slice(0, position)}${chunk}${this.data.slice(position + String(chunk).length)}`; position += String(chunk).length; },
      close: async () => { this.closes += 1; },
    };
  }
}

describe('CGC-TRACE-010-A JSONL batch writer', () => {
  const { InMemoryTraceFileHandle, JsonlBatchWriter } = loadTsModule('src/trace-writer.ts');

  test('exports the same UTF-8 JSONL through the bounded Firefox memory handle', async () => {
    const handle = new InMemoryTraceFileHandle(new TextEncoder());
    const writer = new JsonlBatchWriter(handle, { limitBytes: 1024, batchSize: 2, encoder: new TextEncoder() });
    await writer.initialize();
    expect(writer.enqueue({ event: 'capture', outcome: 'armed' })).toBe(true);
    expect(writer.enqueue({ event: 'result', outcome: 'success' })).toBe(true);
    await writer.stop('manual-stop');

    const expected = '{"event":"capture","outcome":"armed"}\n{"event":"result","outcome":"success"}\n';
    expect(handle.size).toBe(Buffer.byteLength(expected));
    const blob = handle.toBlob();
    const exported = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(exported).toBe(expected);
    expect(blob.type).toBe('application/x-ndjson');
  });

  test('writes JSONL in batches and closes the writable on each flush', async () => {
    const handle = new MemoryHandle();
    const writer = new JsonlBatchWriter(handle, { batchSize: 2, flushDelayMs: 10, encoder: new TextEncoder() });
    await writer.initialize();
    expect(writer.enqueue({ sequence: 1 })).toBe(true);
    expect(writer.enqueue({ sequence: 2 })).toBe(true);
    await writer.flush();
    expect(handle.data).toBe('{"sequence":1}\n{"sequence":2}\n');
    expect(handle.closes).toBe(2);
    expect(writer.status.bytesWritten).toBe(Buffer.byteLength(handle.data));
  });

  test('flush empties more than one batch and tracks pending bytes O(1)', async () => {
    const handle = new MemoryHandle();
    const writer = new JsonlBatchWriter(handle, { batchSize: 2, flushDelayMs: 10, encoder: new TextEncoder() });
    await writer.initialize();
    for (let i = 0; i < 5; i += 1) expect(writer.enqueue({ sequence: i + 1 })).toBe(true);
    expect(writer.status.pendingBytes).toBeGreaterThan(0);
    await writer.flush();
    expect(handle.data.split('\n').filter(Boolean)).toHaveLength(5);
    expect(writer.status).toMatchObject({ queued: 0, pendingBytes: 0, unwrittenEvents: 0 });
  });

  test('truncates preexisting file and persists accepted events before hard cap stop', async () => {
    const handle = new MemoryHandle(null, 'PREVIOUS PRIVATE CONTENT');
    const writer = new JsonlBatchWriter(handle, { limitBytes: 16, batchSize: 10, encoder: new TextEncoder() });
    await writer.initialize();
    expect(handle.data).toBe('');
    expect(writer.enqueue({ a: 1 })).toBe(true);
    expect(writer.enqueue({ b: 2 })).toBe(true);
    expect(writer.enqueue({ c: 3 })).toBe(false);
    await writer.stop('writer-limit');
    expect(handle.data).toBe('{"a":1}\n{"b":2}\n');
    expect(writer.status).toMatchObject({ stopped: true, reason: 'writer-limit', queued: 0, unwrittenEvents: 0, rejectedEvents: 1 });
    expect(handle.createOptions[0]).toEqual({ keepExistingData: false });
  });

  test('overflow rejects only the exceeding event and drains previously accepted events', async () => {
    const overflow = new JsonlBatchWriter(new MemoryHandle(), { maxQueueEvents: 1, batchSize: 10, encoder: new TextEncoder() });
    await overflow.initialize();
    expect(overflow.enqueue({ one: true })).toBe(true);
    expect(overflow.enqueue({ two: true })).toBe(false);
    expect(overflow.status.reason).toBe('writer-overflow');
    await overflow.stop('writer-overflow');
    expect(overflow.status).toMatchObject({ queued: 0, unwrittenEvents: 0, acceptedEvents: 1, rejectedEvents: 1 });
  });

  test('permission errors fail closed and expose unwritten accepted events', async () => {
    const permission = new DOMException('denied', 'NotAllowedError');
    const writer = new JsonlBatchWriter(new MemoryHandle(permission), { batchSize: 1, encoder: new TextEncoder() });
    expect(writer.enqueue({ sequence: 1 })).toBe(true);
    await writer.flush();
    expect(writer.status).toMatchObject({ stopped: true, reason: 'permission-error', queued: 1 });
  });

  test('flush resolves after second writable failure and calls onStop once', async () => {
    let creates = 0;
    let stops = 0;
    const handle = new MemoryHandle();
    handle.createWritable = async function createWritable(options) {
      creates += 1;
      if (creates === 1) return MemoryHandle.prototype.createWritable.call(this, options);
      throw new Error('disk-failed');
    };
    const writer = new JsonlBatchWriter(handle, { batchSize: 1, encoder: new TextEncoder(), onStop: () => { stops += 1; } });
    await writer.initialize();
    expect(writer.enqueue({ sequence: 1 })).toBe(true);
    await expect(writer.flush()).resolves.toBeUndefined();
    expect(writer.status).toMatchObject({ stopped: true, reason: 'writer-error', unwrittenEvents: 1 });
    expect(stops).toBe(1);
  });

  test('write failure during manual stop overrides the requested stop reason', async () => {
    let creates = 0;
    const reasons = [];
    const handle = new MemoryHandle();
    handle.createWritable = async function createWritable(options) {
      creates += 1;
      if (creates === 1) return MemoryHandle.prototype.createWritable.call(this, options);
      throw new Error('disk-failed');
    };
    const writer = new JsonlBatchWriter(handle, { batchSize: 10, encoder: new TextEncoder(), onStop: (reason) => { reasons.push(reason); } });
    await writer.initialize();
    expect(writer.enqueue({ sequence: 1 })).toBe(true);
    await writer.stop('manual-stop');
    expect(writer.status).toMatchObject({ stopped: true, reason: 'writer-error', unwrittenEvents: 1 });
    expect(reasons).toEqual(['writer-error']);
  });

  test('invokes injected timer functions without binding them to the writer', async () => {
    let scheduled;
    let cleared;
    function strictSetTimeout(callback) {
      'use strict';
      if (this !== undefined) throw new TypeError('Illegal invocation');
      scheduled = callback;
      return 77;
    }
    function strictClearTimeout(timer) {
      'use strict';
      if (this !== undefined) throw new TypeError('Illegal invocation');
      cleared = timer;
    }
    const writer = new JsonlBatchWriter(new MemoryHandle(), {
      batchSize: 10,
      encoder: new TextEncoder(),
      setTimeoutFn: strictSetTimeout,
      clearTimeoutFn: strictClearTimeout,
    });
    await writer.initialize();
    expect(writer.enqueue({ sequence: 1 })).toBe(true);
    expect(typeof scheduled).toBe('function');
    await writer.flush();
    expect(cleared).toBe(77);
  });
});
