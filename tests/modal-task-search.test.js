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

    test('uses the canonical preferred workspace key for hierarchy and task search coherence', () => {
        expect(source('src/modal.ts')).toContain("chrome.storage.local.get(['preferredTeamId', 'cachedTeams'])");
        expect(source('src/modal.ts')).not.toContain("chrome.storage.local.get(['preferredTeam', 'cachedTeams'])");
    });
});
