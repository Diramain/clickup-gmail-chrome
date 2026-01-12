/**
 * Build script for Chrome extension
 * Compiles TypeScript and bundles with esbuild
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const isWatch = process.argv.includes('--watch');
const skipTypeCheck = process.argv.includes('--skip-typecheck');

// Ensure dist directory exists
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

/**
 * TypeScript files to compile
 * Currently running .js in parallel while migrating
 */
const tsEntryPoints = [
    // Background service worker
    { in: 'background.ts', out: 'background' },
    // Popup
    { in: 'popup/popup.ts', out: 'popup/popup' },
    // Content scripts
    { in: 'src/logger.ts', out: 'src/logger' },
    { in: 'src/gmail-adapter.ts', out: 'src/gmail-adapter' },
    { in: 'src/gmail-native.ts', out: 'src/gmail-native' },
    { in: 'src/modal.ts', out: 'src/modal' },
];

/**
 * JavaScript files to bundle (legacy, will be removed after full migration)
 */
const jsEntryPoints = [
    { in: 'src/content.js', out: 'dist/content' },
];

const commonBuildOptions = {
    bundle: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100'],
    sourcemap: isWatch ? 'inline' : false,
    minify: !isWatch,
};

async function typeCheck() {
    if (skipTypeCheck) {
        console.log('⏩ Skipping type check');
        return true;
    }

    console.log('🔍 Running TypeScript type check...');
    try {
        execSync('npx tsc --noEmit', {
            cwd: __dirname,
            stdio: 'inherit'
        });
        console.log('✅ Type check passed');
        return true;
    } catch (error) {
        console.error('❌ Type check failed');
        return false;
    }
}

async function buildTypeScript() {
    console.log('📦 Building TypeScript files...');

    try {
        await esbuild.build({
            ...commonBuildOptions,
            entryPoints: tsEntryPoints,
            outdir: '.',
            outExtension: { '.js': '.js' },
            loader: { '.ts': 'ts' },
            // Don't bundle - let content scripts load separately
            bundle: false,
        });
        console.log('✅ TypeScript build completed');
        return true;
    } catch (error) {
        console.error('❌ TypeScript build failed:', error);
        return false;
    }
}

async function buildJavaScript() {
    // SKIPPED: content.js is legacy InboxSDK code
    // Current implementation uses gmail-native.js which is loaded directly
    console.log('⏩ Skipping legacy JavaScript bundle (gmail-native.js is used instead)');
    return true;
}

async function build() {
    console.log('🚀 Starting build...\n');

    // Step 1: Type check (optional)
    const typeCheckPassed = await typeCheck();
    if (!typeCheckPassed && !skipTypeCheck) {
        console.log('\n💡 Tip: Run with --skip-typecheck to skip type checking');
        process.exit(1);
    }

    // Step 2: Build TypeScript
    const tsBuildPassed = await buildTypeScript();
    if (!tsBuildPassed) {
        process.exit(1);
    }

    // Step 3: Build JavaScript (legacy)
    const jsBuildPassed = await buildJavaScript();
    if (!jsBuildPassed) {
        process.exit(1);
    }

    console.log('\n✨ Build completed successfully!');

    if (isWatch) {
        console.log('\n👀 Watching for changes...');
        // Watch mode with esbuild
        const ctx = await esbuild.context({
            ...commonBuildOptions,
            entryPoints: tsEntryPoints,
            outdir: '.',
            outExtension: { '.js': '.js' },
            loader: { '.ts': 'ts' },
            bundle: false,
        });
        await ctx.watch();
    }
}

build();
