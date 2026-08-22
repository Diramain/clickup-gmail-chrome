const { RELEASE_FILES, BLOCKED_PATTERNS } = require('./release-allowlist');

const DEV_EXTENSION_DIR = 'dist/dev-extension';
const DEV_EXTENSION_FILES = Object.freeze([
    ...RELEASE_FILES,
]);

module.exports = { DEV_EXTENSION_DIR, DEV_EXTENSION_FILES, BLOCKED_PATTERNS };
