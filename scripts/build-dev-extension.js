const fs = require('fs');
const path = require('path');
const { DEV_EXTENSION_DIR, DEV_EXTENSION_FILES, BLOCKED_PATTERNS } = require('./dev-extension-allowlist');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, DEV_EXTENSION_DIR);

function assertSafeRelative(file) {
    const normalized = path.posix.normalize(file);
    if (!file || normalized !== file || path.isAbsolute(file) || file.includes('..')) {
        throw new Error(`Blocked dev extension path: ${file}`);
    }
    if (BLOCKED_PATTERNS.some((pattern) => pattern.test(file))) {
        throw new Error(`Blocked dev extension path: ${file}`);
    }
}

function listFiles(dir, prefix = '') {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full, relative) : [relative];
    }).sort();
}

function copyAllowlistedFile(file) {
    assertSafeRelative(file);
    const from = path.join(root, file);
    const to = path.join(outDir, file);
    const source = fs.lstatSync(from);
    if (!source.isFile() || source.isSymbolicLink()) {
        throw new Error(`Unsafe dev extension source: ${file}`);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}

if (new Set(DEV_EXTENSION_FILES).size !== DEV_EXTENSION_FILES.length) {
    throw new Error('Duplicate dev extension allowlist entry');
}
for (const file of DEV_EXTENSION_FILES) assertSafeRelative(file);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const file of DEV_EXTENSION_FILES) copyAllowlistedFile(file);

const actual = listFiles(outDir);
const expected = [...DEV_EXTENSION_FILES].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Dev extension allowlist mismatch. Expected ${expected.join(', ')}; got ${actual.join(', ')}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
if (Object.prototype.hasOwnProperty.call(manifest, 'key')) {
    throw new Error('Dev extension manifest must not contain a key property');
}

console.log(`✅ Safe dev extension created at ${DEV_EXTENSION_DIR}`);
console.log(`✅ ${actual.length} allowlisted runtime files; blocked paths excluded`);
