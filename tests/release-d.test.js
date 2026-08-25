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

    test('manifest/package metadata use one version and identify the author', () => {
        const manifest = JSON.parse(source('manifest.json'));
        const packageJson = JSON.parse(source('package.json'));
        const packageLock = JSON.parse(source('package-lock.json'));
        const popupHtml = source('popup/popup.html');

        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:\.\d+)?$/);
        expect(packageJson.version).toBe(manifest.version);
        expect(packageLock.version).toBe(manifest.version);
        expect(packageLock.packages[''].version).toBe(manifest.version);
        expect(manifest.author).toBe('Leandro Iramain');
        expect(packageJson.author).toBe('Leandro Iramain');
        expect(manifest.homepage_url).toBe('https://taskbridge.leandroiramain.com.ar/');
        expect(packageJson.homepage).toBe('https://taskbridge.leandroiramain.com.ar/');
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
        const {
            RELEASE_TARGETS,
            RELEASE_FILES,
            RELEASE_FILES_BY_TARGET,
            RELEASE_SOURCE_OVERRIDES,
            BLOCKED_PATTERNS,
            releaseArchiveName,
        } = require('../scripts/release-allowlist');
        const validateScript = source('scripts/validate-release.js');
        const packageJson = JSON.parse(source('package.json'));
        const firefoxManifest = JSON.parse(source('manifest.firefox.json'));
        expect(RELEASE_TARGETS.chrome.directory).toBe('dist/chrome');
        expect(RELEASE_TARGETS.firefox.directory).toBe('dist/firefox');
        expect(releaseArchiveName('chrome', packageJson.version)).toBe('taskbridge-for-clickup-chrome-2.1.0.zip');
        expect(releaseArchiveName('firefox', packageJson.version)).toBe('taskbridge-for-clickup-firefox-2.1.0.zip');
        expect(RELEASE_FILES_BY_TARGET.chrome).toEqual(RELEASE_FILES);
        expect(RELEASE_FILES_BY_TARGET.firefox).toEqual(RELEASE_FILES);
        expect(RELEASE_SOURCE_OVERRIDES.chrome['icons/icon-128.png']).toBe('store-assets/taskbridge-icon-128x128.png');
        expect(RELEASE_SOURCE_OVERRIDES.firefox['icons/icon-128.png']).toBe('store-assets/taskbridge-icon-128x128.png');
        expect(RELEASE_FILES).toContain('manifest.json');
        expect(RELEASE_FILES).toContain('background.js');
        expect(RELEASE_FILES).toContain('popup/popup.html');
        expect(RELEASE_FILES).toContain('app/app.html');
        expect(RELEASE_FILES).toContain('app/app.js');
        expect(RELEASE_FILES).toContain('task-modal-entry.js');
        expect(RELEASE_FILES).toContain('src/meet/meet-tracker.js');
        expect(RELEASE_FILES.some((file) => file.endsWith('.ts') || file.startsWith('docs/') || file.startsWith('node_modules/') || file.includes('backup'))).toBe(false);
        for (const file of RELEASE_FILES) {
            expect(BLOCKED_PATTERNS.some((pattern) => pattern.test(file))).toBe(false);
        }
        expect(validateScript).not.toMatch(/Version must be \d/);
        expect(validateScript).toMatch(/Manifest references missing file/);
        expect(validateScript).toMatch(/Release allowlist mismatch/);
        expect(validateScript).toMatch(/Blocked file in release directory/);
        expect(validateScript).toMatch(/Legacy Gmail SDK marker in release file/);
        expect(validateScript).toMatch(/Classic content script contains module loader/);
        expect(source('build.js')).toMatch(/inject: \[\],[\s\S]*entryPoints: otherEntryPoints/);
        expect(firefoxManifest.background).toEqual({ scripts: ['background.js'] });
        expect(firefoxManifest.oauth2).toBeUndefined();
        expect(firefoxManifest.browser_specific_settings.gecko).toMatchObject({
            id: 'taskbridge-for-clickup@leandroiramain.com.ar',
            strict_min_version: '140.0',
        });
        expect(firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required).toContain('personallyIdentifyingInfo');
    });

    test('standalone modal uses explicit document mode and product typography', () => {
        expect(source('task-modal.html')).toMatch(/^<!DOCTYPE html>/i);
        expect(source('task-modal.html')).toMatch(/<meta charset="UTF-8">/);
        expect(source('styles/modal.css')).toMatch(/\.cu-modal-container \{[\s\S]*font-family: system-ui/);
    });

    test('deterministic ZIP output is byte-identical for the same files', () => {
        const os = require('os');
        const { createDeterministicZip } = require('../scripts/deterministic-zip');
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taskbridge-zip-'));
        const sourceDir = path.join(temp, 'source');
        fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
        fs.writeFileSync(path.join(sourceDir, 'manifest.json'), '{"version":"1"}\n');
        fs.writeFileSync(path.join(sourceDir, 'nested', 'runtime.js'), 'void 0;\n');
        const first = path.join(temp, 'first.zip');
        const second = path.join(temp, 'second.zip');
        createDeterministicZip(sourceDir, first);
        createDeterministicZip(sourceDir, second);
        expect(fs.readFileSync(first)).toEqual(fs.readFileSync(second));
        fs.rmSync(temp, { recursive: true, force: true });
    });
});
