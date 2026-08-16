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

describe('CGC-TRACE-010-A causal trace sanitizer', () => {
  const traceModule = loadTsModule('src/causal-trace.ts');

  test('exports only categories, ephemeral refs, clickup url alias and query/fragment presence', () => {
    const sanitizer = new traceModule.CausalTraceSanitizer('extension-main', 'cap-test', () => 1700000000000);
    const event = sanitizer.event({
      event: 'navigation',
      rawUrl: 'https://app.clickup.com/t/123456/TASK-RAW-123?secret=value#private',
      taskId: 'TASK-RAW-123',
      tabId: 42,
      windowId: 7,
      action: 'focused-evaluation',
      outcome: 'attempted',
      reason: 'direct',
    });

    expect(event).toMatchObject({
      schemaVersion: 1,
      source: 'extension-main',
      sequence: 1,
      timestamp: 1700000000000,
      captureRef: 'cap-test',
      event: 'navigation',
      tabRef: 'tab-1',
      windowRef: 'win-1',
      originCategory: 'clickup',
      routeCategory: 'task-direct',
      hasQuery: true,
      hasFragment: true,
    });
    expect(event.taskRef).toBe('task-1');
    expect(event.urlRef).toBe('url-1');
    expect(event.urlFingerprint).toBeUndefined();
    expect(event.titleFingerprint).toBeUndefined();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(/clickup\.com|secret=value|#private|PRIVATE-TITLE|customer@example\.test|TASK-RAW-123|token/);
    expect(traceModule.assertNoRawTraceSecrets(serialized)).toBe(true);
    expect(traceModule.isSafeCausalTraceEvent(event)).toBe(true);
  });

  test('fresh sanitizers produce independent capture refs and per-capture aliases', () => {
    const first = new traceModule.CausalTraceSanitizer('extension-main', traceModule.createCaptureRef('main'), () => 1);
    const second = new traceModule.CausalTraceSanitizer('extension-main', traceModule.createCaptureRef('main'), () => 1);
    const a = first.event({ event: 'listener', rawUrl: 'https://app.clickup.com/t/123/TASK_A', taskId: 'TASK_A', tabId: 99 });
    const b = second.event({ event: 'listener', rawUrl: 'https://app.clickup.com/t/123/TASK_A', taskId: 'TASK_A', tabId: 99 });
    expect(a.captureRef).not.toBe(b.captureRef);
    expect(a).toMatchObject({ tabRef: 'tab-1', taskRef: 'task-1', urlRef: 'url-1' });
    expect(b).toMatchObject({ tabRef: 'tab-1', taskRef: 'task-1', urlRef: 'url-1' });
  });

  test('does not create URL aliases for Gmail, Meet, extension, or other origins', () => {
    const sanitizer = new traceModule.CausalTraceSanitizer('extension-main', 'cap-test', () => 1);
    for (const rawUrl of ['https://mail.google.com/mail/u/0/#inbox', 'https://meet.google.com/abc-defg-hij', 'chrome-extension://id/recorder.html', 'https://example.test/a?x=1']) {
      const event = sanitizer.event({ event: 'navigation', rawUrl });
      expect(event.urlRef).toBeUndefined();
      expect(JSON.stringify(event)).not.toMatch(/mail\.google|meet\.google|chrome-extension|example\.test/);
    }
  });

  test('strict normalizer rejects extra fields and raw decoys while preserving harmless schema values', () => {
    const valid = { schemaVersion: 1, source: 'extension-main', sequence: 1, timestamp: 1, captureRef: 'cap-test', event: 'capture', action: 'recording-started', outcome: 'armed' };
    expect(traceModule.normalizeCausalTraceEvent(valid, 'extension-main')).toEqual(valid);
    for (const extra of ['rawUrl', 'rawTitle', 'taskId', 'email', 'token', 'note']) {
      expect(traceModule.normalizeCausalTraceEvent({ ...valid, [extra]: extra === 'note' ? 'harmless' : 'secret' }, 'extension-main')).toBeNull();
    }
    expect(traceModule.assertNoRawTraceSecrets(JSON.stringify({ rawUrl: 'https://app.clickup.com/t/TASK-RAW?secret=value' }))).toBe(false);
  });

  test('classifies ClickUp routes without exposing path payloads', () => {
    expect(traceModule.classifyRoute('https://app.clickup.com/123/inbox?tab=primary')).toEqual({
      originCategory: 'clickup', routeCategory: 'inbox-general', hasQuery: true, hasFragment: false,
    });
    expect(traceModule.classifyRoute('https://app.clickup.com/123/v/l/li/abc#frag')).toEqual({
      originCategory: 'clickup', routeCategory: 'kanban-or-list', hasQuery: false, hasFragment: true,
    });
  });
});
