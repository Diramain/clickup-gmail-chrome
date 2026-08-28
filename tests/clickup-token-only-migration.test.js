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

describe('ClickUp token-only migration', () => {
    const validToken = `pk_${'a'.repeat(24)}`;
    const { planClickUpTokenOnlyMigration } = loadTsModule('src/clickup-auth.ts');
    const { applyClickUpTokenOnlyMigration } = loadTsModule('src/clickup-auth-migration.ts');
    const { AuthenticationOperationCoordinator } = loadTsModule('src/auth-operation-coordinator.ts');

    test('preserves only a valid token with explicit personal-token provenance', () => {
        expect(planClickUpTokenOnlyMigration(validToken, 'personal-token', false, false, true)).toEqual({
            personalToken: validToken,
            requiresReauth: false,
        });
        expect(planClickUpTokenOnlyMigration(`Bearer ${validToken}`, 'personal-token', false, false, true, 'bearer')).toEqual({
            personalToken: validToken,
            requiresReauth: false,
        });
    });

    test.each([
        ['legacy OAuth token', 'oauth_access_token', 'oauth', true, false, true, undefined],
        ['OAuth state with a pk-shaped value', validToken, 'oauth', true, false, true, undefined],
        ['legacy OAuth config without token', null, 'oauth', true, false, false, undefined],
        ['previously invalidated personal token', validToken, 'personal-token', false, true, true, undefined],
        ['corrupt stored credential', null, 'personal-token', false, false, true, undefined],
        ['ambiguous Bearer-wrapped token', `Bearer ${validToken}`, undefined, false, false, true, undefined],
        ['ambiguous bearer authorization mode', validToken, undefined, false, false, true, 'bearer'],
    ])('retires %s and requires a personal-token reconnect', (_name, token, method, config, reauth, stored, authorizationMode) => {
        expect(planClickUpTokenOnlyMigration(token, method, config, reauth, stored, authorizationMode)).toEqual({
            personalToken: null,
            requiresReauth: true,
        });
    });

    test('keeps a fresh profile unconfigured without a false reconnect warning', () => {
        expect(planClickUpTokenOnlyMigration(null, undefined, false, false, false)).toEqual({
            personalToken: null,
            requiresReauth: false,
        });
    });

    test('runs cleanup before API initialization and keeps Google Calendar OAuth separate', () => {
        const background = source('background.ts');
        const firefoxManifest = JSON.parse(source('manifest.firefox.json'));
        const chromeManifest = JSON.parse(source('manifest.json'));

        expect(background).toMatch(/async function initializeAPIOnce\(\)[\s\S]{0,120}await ensureClickUpTokenOnlyMigration\(\)/);
        expect(background).toContain('runAuthenticationStateMutation(migrateClickUpTokenOnlyState)');
        expect(background).toContain('STORAGE_KEYS.OAUTH_CONFIG');
        expect(background).toContain('STORAGE_KEYS.DRAFT_CLIENT_SECRET');
        expect(background).toContain('STORAGE_KEYS.CACHED_HIERARCHY');
        expect(background).toContain('CLICKUP_TASK_TAB_INDEX_SESSION_KEY');
        expect(background).not.toMatch(/api\/v2\/oauth\/token|client_secret|saveOAuthConfig/);
        expect(firefoxManifest.permissions).not.toContain('identity');
        expect(firefoxManifest.oauth2).toBeUndefined();
        expect(chromeManifest.permissions).toContain('identity');
        expect(chromeManifest.oauth2.scopes).toEqual([
            'https://www.googleapis.com/auth/calendar.events.owned.readonly',
        ]);
    });

    test.each(['mark', 'legacy', 'credential', 'account'])(
        'fails closed and remains retryable when %s cleanup fails',
        async (failedStep) => {
            let reauthRequired = false;
            const events = [];
            const operations = (failure) => ({
                markReauthRequired: async () => {
                    events.push('mark');
                    if (failure === 'mark') throw new Error('injected');
                    reauthRequired = true;
                },
                removeLegacyAuthState: async () => {
                    events.push('legacy');
                    if (failure === 'legacy') throw new Error('injected');
                },
                preservePersonalToken: async () => events.push('preserve'),
                retireCredential: async () => {
                    events.push('credential');
                    if (failure === 'credential') throw new Error('injected');
                },
                clearAccountBoundary: async () => {
                    events.push('account');
                    if (failure === 'account') throw new Error('injected');
                },
            });
            const migration = { personalToken: null, requiresReauth: true };

            await expect(applyClickUpTokenOnlyMigration(migration, operations(failedStep))).rejects.toThrow('injected');
            expect(events[0]).toBe('mark');
            expect(reauthRequired).toBe(failedStep === 'mark' ? false : true);

            events.length = 0;
            await expect(applyClickUpTokenOnlyMigration(migration, operations(null))).resolves.toBeUndefined();
            expect(events).toEqual(['mark', 'legacy', 'credential', 'account']);
            expect(reauthRequired).toBe(true);
        },
    );

    test('serializes login and logout without holding the auth-state lock across remote calls', () => {
        const background = source('background.ts');
        const login = background.slice(
            background.indexOf("case 'authenticatePersonalToken':"),
            background.indexOf("case 'logout':"),
        );
        const logout = background.slice(
            background.indexOf("case 'logout':"),
            background.indexOf("case 'checkAuth':"),
        );

        expect(login.indexOf('return runAuthenticationOperation')).toBeLessThan(login.indexOf('candidateApi.getUser()'));
        expect(login.indexOf('candidateApi.getUser()')).toBeLessThan(login.indexOf('runAuthenticationStateMutation'));
        expect(login.indexOf('runAuthenticationStateMutation')).toBeLessThan(login.indexOf('await initializeAPI()'));
        expect(logout.indexOf('return runAuthenticationOperation')).toBeLessThan(logout.indexOf("endMeetSession('logout')"));
        expect(logout.indexOf("endMeetSession('logout')")).toBeLessThan(logout.indexOf('runAuthenticationStateMutation'));
        expect(background).toContain('authenticationCoordinator.runOperation(operation)');
        expect(background).toMatch(/attempt\.catch\(\(error\) => \{[\s\S]{0,120}clickUpAuthMigrationPromise = null/);
    });

    test('a timer 401 can mutate auth state while logout waits without deadlocking', async () => {
        const coordinator = new AuthenticationOperationCoordinator();
        let timerQueue = Promise.resolve();
        const events = [];
        const runTimerWrite = (operation) => {
            const result = timerQueue.then(operation, operation);
            timerQueue = result.then(() => undefined, () => undefined);
            return result;
        };

        const timerWork = runTimerWrite(async () => {
            events.push('timer-start');
            await coordinator.runStateMutation(async () => events.push('401-invalidated'));
            events.push('timer-end');
        });
        const logout = coordinator.runOperation(async () => {
            await timerWork;
            await coordinator.runStateMutation(async () => events.push('logout-cleanup'));
        });

        await expect(Promise.race([
            logout.then(() => 'completed'),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 250)),
        ])).resolves.toBe('completed');
        expect(events).toEqual(['timer-start', '401-invalidated', 'timer-end', 'logout-cleanup']);
    });

    test('migrates before snapshotting authentication status', () => {
        const background = source('background.ts');
        const status = background.slice(
            background.indexOf('async function getAuthenticationStatus'),
            background.indexOf('function runTimerWrite'),
        );
        expect(status.indexOf('await ensureClickUpTokenOnlyMigration()'))
            .toBeLessThan(status.indexOf('hasSecureToken(STORAGE_KEYS.AUTH_TOKEN)'));
    });
});
