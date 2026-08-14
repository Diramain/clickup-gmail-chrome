const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(source(relativePath), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

describe('FASE D release metadata, safe data, and preflight', () => {
    const dataManagement = loadTsModule('src/data-management.ts');

    test('creates versioned safe export with counts and checksum without sensitive caches/auth/html keys', async () => {
        const payload = await dataManagement.createSafeExportPayload({
            emailTaskMappings: { thread1: [{ id: 'task1', name: 'Task 1', html: '<p>nope</p>' }] },
            emailTaskMappingsV2: { thread2: [{ id: 'task2', status: 'linked', emailData: { html: '<p>nope</p>' } }] },
            preferredTeamId: 'team1',
            threadIdField: 'Gmail Thread ID',
            useCustomFieldForThreadId: true,
            autoStartTimer: false,
            autoStopTimer: true,
            hierarchyCache: { should: 'not export' },
            cachedTeams: { should: 'not export' },
            oauthToken: 'nope',
            draftClientSecret: 'nope',
            html: '<p>nope</p>',
        }, '1.2.0', '2026-08-11T00:00:00.000Z', async () => 'abc123');

        expect(payload.schemaVersion).toBe(2);
        expect(payload.extensionVersion).toBe('1.2.0');
        expect(payload.counts).toEqual({ emailTaskMappings: 1, emailTaskMappingsV2: 1, settings: 5 });
        expect(payload.checksumSha256).toBe('abc123');
        expect(payload.data.emailTaskMappings.thread1).toEqual([{ id: 'task1', name: 'Task 1' }]);
        expect(payload.data.emailTaskMappingsV2.thread2).toEqual([{ id: 'task2', status: 'linked' }]);
        expect(payload.data.settings).toEqual({
            autoStartTimer: false,
            autoStopTimer: true,
            preferredTeamId: 'team1',
            threadIdField: 'Gmail Thread ID',
            useCustomFieldForThreadId: true,
        });
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toMatch(/hierarchyCache|cachedTeams|oauthToken|draftClientSecret|<p>nope<\/p>/);
    });

    test('clear guard requires recent safe backup and exact explicit confirmation', () => {
        const now = Date.now();
        expect(dataManagement.canClearLocalData(undefined, now, 'CLEAR DATA')).toEqual({ ok: false, code: 'BACKUP_REQUIRED' });
        expect(dataManagement.canClearLocalData(now - (16 * 60 * 1000), now, 'CLEAR DATA')).toEqual({ ok: false, code: 'BACKUP_REQUIRED' });
        expect(dataManagement.canClearLocalData(now, now, 'clear data')).toEqual({ ok: false, code: 'CONFIRMATION_REQUIRED' });
        expect(dataManagement.canClearLocalData(now, now, 'BORRAR DATOS')).toEqual({ ok: true, code: 'OK' });
        expect(dataManagement.canClearLocalData(now, now, 'CLEAR DATA')).toEqual({ ok: true, code: 'OK' });
    });

    test('manifest/package metadata and popup footer identify the 1.2.3 author', () => {
        const manifest = JSON.parse(source('manifest.json'));
        const packageJson = JSON.parse(source('package.json'));
        const packageLock = JSON.parse(source('package-lock.json'));
        const popupHtml = source('popup/popup.html');

        expect(manifest.version).toBe('1.2.3');
        expect(packageJson.version).toBe('1.2.3');
        expect(packageLock.version).toBe('1.2.3');
        expect(packageLock.packages[''].version).toBe('1.2.3');
        expect(manifest.author).toBe('Leandro Iramain');
        expect(packageJson.author).toBe('Leandro Iramain');
        expect(manifest.homepage_url).toBe('https://leandroiramain.com.ar');
        expect(packageJson.homepage).toBe('https://leandroiramain.com.ar');
        expect(popupHtml).toMatch(/Desarrollado por Leandro Iramain/);
        expect(popupHtml).toMatch(/href="https:\/\/leandroiramain\.com\.ar"/);
        expect(popupHtml).toMatch(/target="_blank"/);
        expect(popupHtml).toMatch(/rel="noopener noreferrer"/);
    });

    test('.gitignore blocks signing identity, backups, releases, zips, and env files', () => {
        const gitignore = source('.gitignore');
        ['key.pem', 'pubkey.*', '*.pem', '*.key', 'clickup-gmail-backup-*.json', 'release*/', 'release_v*/', '*.zip', '.env*', 'package.sh'].forEach((pattern) => {
            expect(gitignore).toContain(pattern);
        });
        expect(gitignore).toContain('src/**/*.js');
    });

    test('release allowlist and preflight exclude blocked categories', () => {
        const { RELEASE_FILES, BLOCKED_PATTERNS } = require('../scripts/release-allowlist');
        const validateScript = source('scripts/validate-release.js');
        expect(RELEASE_FILES).toContain('manifest.json');
        expect(RELEASE_FILES).toContain('background.js');
        expect(RELEASE_FILES).toContain('popup/popup.html');
        expect(RELEASE_FILES).toContain('task-modal-entry.js');
        expect(RELEASE_FILES).toContain('src/meet/meet-tracker.js');
        expect(RELEASE_FILES.some((file) => file.endsWith('.ts') || file.startsWith('docs/') || file.startsWith('node_modules/') || file.includes('backup'))).toBe(false);
        for (const file of RELEASE_FILES) {
            expect(BLOCKED_PATTERNS.some((pattern) => pattern.test(file))).toBe(false);
        }
        expect(validateScript).toMatch(/Version must be 1\.2\.3/);
        expect(validateScript).toMatch(/Manifest references missing file/);
        expect(validateScript).toMatch(/Release allowlist mismatch/);
        expect(validateScript).toMatch(/Blocked file in release directory/);
    });
});
