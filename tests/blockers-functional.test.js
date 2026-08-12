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
        if (request.startsWith('./') || request.startsWith('../')) {
            return loadTsModule(path.join(path.dirname(relativePath), request) + (request.endsWith('.ts') ? '' : '.ts'));
        }
        return require(request);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

describe('functional/data blockers', () => {
    test('flattens hierarchyCache[teamId].data.spaces including folderless and folder lists', () => {
        const { flattenHierarchySpaces, getTeamHierarchyCache } = loadTsModule('src/hierarchy-utils.ts');
        const cache = {
            team1: { timestamp: 1, data: { spaces: [{ id: 's1', name: 'Space', lists: [{ id: 'l1', name: 'Inbox' }], folders: [{ id: 'f1', name: 'Folder', lists: [{ id: 'l2', name: 'Backlog' }] }] }] } }
        };
        const teamCache = getTeamHierarchyCache(cache, 'team1');
        expect(flattenHierarchySpaces(teamCache.data.spaces)).toEqual([
            expect.objectContaining({ id: 'l1', path: 'Space > Inbox' }),
            expect.objectContaining({ id: 'l2', path: 'Space > Folder > Backlog', folderName: 'Folder' }),
        ]);
    });

    test('V2 mappings sanitize corrupt partials and fallback from V1 while omitting fallback thread ids', () => {
        const links = loadTsModule('src/link-hardening.ts');
        const now = 123;
        const result = links.readMappingsWithFallback(
            { validThread: [{ id: 't1', name: 'Task', url: 'https://app.clickup.com/t/t1', createdAt: 1, updatedAt: 2, linkStatus: 'linked' }], badThread: [{ id: 5 }] },
            { fallback_temp: [{ id: 'bad', name: 'Bad', url: 'x' }], legacyThread: [{ id: 't2', name: 'Legacy', url: 'https://app.clickup.com/t/t2' }] },
            now
        );
        expect(result.validThread).toHaveLength(1);
        expect(result.legacyThread[0]).toEqual(expect.objectContaining({ id: 't2', linkStatus: 'unverified', linkSource: 'legacy', createdAt: now }));
        expect(result.badThread).toBeUndefined();
        expect(result.fallback_temp).toBeUndefined();
    });

    test('comment thread validation escapes regex metacharacters', () => {
        const { commentsContainThreadId, escapeRegExp } = loadTsModule('src/link-hardening.ts');
        expect(escapeRegExp('abc.*[x]')).toBe('abc\\.\\*\\[x\\]');
        expect(commentsContainThreadId([{ comment_text: 'Thread ID: abc.*[x]' }], 'abc.*[x]')).toBe(true);
        expect(commentsContainThreadId([{ comment_text: 'Thread ID: abcZZZx' }], 'abc.*[x]')).toBe(false);
        expect(commentsContainThreadId([{ comment: [{ text: 'https://mail.google.com/mail/u/0/#inbox/a+b(c)' }] }], 'a+b(c)')).toBe(true);
    });

    test('message schema supports fixed list actions and openTaskModal contract is explicit', () => {
        const messages = loadTsModule('src/message-security.ts');
        expect(messages.hasValidSchema({ action: 'getLists', data: { folderId: 'folder1' } })).toBe(true);
        expect(messages.hasValidSchema({ action: 'getLists', data: { spaceId: 'space1' } })).toBe(true);
        expect(messages.hasValidSchema({ action: 'getFolderlessLists', data: { spaceId: 'space1' } })).toBe(true);
        const gmail = source('src/gmail-native.ts');
        expect(gmail).toMatch(/sendResponse\(\{ success: true \}\)/);
        expect(gmail).toMatch(/sendResponse\(\{ success: false \}\)/);
        expect(gmail).not.toMatch(/chrome\.storage\.local\.set\(\{ \[EMAIL_TASK_MAPPINGS_V2_KEY\]/);
    });

    test('ensureThreadBar reconciles existing sibling bar without duplicating', () => {
        const { ensureThreadBar } = loadTsModule('src/gmail-render-utils.ts');
        document.body.innerHTML = '<div id="container"><div class="cu-email-bar" data-thread-id="old"></div><div id="body"></div></div>';
        const container = document.getElementById('container');
        const body = document.getElementById('body');
        const reconcile = jest.fn();
        const create = jest.fn(id => Object.assign(document.createElement('div'), { className: 'cu-email-bar' }));

        const bar = ensureThreadBar(container, body, 'thread1', create, reconcile);

        expect(create).not.toHaveBeenCalled();
        expect(bar).toBe(container.children[0]);
        expect(bar.dataset.threadId).toBe('thread1');
        expect(container.querySelectorAll(':scope > .cu-email-bar')).toHaveLength(1);
        expect(reconcile).toHaveBeenCalledWith(bar, 'thread1');
    });

    test('ensureThreadBar is idempotent across repeated calls', () => {
        const { ensureThreadBar } = loadTsModule('src/gmail-render-utils.ts');
        document.body.innerHTML = '<div id="container"><div id="body"></div></div>';
        const container = document.getElementById('container');
        const body = document.getElementById('body');
        const reconcile = jest.fn();
        const create = jest.fn(id => Object.assign(document.createElement('div'), { className: 'cu-email-bar' }));

        const first = ensureThreadBar(container, body, 'thread1', create, reconcile);
        const second = ensureThreadBar(container, body, 'thread1', create, reconcile);

        expect(second).toBe(first);
        expect(create).toHaveBeenCalledTimes(1);
        expect(container.querySelectorAll(':scope > .cu-email-bar')).toHaveLength(1);
        expect(reconcile).toHaveBeenCalledTimes(2);
    });

    test('ensureThreadBar removes only duplicate direct bars and preserves nested legacy case', () => {
        const { ensureThreadBar } = loadTsModule('src/gmail-render-utils.ts');
        document.body.innerHTML = '<div id="container"><div class="cu-email-bar" data-thread-id="keep"></div><div class="cu-email-bar" data-thread-id="drop"></div><div id="body"><div class="cu-email-bar" data-thread-id="nested"></div></div></div>';
        const container = document.getElementById('container');
        const body = document.getElementById('body');
        const reconcile = jest.fn();

        const kept = ensureThreadBar(container, body, 'thread1', id => Object.assign(document.createElement('div'), { className: 'cu-email-bar' }), reconcile);

        expect(kept.dataset.threadId).toBe('thread1');
        expect(container.querySelectorAll(':scope > .cu-email-bar')).toHaveLength(1);
        expect(body.querySelectorAll('.cu-email-bar')).toHaveLength(1);

        document.body.innerHTML = '<div id="legacy-container"><div id="legacy-body"><div class="cu-email-bar" data-thread-id="nested"></div></div></div>';
        const legacyContainer = document.getElementById('legacy-container');
        const legacyBody = document.getElementById('legacy-body');
        const legacyBar = ensureThreadBar(legacyContainer, legacyBody, 'legacy', id => Object.assign(document.createElement('div'), { className: 'cu-email-bar' }), reconcile);
        expect(legacyBar).toBe(legacyBody.querySelector('.cu-email-bar'));
        expect(legacyContainer.querySelectorAll('.cu-email-bar')).toHaveLength(1);
    });

    test('background uses single writer for validation and does not precompute stale sync replacement', () => {
        const background = source('background.ts');
        expect(background).toMatch(/applyValidationResultToMapping/);
        expect(background).toMatch(/updateEmailTaskMappings\(\(mappings\) => \{/);
        expect(background).toMatch(/foundEntries\.push/);
        expect(background).not.toMatch(/const currentMappings = await getEmailTaskMappingsForRead\(\)/);
        expect(background).not.toMatch(/updateEmailTaskMappings\(\(\) => currentMappings/);
    });

    test('original file attachments are disabled and remote upload helper is removed', () => {
        const modal = source('src/modal.ts');
        expect(modal).toMatch(/id="cu-attach-files" disabled/);
        expect(modal).toMatch(/Esta versión sólo admite el adjunto HTML sanitizado del email/);
        expect(source('src/services/api.service.ts')).not.toMatch(/uploadFileFromUrl|credentials:\s*'include'/);
        expect(modal).toMatch(/const attachWithFiles = false/);
    });

    test('storage setEmailTasks is report-only over soft limit', () => {
        const storage = source('src/services/storage.service.ts');
        expect(storage).toMatch(/no truncation applied/);
        expect(storage).not.toMatch(/slice\(0, DATA_LIMITS\.MAX_EMAIL_TASKS\)/);
    });

    test('package.sh is ignored and blocked from release allowlist/dist', () => {
        expect(source('.gitignore')).toContain('package.sh');
        const { RELEASE_FILES, BLOCKED_PATTERNS } = require('../scripts/release-allowlist');
        expect(RELEASE_FILES).not.toContain('package.sh');
        expect(BLOCKED_PATTERNS.some((pattern) => pattern.test('package.sh'))).toBe(true);
    });
});
