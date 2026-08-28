const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(source(relativePath), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

describe('CGC-UX-V2-C1 local connections state', () => {
    const { classifyLocalClickUpStatus } = loadTsModule('src/connections-state.ts');

    test.each([
        [{ configured: false, credentialPresent: false, requiresReauth: false }, 'unconfigured'],
        [{ configured: true, credentialPresent: false, requiresReauth: false }, 'configured'],
        [{ configured: false, credentialPresent: true, requiresReauth: false }, 'connected-local'],
        [{ configured: true, credentialPresent: true, requiresReauth: false }, 'connected-local'],
        [{ configured: true, credentialPresent: true, requiresReauth: true }, 'reauth-required'],
        [null, 'unavailable'],
        [{ configured: true, credentialPresent: 'yes', requiresReauth: false }, 'unavailable'],
    ])('classifies %j as %s', (input, expected) => {
        expect(classifyLocalClickUpStatus(input).state).toBe(expected);
    });

    test('background action is local-only and returns no identity or credential value', () => {
        const background = source('background.ts');
        const action = background.match(/case 'getLocalConnectionStatus':[\s\S]*?\n\s*}\n/)[0];

        expect(action).toContain('hasSecureToken');
        expect(action).toContain('configured: credentialPresent');
        expect(action).not.toMatch(/fetch\(|getFreshAuthenticatedUser|ensureAPI|token:|user:|oauthConfig:/);
    });

    test('V2 exposes an accessible status while Google remains blocked', () => {
        document.documentElement.innerHTML = source('app/app.html');
        const clickUpState = document.getElementById('clickUpConnectionState');
        const googleButton = document.getElementById('connectGoogleCalendarSetup');

        expect(clickUpState.getAttribute('role')).toBe('status');
        expect(clickUpState.getAttribute('aria-live')).toBe('polite');
        expect(clickUpState.dataset.state).toBe('loading');
        expect(googleButton.disabled).toBe(true);
        expect(source('app/app.ts')).toContain("action: 'getLocalConnectionStatus'");
        expect(source('app/app.ts')).toContain("document.addEventListener('clickup-auth-changed'");
        expect(source('app/app.css')).toMatch(/#calendarConnectionLink\s*\{[\s\S]*var\(--state-error\)/);
        expect(source('app/app.css')).toContain('#calendarConnectionLink[hidden] { display: none; }');
        expect(source('app/app.ts')).not.toMatch(/action:\s*['"](?:authenticate|logout|saveOAuthConfig|getStatus)['"]/);
    });

    test('message allowlist accepts only the new read-only action for this bridge', () => {
        expect(source('src/message-security.ts')).toContain("'getLocalConnectionStatus'");
        expect(source('src/types/clickup.d.ts')).toContain("| 'getLocalConnectionStatus'");
    });
});
