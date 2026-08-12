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

describe('Task search by ID or title', () => {
    const search = loadTsModule('src/task-search.ts');

    test('normalizes accents, case, punctuation and repeated whitespace', () => {
        expect(search.normalizeTaskSearchText('  Protección: GASTRONÓMICA  ')).toBe('proteccion gastronomica');
    });

    test('extracts exact internal IDs, #IDs and ClickUp URLs without treating ordinary titles as IDs', () => {
        expect(search.extractTaskIdCandidate('86bbah5g7')).toBe('86bbah5g7');
        expect(search.extractTaskIdCandidate('#86bbah5g7')).toBe('86bbah5g7');
        expect(search.extractTaskIdCandidate('https://app.clickup.com/t/86bbah5g7')).toBe('86bbah5g7');
        expect(search.extractTaskIdCandidate('agregar captcha')).toBeNull();
        expect(search.extractTaskIdCandidate('marketing')).toBeNull();
    });

    test('returns only coherent title matches and excludes arbitrary upstream tasks', () => {
        const tasks = [
            { id: '86bbahjbx', name: 'Upgrade CRM' },
            { id: '86bbah702', name: 'Upgrade CRM' },
            { id: '86bbah5g7', name: 'Agregar Captcha y protección para evitar bots en compras' },
            { id: '86bbother', name: 'Historia Evento' },
        ];

        expect(search.rankTaskSearchResults(tasks, 'agregar captcha')).toEqual([
            tasks[2],
        ]);
    });

    test('matches all title words regardless of accents and ranks a phrase prefix first', () => {
        const tasks = [
            { id: 'a1', name: 'Protección final para agregar un Captcha' },
            { id: 'a2', name: 'Agregar Captcha y protección' },
            { id: 'a3', name: 'Agregar formulario' },
        ];

        expect(search.rankTaskSearchResults(tasks, 'AGREGAR protección')).toEqual([
            tasks[1],
            tasks[0],
        ]);
    });

    test('ranks an exact or partial Task ID without using unrelated titles', () => {
        const tasks = [
            { id: '86bbah5g7', name: 'Agregar Captcha' },
            { id: '86bbah702', name: 'Otra tarea' },
        ];

        expect(search.rankTaskSearchResults(tasks, '86bbah5g7')).toEqual([tasks[0]]);
        expect(search.rankTaskSearchResults(tasks, 'ah5g7')).toEqual([tasks[0]]);
    });

    test('deduplicates by Task ID and detects high-confidence phrase matches', () => {
        const duplicate = { id: '86bbah5g7', name: 'Agregar Captcha' };
        const ranked = search.rankTaskSearchResults([duplicate, { ...duplicate }], 'agregar captcha');
        expect(ranked).toHaveLength(1);
        expect(search.hasHighConfidenceTaskSearchResult(ranked, 'agregar captcha')).toBe(true);
    });
});
