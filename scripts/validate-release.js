const fs = require('fs');
const path = require('path');
const { RELEASE_TARGETS, RELEASE_FILES_BY_TARGET, BLOCKED_PATTERNS, requestedTargets } = require('./release-allowlist');

const root = path.resolve(__dirname, '..');
const blockedContentTerm = new RegExp(['inbox', 'sdk'].join(''), 'i');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.svg']);

function fail(message) {
    console.error(`❌ ${message}`);
    process.exit(1);
}

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function listFiles(dir, prefix = '') {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full, rel) : [rel];
    }).sort();
}

function validateMetadata(manifest, target) {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    if (manifest.version !== packageJson.version) fail(`${target} manifest/package version mismatch`);
    if (packageLock.version !== manifest.version || packageLock.packages?.['']?.version !== manifest.version) fail('Package lock version mismatch');
    if (manifest.author !== 'Leandro Iramain') fail(`${target} manifest author mismatch`);
    if (manifest.homepage_url !== 'https://leandroiramain.com.ar') fail(`${target} manifest homepage_url mismatch`);
    if (packageJson.author !== 'Leandro Iramain') fail('Package author mismatch');
    if (packageJson.homepage !== 'https://leandroiramain.com.ar') fail('Package homepage mismatch');
}

function validateTargetManifest(manifest, target) {
    if (target === 'chrome') {
        if (manifest.minimum_chrome_version !== '102') fail('Chrome minimum version mismatch');
        if (manifest.background?.service_worker !== 'background.js') fail('Chrome service worker mismatch');
        if (manifest.background?.scripts) fail('Chrome manifest must not include background scripts');
        if (!manifest.oauth2) fail('Chrome OAuth manifest block missing');
        if (manifest.browser_specific_settings) fail('Chrome manifest contains Firefox settings');
        return;
    }

    const gecko = manifest.browser_specific_settings?.gecko;
    if (manifest.minimum_chrome_version) fail('Firefox manifest contains minimum_chrome_version');
    if (manifest.oauth2) fail('Firefox manifest contains Chrome OAuth block');
    if (manifest.background?.service_worker) fail('Firefox manifest contains unsupported service worker');
    if (JSON.stringify(manifest.background?.scripts) !== JSON.stringify(['background.js'])) fail('Firefox background scripts mismatch');
    if (gecko?.id !== 'taskbridge-for-clickup@leandroiramain.com.ar') fail('Firefox Gecko ID mismatch');
    if (gecko?.strict_min_version !== '140.0') fail('Firefox minimum version mismatch');
    const expectedDataCategories = [
        'authenticationInfo',
        'personalCommunications',
        'personallyIdentifyingInfo',
        'websiteActivity',
        'websiteContent',
    ];
    if (JSON.stringify(gecko?.data_collection_permissions?.required) !== JSON.stringify(expectedDataCategories)) {
        fail('Firefox data collection declaration mismatch');
    }
    if ((manifest.host_permissions || []).includes('https://www.googleapis.com/*')) fail('Firefox must not claim Calendar API access before B4');
}

function validateManifestReferences(manifest, actual, target) {
    const referenced = new Set();
    referenced.add(manifest.background?.service_worker);
    (manifest.background?.scripts || []).forEach((file) => referenced.add(file));
    referenced.add(manifest.action?.default_popup);
    Object.values(manifest.action?.default_icon || {}).forEach((file) => referenced.add(file));
    Object.values(manifest.icons || {}).forEach((file) => referenced.add(file));
    (manifest.content_scripts || []).forEach((script) => {
        (script.js || []).forEach((file) => referenced.add(file));
        (script.css || []).forEach((file) => referenced.add(file));
    });
    (manifest.web_accessible_resources || []).forEach((resource) => {
        (resource.resources || []).forEach((file) => {
            if (file.endsWith('/*')) {
                const dir = file.slice(0, -2);
                if (!actual.some((candidate) => candidate.startsWith(`${dir}/`))) fail(`${target} manifest wildcard has no files: ${file}`);
            } else {
                referenced.add(file);
            }
        });
    });
    for (const file of referenced) {
        if (file && !file.endsWith('/*') && !actual.includes(file)) fail(`Manifest references missing file (${target}): ${file}`);
    }
}

function validateClassicContentScripts(manifest, outDir, target) {
    const moduleSyntax = /\brequire\s*\(|\bmodule\.exports\b|\bexports\.[A-Za-z_$]/;
    for (const script of manifest.content_scripts || []) {
        for (const file of script.js || []) {
            const content = fs.readFileSync(path.join(outDir, file), 'utf8');
            if (moduleSyntax.test(content)) fail(`Classic content script contains module loader (${target}): ${file}`);
        }
    }
}

function validateTarget(target) {
    const config = RELEASE_TARGETS[target];
    const outDir = path.join(root, config.directory);
    const actual = listFiles(outDir);
    const expected = [...RELEASE_FILES_BY_TARGET[target]].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail(`Release allowlist mismatch for ${target}. Expected ${expected.join(', ')}; got ${actual.join(', ')}`);
    }
    for (const file of actual) {
        if (BLOCKED_PATTERNS.some((pattern) => pattern.test(file))) fail(`Blocked file in release directory (${target}): ${file}`);
        if (textExtensions.has(path.extname(file))) {
            const content = fs.readFileSync(path.join(outDir, file), 'utf8');
            if (blockedContentTerm.test(content)) fail(`Legacy Gmail SDK marker in release file (${target}): ${file}`);
        }
    }
    const manifestPath = path.join(outDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) fail(`Dist manifest missing for ${target}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    validateMetadata(manifest, target);
    validateTargetManifest(manifest, target);
    validateManifestReferences(manifest, actual, target);
    validateClassicContentScripts(manifest, outDir, target);
    const icon128 = fs.readFileSync(path.join(outDir, 'icons', 'icon-128.png'));
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!icon128.subarray(0, 8).equals(pngSignature) || icon128.readUInt32BE(16) !== 128 || icon128.readUInt32BE(20) !== 128) {
        fail(`${target} 128px icon is not a 128x128 PNG`);
    }
    console.log(`✅ ${target} release preflight passed (${actual.length} files)`);
}

const targets = requestedTargets();
for (const target of targets) validateTarget(target);

if (targets.length === 2) {
    const sharedFiles = RELEASE_FILES_BY_TARGET.chrome.filter((file) => file !== 'manifest.json');
    for (const file of sharedFiles) {
        const chromeFile = fs.readFileSync(path.join(root, RELEASE_TARGETS.chrome.directory, file));
        const firefoxFile = fs.readFileSync(path.join(root, RELEASE_TARGETS.firefox.directory, file));
        if (!chromeFile.equals(firefoxFile)) fail(`Shared runtime drift between targets: ${file}`);
    }
    console.log('✅ Shared runtime files are byte-identical across targets');
}
