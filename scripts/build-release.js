const fs = require('fs');
const path = require('path');
const { RELEASE_DIR, RELEASE_FILES, BLOCKED_PATTERNS } = require('./release-allowlist');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, RELEASE_DIR);

function assertSafeRelative(file) {
    if (path.isAbsolute(file) || file.includes('..') || BLOCKED_PATTERNS.some((pattern) => pattern.test(file))) {
        throw new Error(`Blocked release path: ${file}`);
    }
}

function copyFile(file) {
    assertSafeRelative(file);
    const from = path.join(root, file);
    const to = path.join(outDir, file);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
        throw new Error(`Missing release source file: ${file}`);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of RELEASE_FILES) copyFile(file);

console.log(`✅ Release directory created at ${RELEASE_DIR}`);
console.log(RELEASE_FILES.map((file) => ` - ${file}`).join('\n'));
