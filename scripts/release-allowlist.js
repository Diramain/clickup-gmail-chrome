const RELEASE_DIR = 'dist/extension';

const RELEASE_FILES = [
    'background.js',
    'icons/icon-16.png',
    'icons/icon-32.png',
    'icons/icon-48.png',
    'icons/icon-128.png',
    'manifest.json',
    'popup/popup.css',
    'popup/popup.html',
    'popup/popup.js',
    'src/clickup-tracker.js',
    'src/gmail-adapter.js',
    'src/gmail-native.js',
    'src/logger.js',
    'src/meet/meet-tracker.js',
    'styles/gmail-native.css',
    'styles/modal.css',
    'task-modal-entry.js',
    'task-modal.html',
];

const BLOCKED_PATTERNS = [
    /^\.env/i,
    /(^|\/)\.env/i,
    /(^|\/)node_modules(\/|$)/,
    /(^|\/)docs(\/|$)/,
    /(^|\/)tests(\/|$)/,
    /(^|\/)release[^/]*(\/|$)/i,
    /(^|\/)release_v[^/]*(\/|$)/i,
    /(^|\/)key\.pem$/i,
    /(^|\/)pubkey\./i,
    /\.pem$/i,
    /\.key$/i,
    /\.p12$/i,
    /\.pfx$/i,
    /\.zip$/i,
    /\.crx$/i,
    /(^|\/)package\.sh$/i,
    /\.map$/i,
    /\.ts$/i,
    /clickup-gmail-backup-.*\.json$/i,
];

module.exports = { RELEASE_DIR, RELEASE_FILES, BLOCKED_PATTERNS };
