const { RELEASE_FILES, BLOCKED_PATTERNS } = require('./release-allowlist');

const DEV_EXTENSION_DIR = 'dist/dev-extension';
const DEV_EXTENSION_FILES = Object.freeze([
    ...RELEASE_FILES,
    'app/app.css',
    'app/app.html',
    'app/app.js',
    'app/assets/clickup-logomark.svg',
    'app/assets/clickup-logo-on-light.svg',
    'app/assets/clickup-logo-on-dark.svg',
    'app/assets/google-calendar.svg',
    // Tipografías locales (SIL OFL 1.1). Sin ellas la app degrada al sistema.
    'app/fonts/bricolage-grotesque-latin.woff2',
    'app/fonts/fragment-mono-latin.woff2',
]);

module.exports = { DEV_EXTENSION_DIR, DEV_EXTENSION_FILES, BLOCKED_PATTERNS };
