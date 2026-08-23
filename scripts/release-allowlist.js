const RELEASE_TARGETS = Object.freeze({
    chrome: Object.freeze({
        directory: 'dist/chrome',
        manifestSource: 'manifest.json',
    }),
    firefox: Object.freeze({
        directory: 'dist/firefox',
        manifestSource: 'manifest.firefox.json',
    }),
});

const RELEASE_FILES = [
    'background.js',
    'app/app.css',
    'app/app.html',
    'app/app.js',
    'app/assets/clickup-logomark.svg',
    'app/assets/clickup-logo-on-light.svg',
    'app/assets/clickup-logo-on-dark.svg',
    'app/assets/google-calendar.svg',
    'app/assets/spiritfox-logo.webp',
    'app/fonts/bricolage-grotesque-latin.woff2',
    'app/fonts/fragment-mono-latin.woff2',
    'diagnostics/recorder.css',
    'diagnostics/recorder.html',
    'diagnostics/recorder.js',
    'icons/icon-16.png',
    'icons/icon-32.png',
    'icons/icon-48.png',
    'icons/icon-128.png',
    'manifest.json',
    'popup/popup.css',
    'popup/popup.html',
    'popup/popup.js',
    'popup/minimal.css',
    'popup/minimal.html',
    'popup/minimal.js',
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

const RELEASE_FILES_BY_TARGET = Object.freeze({
    chrome: Object.freeze([...RELEASE_FILES]),
    firefox: Object.freeze([...RELEASE_FILES]),
});

const RELEASE_SOURCE_OVERRIDES = Object.freeze({
    chrome: Object.freeze({
        'manifest.json': 'manifest.json',
        'icons/icon-128.png': 'store-assets/taskbridge-icon-128x128.png',
    }),
    firefox: Object.freeze({
        'manifest.json': 'manifest.firefox.json',
        'icons/icon-128.png': 'store-assets/taskbridge-icon-128x128.png',
    }),
});

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

function requestedTargets(argv = process.argv.slice(2)) {
    const option = argv.find((argument) => argument.startsWith('--target='));
    const requested = option ? option.slice('--target='.length) : 'all';
    if (requested === 'all') return Object.keys(RELEASE_TARGETS);
    if (!Object.prototype.hasOwnProperty.call(RELEASE_TARGETS, requested)) {
        throw new Error(`Unknown release target: ${requested}`);
    }
    return [requested];
}

function releaseArchiveName(target, version) {
    if (!Object.prototype.hasOwnProperty.call(RELEASE_TARGETS, target)) {
        throw new Error(`Unknown release target: ${target}`);
    }
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) {
        throw new Error(`Invalid release version: ${version}`);
    }
    return `taskbridge-for-clickup-${target}-${version}.zip`;
}

module.exports = {
    RELEASE_TARGETS,
    RELEASE_FILES,
    RELEASE_FILES_BY_TARGET,
    RELEASE_SOURCE_OVERRIDES,
    BLOCKED_PATTERNS,
    requestedTargets,
    releaseArchiveName,
};
