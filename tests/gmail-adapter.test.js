const path = require('path');
const fs = require('fs');
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

const { GmailAdapter } = loadTsModule('src/gmail-adapter.ts');
const { ensureThreadBar } = loadTsModule('src/gmail-render-utils.ts');

describe('GmailAdapter production selectors', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('imports production TypeScript adapter', () => {
        expect(GmailAdapter.SELECTORS.emailBody).toContain('.a3s.aiL');
    });

    test('prefers nested .a3s.aiL and excludes duplicate .ii.gt ancestor', () => {
        document.body.innerHTML = `
            <div class="gs">
              <div><div class="ii gt"><div class="a3s aiL">primary</div></div></div>
            </div>
        `;

        const bodies = GmailAdapter.getAllEmailBodies();

        expect(bodies).toHaveLength(1);
        expect(bodies[0].className).toContain('a3s');
        expect(bodies[0].textContent).toBe('primary');
        expect(GmailAdapter.getEmailBodyElement()).toBe(bodies[0]);
    });

    test('uses .ii.gt fallback only when no primary body is contained', () => {
        document.body.innerHTML = '<div class="ii gt">fallback</div>';

        const bodies = GmailAdapter.getAllEmailBodies();

        expect(bodies).toHaveLength(1);
        expect(bodies[0].className).toContain('ii');
    });

    test('filters disconnected bodies', () => {
        document.body.innerHTML = '<div class="a3s aiL">connected</div>';
        const disconnected = document.createElement('div');
        disconnected.className = 'a3s aiL';
        jest.spyOn(document, 'querySelectorAll').mockImplementation((selector) => {
            if (selector === '.a3s.aiL') return [document.querySelector('.a3s.aiL'), disconnected].filter(Boolean);
            if (selector === '.ii.gt') return [];
            return Document.prototype.querySelectorAll.call(document, selector);
        });

        expect(GmailAdapter.getAllEmailBodies()).toHaveLength(1);
    });

    test('returns null instead of timestamp fallback when thread id is unconfirmed', () => {
        window.location.hash = '#inbox';
        document.body.innerHTML = '<main role="main"></main>';

        expect(GmailAdapter.getThreadId()).toBeNull();
    });
});

describe('Gmail thread bar mounting', () => {
    function createBar(threadId) {
        const bar = document.createElement('div');
        bar.className = 'cu-email-bar';
        bar.dataset.threadId = threadId || '';
        const button = document.createElement('button');
        button.className = 'cu-add-btn';
        button.disabled = !threadId;
        bar.appendChild(button);
        return bar;
    }

    test('mounts before body using body.parentElement, even with nested Gmail ancestors', () => {
        document.body.innerHTML = '<div class="gs"><div class="wrap"><div class="ii gt"><div class="a3s aiL">body</div></div></div></div>';
        const body = document.querySelector('.a3s.aiL');
        const host = body.parentElement;
        const reconcile = jest.fn();

        const bar = ensureThreadBar(host, body, '19b95d11476b81db', createBar, reconcile);

        expect(host.children[0]).toBe(bar);
        expect(host.children[1]).toBe(body);
        expect(document.querySelectorAll('.cu-email-bar')).toHaveLength(1);
        expect(reconcile).toHaveBeenCalledTimes(1);
    });

    test('repeated scans reuse one bar and update dataset from pending to confirmed', () => {
        document.body.innerHTML = '<div class="ii gt"><div class="a3s aiL">body</div></div>';
        const body = document.querySelector('.a3s.aiL');
        const host = body.parentElement;
        const reconcile = jest.fn((bar, threadId) => {
            bar.dataset.threadId = threadId || '';
            const button = bar.querySelector('.cu-add-btn');
            button.disabled = !threadId;
        });

        const first = ensureThreadBar(host, body, null, createBar, reconcile);
        const second = ensureThreadBar(host, body, '19b95d11476b81db', createBar, reconcile);

        expect(second).toBe(first);
        expect(document.querySelectorAll('.cu-email-bar')).toHaveLength(1);
        expect(first.dataset.threadId).toBe('19b95d11476b81db');
        expect(first.querySelector('.cu-add-btn').disabled).toBe(false);
    });

    test('pending to confirmed updates explicit label without residual text', () => {
        document.body.innerHTML = '<div class="ii gt"><div class="a3s aiL">body</div></div>';
        const body = document.querySelector('.a3s.aiL');
        const host = body.parentElement;
        const createLocalizedBar = (threadId) => {
            const bar = document.createElement('div');
            bar.className = 'cu-email-bar';
            bar.dataset.threadId = threadId || '';
            const button = document.createElement('button');
            button.className = 'cu-add-btn';
            const label = document.createElement('span');
            label.className = 'cu-add-label';
            label.textContent = threadId ? 'Agregar a ClickUp' : 'Esperando datos de Gmail…';
            button.appendChild(label);
            bar.appendChild(button);
            return bar;
        };
        const reconcile = jest.fn((bar, threadId) => {
            bar.dataset.threadId = threadId || '';
            bar.querySelector('.cu-add-label').textContent = threadId ? 'Agregar a ClickUp' : 'Esperando datos de Gmail…';
        });

        const bar = ensureThreadBar(host, body, null, createLocalizedBar, reconcile);
        expect(bar.textContent).toContain('Esperando datos de Gmail…');
        ensureThreadBar(host, body, '19b95d11476b81db', createLocalizedBar, reconcile);

        expect(bar.textContent).toContain('Agregar a ClickUp');
        expect(bar.textContent).not.toContain('Pending Gmail metadata');
        expect(bar.textContent).not.toContain('Esperando datos de Gmail…');
    });

    test('rejects non-direct reference nodes so one body failure can be isolated by caller', () => {
        document.body.innerHTML = '<div class="gs"><div class="ii gt"><div class="a3s aiL">body</div></div></div>';
        const body = document.querySelector('.a3s.aiL');
        const wrongHost = document.querySelector('.gs');

        expect(() => ensureThreadBar(wrongHost, body, '19b95d11476b81db', createBar, jest.fn())).toThrow(/direct child/);
        expect(document.querySelectorAll('.cu-email-bar')).toHaveLength(0);
    });
});
