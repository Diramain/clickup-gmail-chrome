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
        if (!request.startsWith('.')) return require(request);
        const base = path.normalize(path.join(path.dirname(relativePath), request));
        const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
        const resolved = candidates.find(candidate => fs.existsSync(path.join(__dirname, '..', candidate)));
        if (!resolved) throw new Error(`Unable to resolve ${request} from ${relativePath}`);
        return loadTsModule(resolved);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

function modalFixture() {
    const root = document.createElement('div');
    root.innerHTML = '<div class="cu-task-search-results hidden"></div>';
    document.body.appendChild(root);
    const { TaskModal } = loadTsModule('src/modal.ts');
    const modal = new TaskModal();
    modal.modal = root;
    return { modal, results: root.querySelector('.cu-task-search-results') };
}

describe('Attach-to-existing modal search', () => {
    test('marks and unmarks every eligible Gmail attachment', async () => {
        window.matchMedia = jest.fn(() => ({ matches: false }));
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        modal.loadFullHierarchy = jest.fn(() => Promise.resolve());
        modal.loadDefaultList = jest.fn(() => Promise.resolve());
        modal.prefillCurrentUser = jest.fn(() => Promise.resolve());

        await modal.show({
            threadId: 'thread123',
            subject: 'Email',
            from: '',
            html: '',
            attachments: [
                { filename: 'one.pdf', mimeType: 'application/pdf', url: 'https://mail.google.com/mail/u/0/?att=1' },
                { filename: 'two.pdf', mimeType: 'application/pdf', url: 'https://mail.google.com/mail/u/0/?att=2' },
            ],
        });

        const button = document.querySelector('#cu-toggle-attachments');
        const checkboxes = Array.from(document.querySelectorAll('[data-attachment-index]'));
        expect(button.textContent).toBe('Marcar todos');

        button.click();
        expect(checkboxes.every(checkbox => checkbox.checked)).toBe(true);
        expect(button.textContent).toBe('Desmarcar todos');
        expect(button.getAttribute('aria-pressed')).toBe('true');

        checkboxes[0].checked = false;
        checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }));
        expect(button.textContent).toBe('Marcar todos');

        button.click();
        button.click();
        expect(checkboxes.every(checkbox => !checkbox.checked)).toBe(true);
        expect(button.getAttribute('aria-pressed')).toBe('false');
    });

    test('toggles lazy thumbnails for images without previewing documents', async () => {
        window.matchMedia = jest.fn(() => ({ matches: false }));
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        modal.loadFullHierarchy = jest.fn(() => Promise.resolve());
        modal.loadDefaultList = jest.fn(() => Promise.resolve());
        modal.prefillCurrentUser = jest.fn(() => Promise.resolve());

        await modal.show({
            threadId: 'thread123',
            subject: 'Email',
            from: '',
            html: '',
            attachments: [
                { filename: 'photo.jpg', mimeType: 'image/jpeg', url: 'https://mail.google.com/mail/u/0/?att=1' },
                { filename: 'report.pdf', mimeType: 'application/pdf', url: 'https://mail.google.com/mail/u/0/?att=2' },
            ],
        });

        const button = modal.modal.querySelector('#cu-toggle-attachment-preview');
        const list = modal.modal.querySelector('#cu-attachment-list');
        expect(button.hidden).toBe(false);
        expect(list.querySelectorAll('.cu-attachment-preview')).toHaveLength(0);

        button.click();
        expect(button.textContent).toBe('Vista lista');
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(list.classList.contains('cu-attachment-list-thumbnails')).toBe(true);
        expect(list.querySelectorAll('.cu-attachment-preview')).toHaveLength(1);
        expect(list.querySelector('.cu-attachment-preview').getAttribute('src')).toBe('https://mail.google.com/mail/u/0/?att=1');

        button.click();
        expect(button.textContent).toBe('Miniaturas');
        expect(list.classList.contains('cu-attachment-list-thumbnails')).toBe(false);
    });

    test('resolves a Gmail body image MIME type before uploading it', async () => {
        const originalFetch = global.fetch;
        window.matchMedia = jest.fn(() => ({ matches: false }));
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        modal.loadFullHierarchy = jest.fn(() => Promise.resolve());
        modal.loadDefaultList = jest.fn(() => Promise.resolve());
        modal.prefillCurrentUser = jest.fn(() => Promise.resolve());
        chrome.runtime.sendMessage.mockResolvedValue({ success: true });
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            url: 'https://mail-attachment.googleusercontent.com/attachment/u/0/?attid=1',
            type: 'cors',
            headers: { get: key => key === 'content-type' ? 'image/jpeg' : null },
            arrayBuffer: () => Promise.resolve(Uint8Array.from([0xff, 0xd8, 0xff]).buffer),
        });

        await modal.show({
            threadId: 'thread123',
            subject: 'Email',
            from: '',
            html: '',
            attachments: [{
                url: 'https://mail.google.com/mail/u/0/?view=fimg&attid=1',
                filename: 'imagen-en-el-cuerpo-1',
                mimeType: 'image/*',
                inline: true,
            }],
        });
        const checkbox = modal.modal.querySelector('[data-attachment-index]');
        checkbox.checked = true;

        await expect(modal.uploadSelectedAttachments('task-1')).resolves.toEqual({ uploaded: 1, failed: 0, failureReason: undefined });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'uploadGmailAttachment',
            data: expect.objectContaining({ filename: 'imagen-en-el-cuerpo-1.jpg', mimeType: 'image/jpeg' }),
        }));
        global.fetch = originalFetch;
    });

    test('omits timeTracked when the optional field is empty', async () => {
        window.matchMedia = jest.fn(() => ({ matches: false }));
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        modal.loadFullHierarchy = jest.fn(() => Promise.resolve());
        modal.loadDefaultList = jest.fn(() => Promise.resolve());
        modal.prefillCurrentUser = jest.fn(() => Promise.resolve());
        modal.showSuccessPopup = jest.fn();
        modal.showToast = jest.fn();
        modal.close = jest.fn();
        chrome.runtime.sendMessage.mockResolvedValue({ id: 'task-1', name: 'Task', url: 'https://app.clickup.com/t/task-1' });

        await modal.show({ threadId: 'thread123', subject: 'Email', from: '', html: '', attachments: [] });
        modal.selectedListId = 'list-1';
        await modal.submit();

        const createMessage = chrome.runtime.sendMessage.mock.calls.map(call => call[0]).find(message => message.action === 'createTaskFull');
        expect(createMessage).toBeDefined();
        expect(createMessage).not.toHaveProperty('timeTracked');
    });

    test('renders before hierarchy hydration completes', async () => {
        window.matchMedia = jest.fn(() => ({ matches: false }));
        const { TaskModal } = loadTsModule('src/modal.ts');
        const modal = new TaskModal();
        modal.loadFullHierarchy = jest.fn(() => new Promise(() => {}));
        modal.loadDefaultList = jest.fn(() => Promise.resolve());
        modal.prefillCurrentUser = jest.fn(() => Promise.resolve());

        await modal.show({ threadId: 'thread123', subject: 'Email', from: '', html: '' });

        expect(document.querySelector('.cu-modal-container')).not.toBeNull();
        expect(modal.loadFullHierarchy).toHaveBeenCalledTimes(1);
    });

    test('does not render unrelated upstream results for a title query', async () => {
        chrome.runtime.sendMessage.mockResolvedValue({
            tasks: [
                { id: '86bbahjbx', name: 'Upgrade CRM', url: 'https://app.clickup.com/t/86bbahjbx' },
                { id: '86bbah702', name: 'Historia Evento', url: 'https://app.clickup.com/t/86bbah702' },
            ],
        });
        const { modal, results } = modalFixture();

        await modal.searchTasks('agregar captcha');

        expect(results.textContent).toContain('No se encontraron tareas por ID o título');
        expect(results.textContent).not.toContain('Upgrade CRM');
    });

    test('renders a coherent title match and safely escapes task attributes', async () => {
        chrome.runtime.sendMessage.mockResolvedValue({
            tasks: [{
                id: '86bbah5g7',
                name: 'Agregar Captcha "Compras"',
                url: 'https://app.clickup.com/t/86bbah5g7',
                list: { name: 'Circuito Gastronómico' },
            }],
        });
        const { modal, results } = modalFixture();

        await modal.searchTasks('agregar captcha');

        const item = results.querySelector('.cu-task-result');
        expect(item).not.toBeNull();
        expect(item.dataset.taskName).toBe('Agregar Captcha "Compras"');
        expect(results.textContent).toContain('Agregar Captcha');
    });

    test('ignores an older response that finishes after the current query', async () => {
        let resolveOld;
        const oldResponse = new Promise(resolve => { resolveOld = resolve; });
        chrome.runtime.sendMessage.mockImplementation(({ query }) => {
            if (query === 'agregar captcha') return oldResponse;
            return Promise.resolve({
                tasks: [{ id: '86bbcrm01', name: 'Upgrade CRM', url: 'https://app.clickup.com/t/86bbcrm01' }],
            });
        });
        const { modal, results } = modalFixture();

        const oldSearch = modal.searchTasks('agregar captcha');
        await modal.searchTasks('upgrade crm');
        resolveOld({
            tasks: [{ id: '86bbah5g7', name: 'Agregar Captcha', url: 'https://app.clickup.com/t/86bbah5g7' }],
        });
        await oldSearch;

        expect(results.textContent).toContain('Upgrade CRM');
        expect(results.textContent).not.toContain('Agregar Captcha');
    });

    test('resolves the preferred workspace through the background-owned message boundary', () => {
        expect(source('src/modal.ts')).toContain("chrome.runtime.sendMessage({ action: 'getPreferredTeam' })");
        expect(source('src/modal.ts')).toContain("status?.authenticated !== true");
        expect(source('src/modal.ts')).not.toContain('chrome.storage.local');
    });

    test('allows the visual description editor to be resized vertically', () => {
        const css = source('styles/modal.css');
        expect(css).toMatch(/\.cu-editor-visual\s*\{[\s\S]*?resize:\s*vertical;/);
        expect(css).not.toMatch(/\.cu-editor-visual\s*\{[\s\S]*?max-height:\s*160px;/);
    });
});
