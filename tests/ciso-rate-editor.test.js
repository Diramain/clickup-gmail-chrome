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

function response(status, body = {}, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name] || headers[name.toLowerCase()] || null },
        json: async () => body,
    };
}

describe('CISO editor sanitization and rate governor', () => {
    test('editor paste cleaner removes active content, handlers, srcdoc/forms/svg and unsafe URLs', () => {
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        const clean = modal.cleanHtmlForClickUp(`
            <div onclick="x()"><a href="javascript:alert(1)">bad</a><a href="https://ok.test/a">ok</a></div>
            <iframe srcdoc="<script>x()</script>"></iframe><form action="https://evil.test"><button formaction="https://evil.test">x</button></form>
            <svg onload="x()"></svg><p data-x="1">text</p>
        `);
        expect(clean).not.toMatch(/onclick|javascript:|iframe|srcdoc|form|formaction|svg|button|action=/i);
        expect(clean).toContain('https://ok.test/a');
    });

    test('createLink only executes for safe protocols and insertHTML is sanitized', () => {
        document.body.innerHTML = '<div id="cu-editor-visual" contenteditable="true"></div>';
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        modal.modal = document.body;
        modal.showToast = jest.fn();
        document.execCommand = jest.fn();
        global.prompt = jest.fn()
            .mockReturnValueOnce('javascript:alert(1)')
            .mockReturnValueOnce('https://safe.test/path');

        modal.execEditorCommand('createLink');
        expect(document.execCommand).not.toHaveBeenCalled();
        modal.execEditorCommand('createLink');
        expect(document.execCommand).toHaveBeenCalledWith('createLink', false, 'https://safe.test/path');

        modal.insertElement('quote');
        const htmlArg = document.execCommand.mock.calls.find(call => call[0] === 'insertHTML')[2];
        expect(htmlArg).not.toMatch(/on\w+=|javascript:/i);
    });

    test('anchor to Markdown validates URL and unsafe URL becomes plain text', () => {
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        expect(modal.htmlToClickUpMarkdown('<a href="javascript:alert(1)">bad</a> <a href="https://safe.test">ok</a>')).toContain('bad');
        expect(modal.htmlToClickUpMarkdown('<a href="javascript:alert(1)">bad</a>')).not.toContain('](javascript:');
        expect(modal.htmlToClickUpMarkdown('<a href="https://safe.test">ok</a>')).toContain('[ok](https://safe.test)');
    });

    test('ClickUp Markdown round-trips documented task description formatting safely', () => {
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        const markdown = '# Título **importante**\n\n- Uno con _énfasis_\n- Dos con `código`\n\n> Una cita\n\n[seguro](https://safe.test) [inseguro](javascript:alert(1))';
        const html = modal.clickUpMarkdownToHtml(markdown);

        expect(html).toContain('<h1>Título <strong>importante</strong></h1>');
        expect(html).toContain('<ul><li>Uno con <em>énfasis</em></li><li>Dos con <code>código</code></li></ul>');
        expect(html).toContain('<blockquote>Una cita</blockquote>');
        expect(html).toContain('<a href="https://safe.test"');
        expect(html).toContain('>seguro</a>');
        expect(html).not.toMatch(/javascript:/i);
        expect(modal.htmlToClickUpMarkdown(html)).toContain('# Título **importante**');
        expect(modal.htmlToClickUpMarkdown(html)).toContain('- Uno con _énfasis_');
    });

    test('visual code insertion and pasted pre blocks produce documented inline code', () => {
        document.body.innerHTML = '<div id="cu-editor-visual" contenteditable="true"></div>';
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        modal.modal = document.body;
        document.execCommand = jest.fn();

        modal.insertElement('code');
        const htmlArg = document.execCommand.mock.calls.find(call => call[0] === 'insertHTML')[2];
        expect(htmlArg).toContain('<code>');
        expect(htmlArg).not.toContain('<pre');
        expect(modal.htmlToClickUpMarkdown('<pre><code>line 1\nline 2</code></pre>')).toBe('`line 1 line 2`');
    });

    test('thread id helpers escape regex metacharacters and confirm real ids', () => {
        const { commentsContainThreadId, escapeRegExp, isConfirmedThreadId } = loadTsModule('src/link-hardening.ts');
        expect(escapeRegExp('a.*[b](c)')).toBe('a\\.\\*\\[b\\]\\(c\\)');
        expect(commentsContainThreadId([{ comment_text: 'Thread ID: a.*[b](c)' }], 'a.*[b](c)')).toBe(true);
        expect(commentsContainThreadId([{ comment_text: 'Thread ID: axxxb-c' }], 'a.*[b](c)')).toBe(false);
        expect(isConfirmedThreadId('18c93f4d2a9b7c01')).toBe(true);
    });

    test('rate governor defaults to 100 rpm, accelerates on higher limit, and blocks on reset', async () => {
        const { ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        let now = 1000;
        const sleeps = [];
        const governor = new ClickUpRateGovernor(async (ms) => { sleeps.push(ms); now += ms; }, () => now);
        await governor.reserve();
        await governor.reserve();
        expect(sleeps).toEqual([600]);
        governor.observe({ get: (name) => name === 'X-RateLimit-Limit' ? '1000' : null });
        expect(governor.getIntervalMs()).toBe(60);
        governor.observe({ get: (name) => name === 'X-RateLimit-Remaining' ? '0' : name === 'X-RateLimit-Reset' ? String(Math.ceil((now + 5000) / 1000)) : null });
        await governor.reserve();
        expect(sleeps[sleeps.length - 1]).toBeGreaterThanOrEqual(4000);
    });

    test('rate governor serializes concurrent reservations and restores safe persisted cooldown state', async () => {
        const { ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        let now = 1000;
        const sleeps = [];
        const states = [];
        const governor = new ClickUpRateGovernor(
            async (ms) => { sleeps.push(ms); now += ms; },
            () => now,
            { intervalMs: 250, blockedUntil: 1500, ignored: 'nope' },
            (state) => states.push(state)
        );

        await Promise.all([governor.reserve(), governor.reserve(), governor.reserve()]);

        expect(sleeps).toEqual([500, 250, 250]);
        expect(governor.getIntervalMs()).toBe(250);
        expect(governor.getState().blockedUntil).toBe(1500);

        governor.observe({ get: (name) => name === 'X-RateLimit-Limit' ? '120' : null });
        expect(states[states.length - 1]).toEqual({ intervalMs: 500, blockedUntil: 1500 });

        const invalid = new ClickUpRateGovernor(async () => undefined, () => now, { intervalMs: 1, blockedUntil: -10 });
        expect(invalid.getIntervalMs()).toBe(600);
        expect(invalid.getState().blockedUntil).toBe(0);

        const absurd = new ClickUpRateGovernor(async () => undefined, () => now, { intervalMs: 600, blockedUntil: now + 10 * 24 * 60 * 60 * 1000 });
        expect(absurd.getState().blockedUntil).toBe(0);
    });

    test('429 Retry-After defers the governor globally before local retry sleep', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        let now = 1000;
        const sleeps = [];
        const states = [];
        const governor = new ClickUpRateGovernor(async (ms) => { sleeps.push(ms); now += ms; }, () => now, null, (state) => states.push(state));
        const api = new ClickUpAPIWrapper('token', governor);
        api.sleep = async (ms) => { sleeps.push(ms); now += ms; };
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(429, {}, { 'Retry-After': '2' }))
            .mockResolvedValueOnce(response(200, { ok: true }));

        await expect(api.getUser()).resolves.toEqual({ ok: true });

        expect(states.some(state => state.blockedUntil >= 3000)).toBe(true);
        expect(governor.getState().blockedUntil).toBeGreaterThanOrEqual(3000);
        expect(sleeps.some(ms => ms >= 2000)).toBe(true);
    });

    test('reserve recalculates blockedUntil when deferFor happens during an in-flight wait', async () => {
        const { ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        let now = 1000;
        const sleeps = [];
        let governor;
        governor = new ClickUpRateGovernor(async (ms) => {
            sleeps.push(ms);
            if (sleeps.length === 1) governor.deferFor(1000);
        }, () => now);

        await governor.reserve();
        await governor.reserve();

        expect(sleeps).toEqual([600, 400]);
        expect(governor.getState().blockedUntil).toBe(2000);
    });

    test('requests use governor, retry 429, and upload FormData avoids manual Content-Type', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        const governor = new ClickUpRateGovernor(async () => undefined, () => Date.now());
        const api = new ClickUpAPIWrapper('token', governor);
        api.sleep = async () => undefined;
        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(429, {}, { 'Retry-After': '0' }))
            .mockResolvedValueOnce(response(200, { ok: true }))
            .mockResolvedValueOnce(response(200, { upload: true }));

        await expect(api.request('/user')).resolves.toEqual({ ok: true });
        await expect(api.uploadAttachment('task1', '<p>safe</p>', 'Subject', { threadId: 'thread1', subject: 'Subject', from: 'a', html: '<p>safe</p>', htmlSanitized: true })).resolves.toEqual({ upload: true });

        expect(global.fetch).toHaveBeenCalledTimes(3);
        const uploadInit = global.fetch.mock.calls[2][1];
        expect(uploadInit.body).toBeInstanceOf(FormData);
        expect(uploadInit.headers.Authorization).toBe('token');
        expect(uploadInit.headers['Content-Type']).toBeUndefined();
    });

    test('does not retry non-idempotent POST on 5xx/network but retries safe GET', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper('token', new ClickUpRateGovernor(async () => undefined, () => Date.now()));
        api.sleep = async () => undefined;

        global.fetch = jest.fn()
            .mockResolvedValueOnce(response(500, { err: 'server failed' }))
            .mockResolvedValueOnce(response(500, { err: 'server failed' }))
            .mockResolvedValueOnce(response(200, { ok: true }));

        await expect(api.createTask('list1', { name: 'Task' })).rejects.toThrow('server failed');
        expect(global.fetch).toHaveBeenCalledTimes(1);

        await expect(api.getUser()).resolves.toEqual({ ok: true });
        expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test('does not retry non-idempotent POST on fetch network failure', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper('token', new ClickUpRateGovernor(async () => undefined, () => Date.now()));
        api.sleep = async () => undefined;
        const networkError = new TypeError('fetch failed');
        global.fetch = jest.fn().mockRejectedValue(networkError);

        await expect(api.addComment('task1', 'comment')).rejects.toThrow('fetch failed');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('uploadAttachment requires sanitized HTML marker before upload', async () => {
        const { ClickUpAPIWrapper, ClickUpRateGovernor } = loadTsModule('src/services/api.service.ts');
        const api = new ClickUpAPIWrapper('token', new ClickUpRateGovernor(async () => undefined, () => Date.now()));
        global.fetch = jest.fn();

        await expect(api.uploadAttachment('task1', '<p>unsafe marker missing</p>', 'Subject', { threadId: 'thread1', subject: 'Subject', from: 'a' })).rejects.toThrow('sanitizado');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('static gates block remote file upload, sensitive console payloads, and verify renderer reconciliation helpers', () => {
        const api = source('src/services/api.service.ts');
        expect(api).not.toMatch(/uploadFileFromUrl|credentials:\s*['"]include['"]/);

        const sources = ['src/logger.ts', 'src/services/api.service.ts', 'popup/popup.ts', 'src/clickup-tracker.ts'].map(source).join('\n');
        const forbiddenConsolePayload = /console\.(log|warn|error|info|debug)\([^\n]*(payload|response|storage|email|member|team|task|token)[^\n]*,/i;
        expect(sources).not.toMatch(forbiddenConsolePayload);

        const { ensureThreadBar, shouldRunThreadValidation } = loadTsModule('src/gmail-render-utils.ts');
        document.body.innerHTML = '<div id="container"><div id="body"><div class="cu-email-bar" data-thread-id="old"></div></div></div>';
        const container = document.getElementById('container');
        const body = document.getElementById('body');
        const reconcile = jest.fn();
        ensureThreadBar(container, body, 'new', id => Object.assign(document.createElement('div'), { className: 'cu-email-bar' }), reconcile);
        expect(body.querySelectorAll('.cu-email-bar')).toHaveLength(1);
        expect(body.querySelector('.cu-email-bar').dataset.threadId).toBe('new');
        expect(reconcile).toHaveBeenCalledWith(expect.any(HTMLElement), 'new');
        expect(shouldRunThreadValidation([{ id: 't', name: 'n', url: 'u', createdAt: 1, updatedAt: 1, lastValidatedAt: Date.now() }], Date.now())).toBe(false);
    });
});
