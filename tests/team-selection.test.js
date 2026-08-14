const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

const { isAuthorizedTeamId, selectAuthorizedTeamId } = loadTsModule('src/team-selection.ts');

describe('authorized workspace selection', () => {
    const teams = [{ id: 'CURRENT' }];

    test('keeps an authorized preference', () => {
        expect(selectAuthorizedTeamId(teams, 'CURRENT')).toBe('CURRENT');
    });

    test('replaces a stale preference with the first currently authorized workspace', () => {
        expect(selectAuthorizedTeamId(teams, 'STALE')).toBe('CURRENT');
    });

    test('fails closed with no authorized workspace', () => {
        expect(selectAuthorizedTeamId([], 'STALE')).toBeNull();
        expect(isAuthorizedTeamId(teams, 'STALE')).toBe(false);
        expect(isAuthorizedTeamId(teams, 'CURRENT')).toBe(true);
    });
});
