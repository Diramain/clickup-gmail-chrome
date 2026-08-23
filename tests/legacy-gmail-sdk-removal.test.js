const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourceRoots = ['app', 'diagnostics', 'popup', 'scripts', 'src', 'styles', 'tools'];
const rootFiles = ['background.ts', 'build.js', 'manifest.json', 'package.json', 'package-lock.json'];
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.sh', '.ts']);
const blockedTerm = new RegExp(['inbox', 'sdk'].join(''), 'i');

function listTextFiles(relativePath) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) return [];
    if (fs.statSync(absolutePath).isFile()) {
        return textExtensions.has(path.extname(relativePath)) ? [relativePath] : [];
    }

    return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) =>
        listTextFiles(path.join(relativePath, entry.name))
    );
}

test('legacy Gmail SDK is absent from source and release inputs', () => {
    const files = [...rootFiles, ...sourceRoots.flatMap(listTextFiles)];
    const matches = files.filter((file) => blockedTerm.test(fs.readFileSync(path.join(root, file), 'utf8')));

    expect(matches).toEqual([]);
});
