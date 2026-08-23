const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { RELEASE_TARGETS, requestedTargets, releaseArchiveName } = require('./release-allowlist');
const { createDeterministicZip } = require('./deterministic-zip');

const root = path.resolve(__dirname, '..');
const artifactsDirectory = path.join(root, 'dist', 'artifacts');
const hashes = [];
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

fs.rmSync(artifactsDirectory, { recursive: true, force: true });
fs.mkdirSync(artifactsDirectory, { recursive: true });
for (const target of requestedTargets()) {
    const config = RELEASE_TARGETS[target];
    const sourceDirectory = path.join(root, config.directory);
    if (!fs.existsSync(sourceDirectory)) throw new Error(`Missing ${target} release directory`);
    const archive = releaseArchiveName(target, version);
    const archivePath = path.join(artifactsDirectory, archive);
    createDeterministicZip(sourceDirectory, archivePath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    hashes.push(`${hash}  ${archive}`);
    console.log(`✅ ${target} ZIP: ${archive} (${hash})`);
}

fs.writeFileSync(path.join(artifactsDirectory, 'SHA256SUMS'), `${hashes.join('\n')}\n`);
