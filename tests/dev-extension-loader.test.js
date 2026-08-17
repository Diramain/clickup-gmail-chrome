const fs = require('fs');
const path = require('path');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('CGC-UX-V2-B safe dev extension loader', () => {
    const { DEV_EXTENSION_DIR, DEV_EXTENSION_FILES, BLOCKED_PATTERNS } = require('../scripts/dev-extension-allowlist');

    test('uses a dedicated ignored output and includes the V2 shell', () => {
        expect(DEV_EXTENSION_DIR).toBe('dist/dev-extension');
        expect(DEV_EXTENSION_FILES).toEqual(expect.arrayContaining([
            'manifest.json',
            'popup/popup.html',
            'popup/popup.js',
            'app/app.html',
            'app/app.css',
            'app/app.js',
        ]));
        expect(source('.gitignore')).toContain('dist/');
        expect(JSON.parse(source('package.json')).scripts['build:dev-extension']).toContain('build-dev-extension.js');
    });

    test('every candidate is unique, relative and outside blocked patterns', () => {
        expect(new Set(DEV_EXTENSION_FILES).size).toBe(DEV_EXTENSION_FILES.length);
        for (const file of DEV_EXTENSION_FILES) {
            expect(path.isAbsolute(file)).toBe(false);
            expect(file).not.toContain('..');
            expect(BLOCKED_PATTERNS.some((pattern) => pattern.test(file))).toBe(false);
        }
    });

    test('loader rejects symlinks and verifies exact output without scanning secret content', () => {
        const loader = source('scripts/build-dev-extension.js');

        expect(loader).toContain('source.isSymbolicLink()');
        expect(loader).toContain('Dev extension allowlist mismatch');
        expect(loader).toContain("hasOwnProperty.call(manifest, 'key')");
        expect(loader).not.toMatch(/readFileSync\([^)]*(pem|key|env|secret)/i);
    });
});
