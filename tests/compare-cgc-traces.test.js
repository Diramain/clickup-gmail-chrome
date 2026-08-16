const fs = require('fs');
const os = require('os');
const path = require('path');
const comparator = require('../scripts/compare-cgc-traces');
const { compare, readJsonl } = comparator;

function event(source, sequence, timestamp, overrides = {}) {
  return { schemaVersion: 1, source, sequence, timestamp, captureRef: `${source}-cap`, event: 'listener', ...overrides };
}

function writeJsonl(dir, name, events) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, events.map((item) => JSON.stringify(item)).join('\n') + '\n');
  return file;
}

describe('CGC-TRACE-010-A trace comparator', () => {
  test('validates schema, streams both JSONL files and reports no anomaly for semantic correlated events', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgc-trace-'));
    const main = writeJsonl(dir, 'main.jsonl', [
      event('extension-main', 1, 1000, { event: 'listener', action: 'tabs.onUpdated', routeCategory: 'task-direct', tabRef: 'tab-1' }),
      event('extension-main', 2, 1010, { event: 'navigation', action: 'focused-evaluation', routeCategory: 'task-direct', tabRef: 'tab-1' }),
      event('extension-main', 3, 1020, { event: 'decision', action: 'start', outcome: 'attempted', reason: 'direct', routeCategory: 'task-direct', tabRef: 'tab-1' }),
    ]);
    const sidecar = writeJsonl(dir, 'sidecar.jsonl', [event('session-observer', 1, 990, { event: 'listener', action: 'tab-updated', routeCategory: 'task-direct', tabRef: 'tab-1' })]);
    const result = compare(await readJsonl(main, 'extension-main'), await readJsonl(sidecar, 'session-observer'));
    expect(result).toEqual({ mainEvents: 3, sidecarEvents: 1, anomalies: [] });
  });

  test('processes more than 20000 events without silent drop', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgc-trace-'));
    const mainEvents = Array.from({ length: 20005 }, (_, index) => event('extension-main', index + 1, index + 1, { event: 'capture', action: 'recording-started', outcome: 'armed', captureRef: 'extension-main-cap' }));
    const sideEvents = Array.from({ length: 20005 }, (_, index) => event('session-observer', index + 1, index + 1, { event: 'capture', action: 'recording-started', outcome: 'armed', captureRef: 'session-observer-cap' }));
    const mainFile = writeJsonl(dir, 'main-large.jsonl', mainEvents);
    const sideFile = writeJsonl(dir, 'side-large.jsonl', sideEvents);
    const result = await comparator.compareFiles(mainFile, sideFile);
    expect(result.mainEvents).toBe(20005);
    expect(result.sidecarEvents).toBe(20005);
  });

  test('rejects raw URL/task/email/token decoys and harmless extra fields before correlation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgc-trace-'));
    const raw = path.join(dir, 'raw.jsonl');
    const extra = path.join(dir, 'extra.jsonl');
    fs.writeFileSync(raw, JSON.stringify(event('extension-main', 1, 1000, { rawUrl: 'https://app.clickup.com/t/TASK-RAW-123?secret=value user@example.test Bearer token' })) + '\n');
    fs.writeFileSync(extra, JSON.stringify(event('extension-main', 1, 1000, { note: 'harmless' })) + '\n');
    await expect(readJsonl(raw, 'extension-main')).rejects.toThrow(/raw_data_detected|schema_invalid/);
    await expect(readJsonl(extra, 'extension-main')).rejects.toThrow(/schema_invalid/);
  });

  test('reports required anomaly classes without idle gap false positives', () => {
    const result = compare([
      event('extension-main', 1, 1000, { event: 'index', outcome: 'index-miss', reason: 'closed-task-unknown' }),
      event('extension-main', 2, 2000, { event: 'decision', action: 'stop', outcome: 'skipped', reason: 'same-task' }),
      event('extension-main', 3, 3000, { event: 'result', outcome: 'failure', errorCategory: 'rate-limited' }),
      event('extension-main', 5, 100000, { event: 'navigation', action: 'focused-evaluation', tabRef: 'tab-2' }),
    ], [event('session-observer', 1, 70000, { event: 'listener', action: 'tab-updated', tabRef: 'tab-9' })]);
    expect(result.anomalies.map((item) => item.type)).toEqual(expect.arrayContaining([
      'external_without_internal', 'index_miss', 'stop_skipped', 'api_failure', 'navigation_not_processed', 'sequence_discontinuity',
    ]));
    expect(result.anomalies.map((item) => item.type)).not.toContain('capture_gap');
  });

  test('does not report expected non-task index misses as anomalies', () => {
    const result = compare([
      event('extension-main', 1, 1000, { event: 'index', outcome: 'index-miss', reason: 'unknown', routeCategory: 'kanban-or-list' }),
      event('extension-main', 2, 1010, { event: 'index', outcome: 'index-miss', reason: 'last-task-view-left', routeCategory: 'inbox-general' }),
    ], []);
    expect(result.anomalies).toEqual([]);
  });

  test('correlates by mapped action without comparing cross-source tab aliases', () => {
    const result = compare([
      event('extension-main', 1, 1000, { event: 'listener', action: 'tabs.onActivated', tabRef: 'tab-1' }),
      event('extension-main', 2, 1010, { event: 'listener', action: 'tabs.onUpdated', tabRef: 'tab-2' }),
    ], [
      event('session-observer', 1, 990, { event: 'listener', action: 'tab-updated', tabRef: 'tab-1' }),
      event('session-observer', 2, 995, { event: 'listener', action: 'tab-activated', tabRef: 'tab-3' }),
    ]);
    expect(result.anomalies.filter((item) => item.type === 'external_without_internal')).toHaveLength(0);
  });

  test('consumes each main match once and ignores cross-source alias differences', () => {
    const result = compare([
      event('extension-main', 1, 1000, { event: 'listener', action: 'tabs.onUpdated', routeCategory: 'task-direct', tabRef: 'tab-1' }),
    ], [
      event('session-observer', 1, 990, { event: 'listener', action: 'tab-updated', routeCategory: 'task-direct', tabRef: 'tab-99' }),
      event('session-observer', 2, 991, { event: 'listener', action: 'tab-updated', routeCategory: 'task-direct', tabRef: 'tab-100' }),
    ]);
    expect(result.anomalies.filter((item) => item.type === 'external_without_internal')).toHaveLength(1);
  });

  test('rejects invalid enum values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgc-trace-'));
    const invalid = writeJsonl(dir, 'invalid.jsonl', [event('extension-main', 1, 1000, { event: 'listener', action: 'not-allowed' })]);
    await expect(readJsonl(invalid, 'extension-main')).rejects.toThrow(/schema_invalid/);
  });

  test('enforces 64KiB line limit and does not use readFileSync', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgc-trace-'));
    const large = path.join(dir, 'large.jsonl');
    fs.writeFileSync(large, `${'x'.repeat(65 * 1024)}\n`);
    await expect(readJsonl(large, 'extension-main')).rejects.toThrow(/line_too_large/);
    expect(fs.readFileSync(path.join(__dirname, '..', 'scripts/compare-cgc-traces.js'), 'utf8')).not.toMatch(/readFileSync\(/);
  });
});
