const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadModule() {
    const filename = path.join(__dirname, '..', 'src', 'private-storage.ts');
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

function memoryBackend(initial = {}) {
    const data = Object.assign(Object.create(null), initial);
    let sequence = 0;
    const changesFor = (items) => Object.fromEntries(Object.entries(items).map(([key, newValue]) => [
        key,
        key in data ? { oldValue: data[key], newValue } : { newValue },
    ]));
    return {
        data,
        async read(keys) {
            if (keys === null) return { ...data };
            return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
        },
        async set(items) {
            const changes = changesFor(items);
            for (const [key, value] of Object.entries(items)) {
                Object.defineProperty(data, key, { value, enumerable: true, configurable: true, writable: true });
            }
            return { changes, sequence: ++sequence };
        },
        async remove(keys) {
            const changes = Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, { oldValue: data[key] }]));
            for (const key of keys) delete data[key];
            return { changes, sequence: ++sequence };
        },
        async clear() {
            const changes = Object.fromEntries(Object.entries(data).map(([key, oldValue]) => [key, { oldValue }]));
            for (const key of Object.keys(data)) delete data[key];
            return { changes, sequence: ++sequence };
        },
    };
}

describe('Firefox private storage facade', () => {
    const { createPrivateStorageArea } = loadModule();

    test('matches WebExtensions get, defaults, set, remove, and clear semantics', async () => {
        const backend = memoryBackend({ existing: 1 });
        const emitted = [];
        const area = createPrivateStorageArea(backend, (mutation) => emitted.push(mutation.changes));

        await expect(area.get('existing')).resolves.toEqual({ existing: 1 });
        await expect(area.get({ existing: 0, missing: 2 })).resolves.toEqual({ existing: 1, missing: 2 });

        await area.set({ existing: 3, added: 'safe' });
        expect(emitted[0]).toEqual({
            existing: { oldValue: 1, newValue: 3 },
            added: { newValue: 'safe' },
        });

        await area.remove(['existing', 'absent']);
        expect(emitted[1]).toEqual({ existing: { oldValue: 3 } });

        await area.clear();
        expect(backend.data).toEqual({});
        expect(emitted[2]).toEqual({ added: { oldValue: 'safe' } });
    });

    test('accepts trusted-context access requests without exposing a native local area', async () => {
        const backend = memoryBackend();
        const area = createPrivateStorageArea(backend);

        await expect(area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })).resolves.toBeUndefined();
        await expect(area.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })).rejects.toThrow();
    });

    test('treats prototype-shaped keys as ordinary own properties', async () => {
        const backend = memoryBackend();
        const area = createPrivateStorageArea(backend);
        const values = JSON.parse('{"__proto__":"safe","constructor":"value","prototype":true}');

        await area.set(values);
        const stored = await area.get(null);

        expect(Object.prototype.hasOwnProperty.call(stored, '__proto__')).toBe(true);
        expect(stored.__proto__).toBe('safe');
        expect(stored.constructor).toBe('value');
        expect(stored.prototype).toBe(true);
    });
});
