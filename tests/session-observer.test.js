const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('CGC-TRACE-010-A sidecar MV3 boundaries', () => {
  test('uses minimal permissions and no host/API/identity capabilities', () => {
    const manifest = JSON.parse(source('tools/session-observer/manifest.json'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['tabs']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.action.default_popup).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/identity|history|debugger|nativeMessaging|downloads|unlimitedStorage|identity\.email|clickup\.com|api\.clickup\.com/i);
  });

  test('observer and recorder source avoid raw logging and real data exports', () => {
    const background = source('tools/session-observer/background.ts');
    const recorder = source('tools/session-observer/recorder.ts');
    expect(background).toMatch(/new CausalTraceSanitizer\('session-observer'/);
    expect(background).toMatch(/chrome\.action\.onClicked\.addListener/);
    expect(background).toMatch(/chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\('recorder\.html'\) \}\)/);
    expect(background).toMatch(/new Map<chrome\.runtime\.Port, CausalTraceSanitizer>/);
    expect(background).not.toMatch(/console\.(log|warn|error)|fetch\(|cookies|history|identity/);
    expect(recorder).toMatch(/showSaveFilePicker/);
    expect(recorder).toMatch(/JsonlBatchWriter/);
    expect(recorder).toMatch(/scheduleReconnect/);
    expect(recorder).not.toMatch(/cap-recorder-continuity|recording-continuity/);
    expect(recorder).toMatch(/reconnectAttempts >= 5/);
  });

  test('main background uses per-port sanitizer map and does not emit stop on disconnect', () => {
    const background = source('background.ts');
    expect(background).toMatch(/new Map<chrome\.runtime\.Port, CausalTraceSanitizer>/);
    expect(background).toMatch(/const sanitizer = new CausalTraceSanitizer\('extension-main', createCaptureRef\('main'\)\)/);
    expect(background).toMatch(/for \(const \[port, sanitizer\] of \[\.\.\.causalTracePorts\.entries\(\)\]\)/);
    expect(background).toMatch(/port\.postMessage\(\{[\s\S]{0,220}event: sanitizer\.event\(\{ event: 'capture'/);
    expect(background).not.toMatch(/recording-stopped/);
  });

  test('recorders disclose activity metadata and manual stop boundary', () => {
    const mainHtml = source('diagnostics/recorder.html');
    const sidecarHtml = source('tools/session-observer/recorder.html');
    for (const html of [mainHtml, sidecarHtml]) {
      expect(html).toMatch(/Stop manual es el cierre confiable/);
      expect(html).toMatch(/timestamps y metadatos de actividad/);
      expect(html).toMatch(/Revisá el JSONL antes de compartirlo y borralo después/);
    }
  });
});
