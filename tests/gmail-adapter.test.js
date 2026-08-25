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
const { ensureThreadBar, reconcileLinkedTaskAnchors, reconcileThreadBarState } = loadTsModule('src/gmail-render-utils.ts');

describe('GmailAdapter production selectors', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        jest.restoreAllMocks();
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

    test('scopes sender, body, and attachment metadata to the clicked Gmail message container', () => {
        document.body.innerHTML = `
            <div class="adn" id="first">
                <div class="gs"><span class="gD" email="first@example.test"></span><div class="a3s aiL">first</div></div>
                <div class="hq"><a download_url="image/png:first.png:https://mail.google.com/mail/u/0/?att=1"></a></div>
            </div>
            <div class="adn" id="second">
                <div class="gs"><span class="gD" email="second@example.test"></span><div class="a3s aiL">second</div></div>
            </div>
            <div class="hq" id="second-attachment-footer"><a download_url="application/pdf:second.pdf:https://mail.google.com/mail/u/0/?att=2"></a></div>`;
        const secondBody = document.querySelector('#second .a3s');
        const second = GmailAdapter.getMessageContainer(secondBody);
        const attachmentElement = document.querySelector('#second-attachment-footer [download_url]');

        expect(second.id).toBe('second');
        expect(GmailAdapter.getSenderEmail(second)).toBe('second@example.test');
        expect(GmailAdapter.getEmailBodyHtml(secondBody)).toBe('second');
        expect(GmailAdapter.getAllEmailBodies()).toEqual([
            document.querySelector('#first .a3s'),
            secondBody,
        ]);
        expect(Boolean(secondBody.compareDocumentPosition(attachmentElement) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
        expect(GmailAdapter.getAttachmentUrls(second, secondBody)).toEqual([
            { mimeType: 'application/pdf', filename: 'second.pdf', url: 'https://mail.google.com/mail/u/0/?att=2' },
        ]);
        expect(GmailAdapter.getAttachmentUrls(document.querySelector('#first'), document.querySelector('#first .a3s'))).toEqual([
            { mimeType: 'image/png', filename: 'first.png', url: 'https://mail.google.com/mail/u/0/?att=1' },
        ]);
    });

    test('discovers Firefox Gmail attachment cards without download_url metadata', () => {
        document.body.innerHTML = `
            <div class="adn">
                <div class="gs"><div class="a3s aiL">message</div></div>
                <span class="aZo">
                    <a class="aQy e" href="https://mail.google.com/mail/u/0/?view=att&amp;attid=1"></a>
                    <div class="aV3">report.pdf</div>
                </span>
            </div>`;
        const body = document.querySelector('.a3s');

        expect(GmailAdapter.getAttachmentUrls(document.querySelector('.adn'), body)).toEqual([
            {
                mimeType: 'application/octet-stream',
                filename: 'report.pdf',
                url: 'https://mail.google.com/mail/u/0/?view=att&attid=1',
            },
        ]);
    });

    test('discovers Gmail-hosted body images without accepting remote images or tracking pixels', () => {
        document.body.innerHTML = `
            <div class="a3s aiL" id="body">
                <img src="https://mail.google.com/mail/u/0/?view=fimg&amp;attid=1" width="180" height="80">
                <img src="https://mail.google.com/mail/u/0/?view=fimg&amp;attid=1" width="180" height="80">
                <img src="https://mail.google.com/mail/u/0/?view=fimg&amp;attid=2" width="1" height="1">
                <img src="https://example.test/remote.jpg" width="200" height="100">
            </div>`;

        expect(GmailAdapter.getInlineImageUrls(document.querySelector('#body'))).toEqual([
            {
                url: 'https://mail.google.com/mail/u/0/?view=fimg&attid=1',
                filename: 'imagen-en-el-cuerpo-1',
                mimeType: 'image/*',
                inline: true,
            },
        ]);
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

    test('identical linked-task reconciliation preserves the anchor node and click target', async () => {
        const container = document.createElement('div');
        const task = { id: '86bbcpf38', name: 'Incidente', url: 'https://app.clickup.com/t/86bbcpf38' };

        reconcileLinkedTaskAnchors(container, [task]);
        const first = container.querySelector('.cu-task-link');
        const click = jest.fn();
        first.addEventListener('click', click);
        const mutations = [];
        const observer = new MutationObserver(records => mutations.push(...records));
        observer.observe(container, { attributes: true, childList: true, characterData: true, subtree: true });

        reconcileLinkedTaskAnchors(container, [{ ...task, lastValidatedAt: Date.now(), updatedAt: Date.now() }]);
        await new Promise(resolve => setTimeout(resolve, 0));
        const second = container.querySelector('.cu-task-link');
        second.dispatchEvent(new MouseEvent('click'));
        observer.disconnect();

        expect(second).toBe(first);
        expect(click).toHaveBeenCalledTimes(1);
        expect(mutations).toHaveLength(0);
    });

    test('linked-task reconciliation updates only materially changed anchors', () => {
        const container = document.createElement('div');
        reconcileLinkedTaskAnchors(container, [
            { id: 'A', name: 'Task A', url: 'https://app.clickup.com/t/A' },
            { id: 'B', name: 'Task B', url: 'https://app.clickup.com/t/B' },
        ]);
        const firstA = container.querySelector('[data-task-id="A"]');
        const firstB = container.querySelector('[data-task-id="B"]');

        reconcileLinkedTaskAnchors(container, [
            { id: 'A', name: 'Task A', url: 'https://app.clickup.com/t/A', lastValidatedAt: 999 },
            { id: 'B', name: 'Task B renamed', url: 'https://app.clickup.com/t/B' },
        ]);

        expect(container.querySelector('[data-task-id="A"]')).toBe(firstA);
        expect(container.querySelector('[data-task-id="B"]')).not.toBe(firstB);
        expect(container.textContent).toContain('Task B renamed');
    });

    test('identical production bar-state reconciliation emits no self-triggering mutations', async () => {
        const bar = document.createElement('div');
        bar.className = 'cu-email-bar';
        bar.innerHTML = '<button class="cu-add-btn"><span class="cu-add-label"></span></button><div class="cu-linked-tasks"></div>';
        reconcileThreadBarState(bar, 'thread-1');
        const mutations = [];
        const observer = new MutationObserver(records => mutations.push(...records));
        observer.observe(bar, { attributes: true, childList: true, characterData: true, subtree: true });

        reconcileThreadBarState(bar, 'thread-1');
        await new Promise(resolve => setTimeout(resolve, 0));
        observer.disconnect();

        expect(mutations).toHaveLength(0);
        expect(bar.querySelector('.cu-add-label').textContent).toBe('Crear tarea');
    });

    test('reconciles create and attach controls without enabling an unconfirmed thread', () => {
        const bar = document.createElement('div');
        bar.innerHTML = '<button class="cu-add-btn"><span class="cu-add-label"></span></button><button class="cu-attach-btn"></button><div class="cu-linked-tasks"></div>';

        reconcileThreadBarState(bar, null);
        expect(bar.querySelector('.cu-add-btn').disabled).toBe(true);
        expect(bar.querySelector('.cu-attach-btn').disabled).toBe(true);
        expect(bar.querySelector('.cu-add-label').textContent).toBe('Esperando datos de Gmail…');

        reconcileThreadBarState(bar, 'thread-1');
        expect(bar.querySelector('.cu-add-btn').disabled).toBe(false);
        expect(bar.querySelector('.cu-attach-btn').disabled).toBe(false);
        expect(bar.querySelector('.cu-attach-btn').title).toContain('Vincular');
    });
});
