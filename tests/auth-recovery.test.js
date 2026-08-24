const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const compiled = ts.transpileModule(source(relativePath), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    const localRequire = (request) => {
        if (request.startsWith('.')) {
            const resolved = path.normalize(path.join(path.dirname(relativePath), request)) + '.ts';
            return loadTsModule(resolved);
        }
        return require(request);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

function response(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => body,
        clone() { return response(status, body); },
    };
}

function sectionBetween(text, start, end) {
    const startIndex = text.indexOf(start);
    const endIndex = text.indexOf(end, startIndex + start.length);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    return text.slice(startIndex, endIndex);
}

describe('ClickUp authentication recovery', () => {
    test('OAuth access tokens support raw compatibility and exactly one Bearer prefix', () => {
        const { formatClickUpAuthorization } = loadTsModule('src/services/api.service.ts');

        expect(formatClickUpAuthorization('synthetic-oauth-token')).toBe('Bearer synthetic-oauth-token');
        expect(formatClickUpAuthorization('Bearer synthetic-oauth-token')).toBe('Bearer synthetic-oauth-token');
        expect(formatClickUpAuthorization('synthetic-oauth-token', 'raw')).toBe('synthetic-oauth-token');
        expect(formatClickUpAuthorization('Bearer synthetic-oauth-token', 'raw')).toBe('synthetic-oauth-token');
    });

    test('GET 401 falls back from raw to Bearer once and preserves a valid session', async () => {
        const {
            ClickUpAPIWrapper,
            ClickUpRateGovernor,
        } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-oauth-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'raw',
        );
        const invalidate = jest.fn().mockResolvedValue(true);
        const modeChanged = jest.fn().mockResolvedValue(undefined);
        api.setAuthenticationFailureCallback(invalidate);
        api.setAuthorizationModeChangeCallback(modeChanged);
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(401, { err: 'synthetic unauthorized' }))
            .mockResolvedValueOnce(response(200, { user: { id: 1 } }));

        await expect(api.getUser()).resolves.toEqual({ user: { id: 1 } });
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('synthetic-oauth-token');
        expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer synthetic-oauth-token');
        expect(modeChanged).toHaveBeenCalledWith('bearer');
        expect(invalidate).not.toHaveBeenCalled();
    });

    test('user rejected by both authorization schemes invalidates once', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor, isReauthenticationRequired } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-oauth-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'raw',
        );
        const invalidate = jest.fn().mockResolvedValue(true);
        api.setAuthenticationFailureCallback(invalidate);
        global.fetch = jest.fn().mockResolvedValue(response(401));

        let error;
        try {
            await api.getUser();
        } catch (caught) {
            error = caught;
        }
        expect(error).toMatchObject({ status: 401, requiresReauth: true });
        expect(isReauthenticationRequired(error)).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(invalidate).toHaveBeenCalledWith('synthetic-oauth-token');
        expect(invalidate).toHaveBeenCalledTimes(1);
    });

    test('endpoint-specific 401 keeps session when user probe succeeds', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor, isReauthenticationRequired } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-oauth-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'raw',
        );
        const invalidate = jest.fn().mockResolvedValue(true);
        api.setAuthenticationFailureCallback(invalidate);
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(401))
            .mockResolvedValueOnce(response(401))
            .mockResolvedValueOnce(response(200, { user: { id: 1 } }));

        let error;
        try {
            await api.getTask('synthetic-task');
        } catch (caught) {
            error = caught;
        }
        expect(error).toMatchObject({ status: 401 });
        expect(isReauthenticationRequired(error)).toBe(false);
        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(invalidate).not.toHaveBeenCalled();
    });

    test('endpoint-specific team authorization code is preserved but arbitrary API text is discarded', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor, sanitizeClickUpErrorCode } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-oauth-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'raw',
        );
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(401, { err: 'do not persist this', ECODE: 'OAUTH_027' }))
            .mockResolvedValueOnce(response(401, { err: 'do not persist this', ECODE: 'OAUTH_027' }))
            .mockResolvedValueOnce(response(200, { user: { id: 1 } }));

        await expect(api.getTask('synthetic-task')).rejects.toMatchObject({
            status: 401,
            clickupCode: 'OAUTH_027',
        });
        expect(sanitizeClickUpErrorCode('OAUTH_023')).toBe('OAUTH_023');
        expect(sanitizeClickUpErrorCode('OAUTH_045')).toBe('OAUTH_045');
        expect(sanitizeClickUpErrorCode('FIELD_033')).toBe('FIELD_033');
        expect(sanitizeClickUpErrorCode('OAUTH_999')).toBeUndefined();
        expect(sanitizeClickUpErrorCode('sensitive text')).toBeUndefined();
    });

    test('workspace task fallback filters by one exact task ID and rejects non-exact results', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-oauth-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'bearer',
        );
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(200, { tasks: [{ id: 'TASK-B', name: 'B' }, { id: 'OTHER', name: 'Other' }] }))
            .mockResolvedValueOnce(response(200, { tasks: [{ id: 'OTHER', name: 'Other' }] }));

        await expect(api.getWorkspaceTaskById('TEAM-1', 'TASK-B')).resolves.toEqual(expect.objectContaining({ id: 'TASK-B' }));
        await expect(api.getWorkspaceTaskById('TEAM-1', 'MISSING')).resolves.toBeNull();
        const firstUrl = global.fetch.mock.calls[0][0];
        expect(firstUrl).toContain('/team/TEAM-1/task?');
        expect(firstUrl).toContain('include_closed=true');
        expect(firstUrl).toContain('subtasks=true');
        expect(firstUrl).toContain('task_ids%5B%5D=TASK-B');
    });

    test('cleanup failure cannot downgrade a confirmed ClickUp 401', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-oauth-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'raw',
        );
        api.setAuthenticationFailureCallback(jest.fn().mockRejectedValue(new Error('synthetic cleanup failure')));
        global.fetch = jest.fn().mockResolvedValue(response(401));

        await expect(api.getUser()).rejects.toMatchObject({ status: 401, requiresReauth: true });
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('transient upstream failure retries safely without invalidating authentication', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor, isReauthenticationRequired } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-oauth-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'raw',
        );
        const invalidate = jest.fn().mockResolvedValue(true);
        api.setAuthenticationFailureCallback(invalidate);
        api.sleep = async () => undefined;
        global.fetch = jest.fn().mockResolvedValue(response(503, { err: 'synthetic unavailable' }));

        let error;
        try {
            await api.getUser();
        } catch (caught) {
            error = caught;
        }

        expect(error).toMatchObject({ status: 503 });
        expect(isReauthenticationRequired(error)).toBe(false);
        expect(global.fetch).toHaveBeenCalledTimes(4);
        expect(invalidate).not.toHaveBeenCalled();
    });

    test('background clears rejected session state but keeps encrypted OAuth configuration', () => {
        const background = source('background.ts');
        const invalidation = sectionBetween(
            background,
            'async function invalidateAuthenticationSession',
            '\nvoid initializeAPI()',
        );
        const initialization = sectionBetween(
            background,
            'async function initializeAPI',
            '\nasync function invalidateAuthenticationSession',
        );
        const status = sectionBetween(
            background,
            'async function getAuthenticationStatus',
            '\nfunction runTimerWrite',
        );
        const taskValidation = sectionBetween(
            background,
            'async function validateFocusedTask',
            '\nasync function persistFocusedTimerState',
        );

        expect(invalidation).toContain('currentToken !== rejectedToken');
        expect(invalidation).toContain('STALE_AUTH_FAILURE_IGNORED');
        expect(invalidation).toContain('removeSecureToken(STORAGE_KEYS.AUTH_TOKEN)');
        expect(invalidation).toContain('removeSecureToken(STORAGE_KEYS.REFRESH_TOKEN)');
        expect(invalidation).toContain('STORAGE_KEYS.CACHED_USER');
        expect(invalidation).toContain('[STORAGE_KEYS.REAUTH_REQUIRED]: true');
        expect(invalidation).not.toContain('STORAGE_KEYS.OAUTH_CONFIG');
        expect(initialization).toContain('authState[STORAGE_KEYS.REAUTH_REQUIRED] === true');
        expect(initialization).toContain('latestToken !== token');
        expect(initialization).toContain('currentToken === token');
        expect(initialization.indexOf('const api = new ClickUpAPIWrapper'))
            .toBeLessThan(initialization.indexOf('clickupAPI = api'));
        expect(status).toContain('CURRENT_USER_VALIDATED_AT');
        expect(status).toContain('CURRENT_USER_VALIDATION_TTL_MS');
        expect(status).toContain('getFreshAuthenticatedUser()');
        expect(status).not.toContain('getCachedUser()');
        expect(status).toContain('authUnavailable: true');
        expect(taskValidation).toContain('if (isReauthenticationRequired(error)) throw error;');
        expect(background).toContain("scheduleFocusedTimerEvaluation('authenticated')");
        expect(background).toContain("meetPrioritySession.status !== 'ignored'");
    });

    test('late 401 from an old wrapper cannot delete a newly connected token', () => {
        const background = source('background.ts');
        const invalidation = sectionBetween(
            background,
            'async function invalidateAuthenticationSession',
            '\nvoid initializeAPI()',
        );

        expect(invalidation.indexOf('getSecureToken(STORAGE_KEYS.AUTH_TOKEN)'))
            .toBeLessThan(invalidation.indexOf('removeSecureToken(STORAGE_KEYS.AUTH_TOKEN)'));
        expect(invalidation.indexOf('currentToken !== rejectedToken'))
            .toBeLessThan(invalidation.indexOf('clickupAPI = null'));
        expect(invalidation.indexOf('clickupAPI = null'))
            .toBeLessThan(invalidation.indexOf('removeSecureToken(STORAGE_KEYS.AUTH_TOKEN)'));
        expect(invalidation).toContain('currentToken !== rejectedToken');
        expect(invalidation).toContain("Logger.warn('STALE_AUTH_FAILURE_IGNORED')");
        expect(invalidation).toMatch(/currentToken !== rejectedToken[\s\S]{0,160}return false;/);
        expect(background).toContain('authenticationStateQueue.then(operation, operation)');
        expect(background).toMatch(/case 'authenticate':[\s\S]*runAuthenticationStateMutation/);
        expect(background).toMatch(/case 'logout':[\s\S]*runAuthenticationStateMutation/);
        const authenticate = sectionBetween(background, "case 'authenticate':", "case 'saveOAuthConfig':");
        expect(authenticate.indexOf('await runAuthenticationStateMutation'))
            .toBeLessThan(authenticate.indexOf('const user = await getFreshAuthenticatedUser()'));
        const authMutation = authenticate.match(/await runAuthenticationStateMutation\(async \(\) => \{([\s\S]*?)\n                \}\);/)[1];
        expect(authMutation).not.toContain('getFreshAuthenticatedUser');
        expect(authMutation).toContain('STORAGE_KEYS.CACHED_TEAMS');
        expect(authMutation).toContain('STORAGE_KEYS.CACHED_HIERARCHY');
        expect(authenticate).toContain('await getTeams(true)');
        expect(background).toMatch(/async function getTeams\(forceRefresh = false\)/);
        expect(background).toMatch(/reconcilePreferredTeamSelection/);
    });

    test('stale rejected token does not request reconnection', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor, isReauthenticationRequired } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-old-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'raw',
        );
        const invalidate = jest.fn().mockResolvedValue(false);
        api.setAuthenticationFailureCallback(invalidate);
        global.fetch = jest.fn().mockResolvedValue(response(401));

        let error;
        try {
            await api.getUser();
        } catch (caught) {
            error = caught;
        }

        expect(error).toMatchObject({ status: 401, requiresReauth: false });
        expect(isReauthenticationRequired(error)).toBe(false);
        expect(invalidate).toHaveBeenCalledWith('synthetic-old-token');
    });

    test('non-idempotent 401 probes user but never replays the write', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor, isReauthenticationRequired } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper(
            'synthetic-oauth-token',
            new ClickUpRateGovernor(async () => undefined, () => Date.now()),
            'raw',
        );
        const invalidate = jest.fn().mockResolvedValue(true);
        api.setAuthenticationFailureCallback(invalidate);
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(401))
            .mockResolvedValueOnce(response(200, { user: { id: 1 } }));

        let error;
        try {
            await api.addComment('synthetic-task', 'synthetic comment');
        } catch (caught) {
            error = caught;
        }

        expect(error).toMatchObject({ status: 401 });
        expect(isReauthenticationRequired(error)).toBe(false);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch.mock.calls[0][1].method).toBe('POST');
        expect(global.fetch.mock.calls[1][0]).toContain('/user');
        expect(global.fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
        expect(invalidate).not.toHaveBeenCalled();
    });

    test('runtime contains no undocumented refresh grant and popup exposes reconnection', () => {
        const runtime = [
            source('background.ts'),
            source('src/services/api.service.ts'),
            source('src/services/auth.service.ts'),
        ].join('\n');
        const popup = source('popup/popup.ts');
        const background = source('background.ts');

        expect(runtime).not.toMatch(/refresh_token|grant_type:\s*['"]refresh_token|AUTH_RETRY|setTokenRefreshCallback/);
        expect(runtime).toContain("ClickUpAuthorizationMode = 'raw' | 'bearer'");
        expect(background).toMatch(/async function evaluateFocusedTimer[\s\S]{0,300}REAUTH_REQUIRED/);
        expect(popup).toContain('Reconectar con ClickUp');
        expect(popup).toContain('La sesión de ClickUp dejó de ser válida. Reconectá para reanudar el seguimiento automático.');
        expect(popup).toContain('response.requiresReauth === true');
        expect(source('popup/popup.html')).not.toContain('testTokenRefresh');
        expect(source('src/services/auth.service.ts')).toContain('authenticated: hasToken && !requiresReauth');
    });

    test('logout cannot be blocked by a failed remote Meet stop', () => {
        const background = source('background.ts');
        const logout = sectionBetween(background, "case 'logout':", "case 'checkAuth':");

        expect(logout).toMatch(/try\s*\{[\s\S]*endMeetSession\('logout'\)[\s\S]*\}\s*catch/);
        expect(logout).toContain("Logger.warn('LOGOUT_REMOTE_TIMER_UNVERIFIED')");
        expect(logout).toContain('meetPrioritySession = null');
        expect(logout).toContain('removeSecureToken(STORAGE_KEYS.AUTH_TOKEN)');
        expect(logout).toContain('chrome.storage.session.remove([');
    });
});
