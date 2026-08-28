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
    const localRequire = (request) => {
        if (request === '../src/connections-state') return loadTsModule('src/connections-state.ts');
        if (request === '../src/task-search-view') return loadTsModule('src/task-search-view.ts');
        if (request === '../src/destination-config') return loadTsModule('src/destination-config.ts');
        if (request === '../diagnostics/recorder') return { initCausalRecorder: () => undefined };
        if (request === '../popup/popup') return {};
        if (request === './link-hardening') return loadTsModule('src/link-hardening.ts');
        if (request === './bulk-task-update') return loadTsModule('src/bulk-task-update.ts');
        if (request === './gmail-attachment-security') return loadTsModule('src/gmail-attachment-security.ts');
        if (request === './clickup-auth') return loadTsModule('src/clickup-auth.ts');
        if (request === './meet/meet-task-prompt') return loadTsModule('src/meet/meet-task-prompt.ts');
        if (request === '../src/i18n') return { t: (key) => key, getActiveLanguage: () => 'es' };
        return require(request);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

const HOUR = 60 * 60 * 1000;

describe('CGC-UX-V2-D2 destination contracts', () => {
    const config = loadTsModule('src/destination-config.ts');

    test('a selection without a usable list id is rejected', () => {
        expect(config.sanitizeDestinationSelection(null)).toBeNull();
        expect(config.sanitizeDestinationSelection({})).toBeNull();
        expect(config.sanitizeDestinationSelection({ listId: '   ' })).toBeNull();
        expect(config.sanitizeDestinationSelection({ listId: 'x'.repeat(101) })).toBeNull();
        expect(config.sanitizeDestinationSelection([{ listId: 'ok' }])).toBeNull();
    });

    test('oversized optional fields are dropped, not truncated silently into the id', () => {
        const selection = config.sanitizeDestinationSelection({
            listId: ' 901 ',
            listName: 'y'.repeat(501),
            path: 'Marketing / Campañas',
        });

        expect(selection).toEqual({ listId: '901', path: 'Marketing / Campañas' });
    });

    test('malformed option payloads normalize to an empty but complete shape', () => {
        expect(config.normalizeDestinationOptions(undefined)).toEqual({
            teams: [], preferredTeamId: null, lists: [], current: null, cachedAt: null,
        });
        expect(config.normalizeDestinationOptions('nope').lists).toEqual([]);
        expect(config.normalizeDestinationOptions({ teams: 'x', lists: {} }).teams).toEqual([]);
    });

    test('lists without id or name are discarded and duplicates collapse', () => {
        const options = config.normalizeDestinationOptions({
            lists: [
                { id: '1', name: 'Entrada', path: 'Ops / Entrada' },
                { id: '1', name: 'Duplicada' },
                { id: '', name: 'Sin id' },
                { id: '2' },
                { id: '3', name: 'Sin ruta' },
            ],
        });

        expect(options.lists).toEqual([
            { id: '1', name: 'Entrada', path: 'Ops / Entrada' },
            { id: '3', name: 'Sin ruta', path: 'Sin ruta' },
        ]);
    });

    test('resolves only a cached list and replaces submitted labels with canonical values', () => {
        const lists = [{ id: '901', name: 'Entrada', path: 'Ops / Entrada' }];

        expect(config.resolveAuthorizedDestination({
            listId: '901', listName: 'Nombre manipulado', path: 'Ruta manipulada',
        }, lists)).toEqual({ listId: '901', listName: 'Entrada', path: 'Ops / Entrada' });
        expect(config.resolveAuthorizedDestination({ listId: '999' }, lists)).toBeNull();
    });

    test('filters lists by complete path without case or accent sensitivity', () => {
        const lists = [
            { id: '1', name: 'Instalación', path: 'El Instalador > Desarrollo > Instalación' },
            { id: '2', name: 'Soporte', path: 'Operaciones > Soporte' },
        ];

        expect(config.filterDestinationLists(lists, 'instalacion')).toEqual([lists[0]]);
        expect(config.filterDestinationLists(lists, 'DESARROLLO')).toEqual([lists[0]]);
        expect(config.filterDestinationLists([
            { id: '3', name: 'Soporte - Steel Build', path: 'El Instalador > Desarrollo > Soporte - Steel Build' },
        ], 'soporte steel')).toHaveLength(1);
        expect(config.filterDestinationLists(lists, '')).toEqual(lists);
    });

    test('state classification covers the five common states', () => {
        const now = 1_000 * HOUR;
        const base = { teams: [{ id: 't', name: 'Ops' }], preferredTeamId: 't', lists: [], current: null, cachedAt: now };

        expect(config.classifyDestinationState(config.normalizeDestinationOptions(null), now)).toBe('blocked');
        expect(config.classifyDestinationState(base, now)).toBe('empty');

        const withLists = { ...base, lists: [{ id: '1', name: 'A', path: 'A' }] };
        expect(config.classifyDestinationState(withLists, now)).toBe('idle');
        expect(config.classifyDestinationState({ ...withLists, current: { listId: '1' } }, now)).toBe('ready');
        expect(config.classifyDestinationState({ ...withLists, cachedAt: now - 25 * HOUR }, now)).toBe('stale');
    });

    test('a stale cache still lets the user choose', () => {
        const now = 1_000 * HOUR;
        const stale = {
            teams: [{ id: 't', name: 'Ops' }],
            preferredTeamId: 't',
            lists: [{ id: '1', name: 'A', path: 'A' }],
            current: null,
            cachedAt: now - 48 * HOUR,
        };

        expect(config.describeDestinationState('stale', stale).detail).toMatch(/Podés elegir igual/);
    });
});

describe('CGC-UX-V2-D2 message security', () => {
    const security = loadTsModule('src/message-security.ts');

    test('both actions belong to the app, never to a content script', () => {
        for (const action of ['getDestinationOptions', 'setDefaultDestination']) {
            expect(security.isAllowedOriginForAction(action, 'chrome-extension://abc/app/app.html')).toBe(true);
            expect(security.isAllowedOriginForAction(action, 'https://mail.google.com/mail/u/0')).toBe(false);
            expect(security.isAllowedOriginForAction(action, 'https://app.clickup.com/t/1')).toBe(false);
            expect(security.isAllowedOriginForAction(action, 'https://evil.example/')).toBe(false);
        }
    });

    test('the write schema demands a bounded list id', () => {
        const message = (data) => ({ action: 'setDefaultDestination', data });

        expect(security.hasValidSchema(message({ listId: '901' }))).toBe(true);
        expect(security.hasValidSchema(message({ listId: '901', listName: 'Entrada', path: 'Ops / Entrada' }))).toBe(true);
        expect(security.hasValidSchema(message({}))).toBe(false);
        expect(security.hasValidSchema(message({ listId: 'x'.repeat(101) }))).toBe(false);
        expect(security.hasValidSchema(message({ listId: '901', path: 'p'.repeat(1001) }))).toBe(false);
    });
});

describe('CGC-UX-V2-D2 destination view', () => {
    const app = loadTsModule('app/app.ts');

    const OPTIONS = {
        teams: [{ id: 't1', name: 'Operaciones' }],
        preferredTeamId: 't1',
        lists: [
            { id: '901', name: 'Entrada general', path: 'Operaciones / Entrada general' },
            { id: '902', name: 'Marketing', path: 'Operaciones / Marketing' },
        ],
        current: null,
        cachedAt: Date.now(),
    };

    function createPort({ options = OPTIONS, saveResult, saveFails = false } = {}) {
        const calls = { getOptions: 0, saveDestination: [] };
        return {
            calls,
            async getOptions() { calls.getOptions += 1; return options; },
            async saveDestination(selection) {
                calls.saveDestination.push(selection);
                if (saveFails) throw new Error('NO_RESPONSE');
                return saveResult ?? { ok: true, current: selection };
            },
        };
    }

    beforeEach(() => {
        document.documentElement.innerHTML = source('app/app.html');
    });

    test('the block lives inside the Gmail section and starts disabled', () => {
        const form = document.getElementById('destinationForm');

        expect(form.closest('[data-page]').getAttribute('data-page')).toBe('gmail');
        expect(document.getElementById('destinationSave').disabled).toBe(true);
        expect(document.getElementById('destinationList').disabled).toBe(true);
        expect(document.getElementById('destinationState').getAttribute('role')).toBe('status');
    });

    test('with a populated cache the list select fills with full paths but requires an explicit choice', async () => {
        await app.initDefaultDestination(createPort());
        const listSelect = document.getElementById('destinationList');

        expect(listSelect.disabled).toBe(false);
        expect([...listSelect.options].map((option) => option.textContent))
            .toEqual(['Elegí una lista', 'Operaciones / Entrada general', 'Operaciones / Marketing']);
        expect(document.getElementById('destinationState').dataset.state).toBe('idle');
        expect(document.getElementById('destinationSave').disabled).toBe(true);

        listSelect.value = '901';
        listSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
        expect(document.getElementById('destinationSave').disabled).toBe(false);
    });

    test('the destination search narrows the list options before selection', async () => {
        await app.initDefaultDestination(createPort());
        const search = document.getElementById('destinationListSearch');
        const listSelect = document.getElementById('destinationList');

        search.value = 'marketing';
        search.dispatchEvent(new window.Event('input', { bubbles: true }));

        expect([...listSelect.options].map((option) => option.textContent))
            .toEqual(['1 coincidencia · elegí una lista', 'Operaciones / Marketing']);
        expect(document.getElementById('destinationSave').disabled).toBe(true);
    });

    test('an empty cache blocks saving and explains why', async () => {
        await app.initDefaultDestination(createPort({ options: null }));

        expect(document.getElementById('destinationState').dataset.state).toBe('blocked');
        expect(document.getElementById('destinationStateDetail').textContent).toMatch(/Sincronización/);
        expect(document.getElementById('destinationSave').disabled).toBe(true);
    });

    test('returning from Synchronization refreshes a cache populated after app startup', async () => {
        let payload = null;
        const port = createPort();
        port.getOptions = async () => payload;
        await app.initDefaultDestination(port);
        expect(document.getElementById('destinationList').disabled).toBe(true);

        payload = OPTIONS;
        app.renderAppRoute('gmail');
        await Promise.resolve();
        await Promise.resolve();

        expect(document.getElementById('destinationList').disabled).toBe(false);
        expect(document.getElementById('destinationList').options).toHaveLength(3);
        expect(document.getElementById('destinationState').dataset.state).toBe('idle');
    });

    test('saving renders what the background confirmed, not what was sent', async () => {
        const port = createPort({ saveResult: { ok: true, current: { listId: '902', listName: 'Marketing renombrada' } } });
        await app.initDefaultDestination(port);

        document.getElementById('destinationList').value = '902';
        document.getElementById('destinationList').dispatchEvent(new window.Event('change', { bubbles: true }));
        document.getElementById('destinationForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(port.calls.saveDestination).toEqual([{ listId: '902', listName: 'Marketing', path: 'Operaciones / Marketing' }]);
        expect(document.getElementById('destinationCurrent').textContent).toContain('Marketing renombrada');
        expect(document.getElementById('destinationState').dataset.state).toBe('ready');
    });

    test('a rejected save keeps the selection and offers a recoverable error', async () => {
        const port = createPort({ saveResult: { ok: false, code: 'INVALID_DESTINATION' } });
        await app.initDefaultDestination(port);

        document.getElementById('destinationList').value = '901';
        document.getElementById('destinationList').dispatchEvent(new window.Event('change', { bubbles: true }));
        document.getElementById('destinationForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(document.getElementById('destinationState').dataset.state).toBe('error');
        expect(document.getElementById('destinationList').value).toBe('901');
        expect(document.getElementById('destinationSave').disabled).toBe(false);
        expect(document.getElementById('destinationCurrent').textContent).toContain('Sin destino');
    });

    test('a background that never answers degrades without losing the form', async () => {
        const port = createPort({ saveFails: true });
        await app.initDefaultDestination(port);

        document.getElementById('destinationList').value = '901';
        document.getElementById('destinationList').dispatchEvent(new window.Event('change', { bubbles: true }));
        document.getElementById('destinationForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(document.getElementById('destinationState').dataset.state).toBe('error');
        expect(document.getElementById('destinationSave').disabled).toBe(false);
    });

    test('destination initialization does not disable the native task search', async () => {
        await app.initDefaultDestination(createPort());

        expect(document.getElementById('taskSearch').disabled).toBe(false);
        expect(document.getElementById('searchResults').textContent).toBe('');
    });
});
