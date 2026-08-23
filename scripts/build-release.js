const fs = require('fs');
const path = require('path');
const {
    RELEASE_TARGETS,
    RELEASE_FILES_BY_TARGET,
    RELEASE_SOURCE_OVERRIDES,
    BLOCKED_PATTERNS,
    requestedTargets,
} = require('./release-allowlist');

const root = path.resolve(__dirname, '..');

function assertSafeRelative(file) {
    if (path.isAbsolute(file) || file.includes('..') || BLOCKED_PATTERNS.some((pattern) => pattern.test(file))) {
        throw new Error(`Blocked release path: ${file}`);
    }
}

function copyFile(file, outDir, sourceFile = file) {
    assertSafeRelative(file);
    assertSafeRelative(sourceFile);
    const from = path.join(root, sourceFile);
    const to = path.join(outDir, file);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
        throw new Error(`Missing release source file: ${file}`);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}

for (const target of requestedTargets()) {
    const config = RELEASE_TARGETS[target];
    const outDir = path.join(root, config.directory);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    for (const file of RELEASE_FILES_BY_TARGET[target]) {
        copyFile(file, outDir, RELEASE_SOURCE_OVERRIDES[target][file] || file);
    }
    console.log(`✅ ${target} release directory created at ${config.directory}`);
}
