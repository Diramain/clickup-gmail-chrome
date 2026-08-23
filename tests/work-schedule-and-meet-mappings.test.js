const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function loadTsModule(relativePath, overrides = {}, cache = new Map()) {
    const normalized = path.normalize(relativePath);
    if (cache.has(normalized)) return cache.get(normalized).exports;
    const compiled = ts.transpileModule(source(normalized), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: normalized,
    }).outputText;
    const module = { exports: {} };
    cache.set(normalized, module);
    const localRequire = (request) => {
        if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request];
        if (!request.startsWith('.')) return require(request);
        const base = path.join(path.dirname(normalized), request);
        return loadTsModule(base.endsWith('.ts') ? base : `${base}.ts`, overrides, cache);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

describe('local work schedule settings', () => {
    const app = loadTsModule('app/app.ts', {
        '../popup/popup': {},
        '../diagnostics/recorder': { initCausalRecorder: () => undefined },
    });

    test('normalizes a versioned schedule and derives the weekly target', () => {
        const settings = app.normalizeWorkScheduleSettings({
            version: 1,
            workdays: ['monday', 'wednesday', 'wednesday', 'invalid', 'sunday'],
            dailyTargetHours: 7.7,
        });
        expect(settings).toEqual({ version: 1, workdays: ['monday', 'wednesday', 'sunday'], dailyTargetHours: 7.5 });
        expect(app.weeklyTargetHours(settings)).toBe(22.5);
        expect(app.normalizeDailyTargetHours(0)).toBe(0.5);
        expect(app.normalizeDailyTargetHours(30)).toBe(24);
    });

    test('loads and persists through the injected local storage port', async () => {
        document.body.innerHTML = `
            <input id="dailyTrackedHoursTarget" type="number">
            <strong id="weeklyTrackedHoursTarget"></strong>
            <p id="workScheduleStatus"></p>
            ${app.WORK_WEEK_DAYS.map((day) => `<input type="checkbox" data-workday="${day}">`).join('')}
        `;
        const port = {
            read: jest.fn(async () => ({ version: 1, workdays: ['monday', 'tuesday'], dailyTargetHours: 6 })),
            write: jest.fn(async () => undefined),
        };
        await app.initWorkSchedule(port);
        expect(document.getElementById('weeklyTrackedHoursTarget').textContent).toBe('12 h por semana');
        const sunday = document.querySelector('[data-workday="sunday"]');
        sunday.checked = true;
        sunday.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(port.write).toHaveBeenLastCalledWith({ version: 1, workdays: ['monday', 'tuesday', 'sunday'], dailyTargetHours: 6 });
    });
});

describe('Meet mapping task display cache', () => {
    const mappingView = loadTsModule('src/meet/meet-mapping-view.ts');

    test('normalizes task name and status with a clear ID-preserving fallback', () => {
        expect(mappingView.normalizeMeetMappingTaskDetail({ id: 'abc', name: 'Plan semanal', status: { status: 'en curso' } }, 'abc'))
            .toEqual({ id: 'abc', name: 'Plan semanal', status: 'en curso' });
        expect(mappingView.normalizeMeetMappingTaskDetail(null, 'missing'))
            .toEqual({ id: 'missing', name: 'Tarea no disponible', status: 'No disponible' });
    });

    test('evicts the oldest task beyond the fixed cache bound', () => {
        const cache = new mappingView.MeetMappingTaskCache();
        for (let index = 0; index <= mappingView.MEET_MAPPING_TASK_CACHE_LIMIT; index += 1) {
            cache.set({ id: `task-${index}`, name: `Task ${index}`, status: 'open' });
        }
        expect(cache.size).toBe(mappingView.MEET_MAPPING_TASK_CACHE_LIMIT);
        expect(cache.get('task-0')).toBeUndefined();
        expect(cache.get(`task-${mappingView.MEET_MAPPING_TASK_CACHE_LIMIT}`)).toBeDefined();
    });
});
