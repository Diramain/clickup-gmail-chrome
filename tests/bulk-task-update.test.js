const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadModule() {
    const filename = path.join(__dirname, '..', 'src', 'bulk-task-update.ts');
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

describe('controlled bulk task update', () => {
    const bulk = loadModule();

    test('validates compatibility, writes once and verifies read-back', async () => {
        let task = {
            id: 'T1', list: { id: 'L1' }, status: { status: 'Todo' }, due_date: null,
            assignees: [{ id: 2 }],
        };
        const port = {
            getTask: jest.fn(async () => task),
            getList: jest.fn(async () => ({ statuses: [{ status: 'Done' }] })),
            getListMembers: jest.fn(async () => ({ members: [{ id: 1 }] })),
            updateTask: jest.fn(async (_taskId, payload) => {
                task = {
                    ...task,
                    status: { status: payload.status },
                    due_date: String(payload.due_date),
                    assignees: [{ id: payload.assignees.add[0] }],
                };
                return task;
            }),
        };

        const result = await bulk.applyValidatedBulkTaskChange(port, {
            taskId: 'T1', listId: 'L1', status: 'Done', dueDate: 1788134400000, assigneeId: 1,
        });

        expect(result).toEqual({ ok: true, taskId: 'T1', outcome: 'applied', code: 'APPLIED', stop: false });
        expect(port.updateTask).toHaveBeenCalledTimes(1);
        expect(port.updateTask.mock.calls[0][1]).toEqual({
            status: 'Done', due_date: 1788134400000, due_date_time: false,
            assignees: { add: [1], rem: [2] },
        });
        expect(port.getTask).toHaveBeenCalledTimes(2);
    });

    test('stops before writing when status compatibility changed', async () => {
        const port = {
            getTask: jest.fn(async () => ({ id: 'T1', list: { id: 'L1' }, status: { status: 'Todo' }, assignees: [] })),
            getList: jest.fn(async () => ({ statuses: [{ status: 'Todo' }] })),
            getListMembers: jest.fn(),
            updateTask: jest.fn(),
        };

        const result = await bulk.applyValidatedBulkTaskChange(port, { taskId: 'T1', listId: 'L1', status: 'Done' });

        expect(result.code).toBe('STATUS_NOT_COMPATIBLE');
        expect(result.stop).toBe(true);
        expect(port.updateTask).not.toHaveBeenCalled();
    });

    test('does not retry or hide a write that failed read-back verification', async () => {
        const task = { id: 'T1', list: { id: 'L1' }, status: { status: 'Todo' }, due_date: null, assignees: [] };
        const port = {
            getTask: jest.fn(async () => task),
            getList: jest.fn(async () => ({ statuses: [{ status: 'Done' }] })),
            getListMembers: jest.fn(),
            updateTask: jest.fn(async () => task),
        };

        const result = await bulk.applyValidatedBulkTaskChange(port, { taskId: 'T1', listId: 'L1', status: 'Done' });

        expect(result.code).toBe('VERIFY_STATUS_FAILED');
        expect(result.stop).toBe(true);
        expect(port.updateTask).toHaveBeenCalledTimes(1);
    });
});
