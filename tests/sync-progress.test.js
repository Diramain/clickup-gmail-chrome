const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(source(relativePath), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

describe('Safe synchronization progress', () => {
    const progress = loadTsModule('src/sync-progress.ts');

    test('accepts only allowlisted phases and bounded numeric counters', () => {
        expect(progress.isSyncProgressMessage({
            action: 'syncProgress',
            scope: 'email',
            phase: 'processing',
            current: 100,
            total: 500,
            found: 12,
        })).toBe(true);

        expect(progress.isSyncProgressMessage({
            action: 'syncProgress',
            scope: 'email',
            phase: 'processing',
            current: -1,
        })).toBe(false);
    });

    test('rejects payload fields that could carry task or user data', () => {
        expect(progress.isSyncProgressMessage({
            action: 'syncProgress',
            scope: 'hierarchy',
            phase: 'processing',
            current: 1,
            total: 2,
            taskName: 'dato no permitido',
        })).toBe(false);
    });

    test('formats hierarchy and email counters in Spanish', () => {
        expect(progress.formatSyncProgress({
            action: 'syncProgress',
            scope: 'hierarchy',
            phase: 'processing',
            current: 2,
            total: 8,
            listCount: 34,
        })).toBe('Espacio 2/8 · 34 listas encontradas');

        expect(progress.formatSyncProgress({
            action: 'syncProgress',
            scope: 'email',
            phase: 'processing',
            current: 300,
            total: 524,
            found: 18,
        })).toBe('300/524 tareas revisadas · 18 vinculadas');
    });

    test('background emits only the validated progress contract and popup renders it', () => {
        const background = source('background.ts');
        const popup = source('popup/popup.ts');
        expect(background).toContain('isSyncProgressMessage(message)');
        expect(background).toContain("scope: 'hierarchy'");
        expect(background).toContain("scope: 'email'");
        expect(popup).toContain('handleSyncProgressMessage');
        expect(popup).toContain('[Sincronización]');
    });

    test('workspace task retrieval no longer sends the ignored query parameter', () => {
        const api = source('src/services/api.service.ts');
        expect(api).not.toContain('task?query=');
        expect(api).toContain('getWorkspaceTasksPage');
        expect(api).toContain('include_closed=true&subtasks=true&page=');
    });
});
