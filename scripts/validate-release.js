const fs = require('fs');
const path = require('path');
const { RELEASE_DIR, RELEASE_FILES, BLOCKED_PATTERNS } = require('./release-allowlist');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, RELEASE_DIR);

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

const manifest = readJson('manifest.json');
const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
if (manifest.version !== '1.2.0' || packageJson.version !== '1.2.0') fail('Version must be 1.2.0 in manifest.json and package.json');
if (manifest.version !== packageJson.version) fail('Manifest/package version mismatch');
if (packageLock.version !== manifest.version || packageLock.packages?.['']?.version !== manifest.version) fail('Package lock version mismatch');
if (manifest.author !== 'Leandro Iramain') fail('Manifest author mismatch');
if (manifest.homepage_url !== 'https://leandroiramain.com.ar') fail('Manifest homepage_url mismatch');
if (packageJson.author !== 'Leandro Iramain') fail('Package author mismatch');
if (packageJson.homepage !== 'https://leandroiramain.com.ar') fail('Package homepage mismatch');

const actual = listFiles(outDir);
const expected = [...RELEASE_FILES].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`Release allowlist mismatch. Expected ${expected.join(', ')}; got ${actual.join(', ')}`);
}

for (const file of actual) {
    if (BLOCKED_PATTERNS.some((pattern) => pattern.test(file))) fail(`Blocked file in release directory: ${file}`);
}

const releaseManifestPath = path.join(outDir, 'manifest.json');
if (!fs.existsSync(releaseManifestPath)) fail('dist manifest missing');
const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'));

const referenced = new Set();
referenced.add(releaseManifest.background?.service_worker);
referenced.add(releaseManifest.action?.default_popup);
Object.values(releaseManifest.action?.default_icon || {}).forEach((file) => referenced.add(file));
Object.values(releaseManifest.icons || {}).forEach((file) => referenced.add(file));
(releaseManifest.content_scripts || []).forEach((script) => {
    (script.js || []).forEach((file) => referenced.add(file));
    (script.css || []).forEach((file) => referenced.add(file));
});
(releaseManifest.web_accessible_resources || []).forEach((resource) => {
    (resource.resources || []).forEach((file) => {
        if (file.endsWith('/*')) {
            const dir = file.slice(0, -2);
            if (!actual.some((candidate) => candidate.startsWith(`${dir}/`))) fail(`Manifest wildcard has no files: ${file}`);
        } else {
            referenced.add(file);
        }
    });
});

for (const file of referenced) {
    if (file && !file.endsWith('/*') && !actual.includes(file)) fail(`Manifest references missing file: ${file}`);
}

console.log('✅ Release preflight passed');
console.log(actual.map((file) => ` - ${file}`).join('\n'));
