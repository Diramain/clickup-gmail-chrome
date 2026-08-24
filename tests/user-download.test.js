const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadModule() {
  const filename = path.join(__dirname, '..', 'src', 'user-download.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}

describe('cross-browser user download', () => {
  test('uses a temporary anchor and delays object URL revocation', () => {
    const { triggerUserDownload } = loadModule();
    const urlApi = {
      createObjectURL: jest.fn(() => 'blob:taskbridge-export'),
      revokeObjectURL: jest.fn(),
    };
    let scheduled;
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    triggerUserDownload(
      new Blob(['safe']),
      'taskbridge trace:unsafe?.jsonl',
      document,
      urlApi,
      (callback, delay) => { scheduled = { callback, delay }; return 1; },
    );

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(urlApi.revokeObjectURL).not.toHaveBeenCalled();
    expect(scheduled.delay).toBe(1000);
    scheduled.callback();
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:taskbridge-export');
    click.mockRestore();
  });
});
