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

describe('B2 sanitizer and message security', () => {
    const sanitizer = loadTsModule('src/utils/sanitize.utils.ts');
    const messages = loadTsModule('src/message-security.ts');

    test('sanitizes dangerous Gmail HTML elements, handlers, URLs, remote image, and CSS', () => {
        const html = sanitizer.sanitizeGmailHtml(`
            <div onclick="evil()" style="background:url(https://x.test/a)">Hi<script>x()</script></div>
            <iframe srcdoc="<script>x()</script>"></iframe><form action="https://x.test"><input></form>
            <svg onload="x()"></svg><math></math><img src="https://tracker.test/pixel.png" onerror="x()">
            <a href="javascript:alert(1)">bad</a><a href="https://example.com/message">ok</a>
        `);

        expect(html).not.toMatch(/script|iframe|form|input|svg|math|onclick|onerror|srcdoc|javascript:|tracker\.test|url\(/i);
        expect(html).toContain('https://example.com/message');
        expect(html).toContain('rel="noopener noreferrer nofollow"');
    });

    test('allows only safe external URLs, ClickUp app links, colors, and data image avatars', () => {
        expect(sanitizer.isSafeExternalUrl('https://app.clickup.com/t/abc')).toBe(true);
        expect(sanitizer.isSafeExternalUrl('https://evil.test/t/abc')).toBe(false);
        expect(sanitizer.isSafeExternalUrl('javascript:alert(1)')).toBe(false);
        expect(sanitizer.safeClickUpUrl('https://api.clickup.com/api/v2/task')).toBe('https://app.clickup.com/');
        expect(sanitizer.safeColor('red')).toBe('#7B68EE');
        expect(sanitizer.safeColor('#abc')).toBe('#abc');
        expect(sanitizer.safeAvatarUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(sanitizer.safeAvatarUrl('data:text/html;base64,AAAA')).toBeNull();
        expect(sanitizer.safeAvatarUrl('https://attachments.clickup.com/avatar.png')).toBe('https://attachments.clickup.com/avatar.png');
    });

    test('validates sender id, origin groups, schemas, and size limits', () => {
        const runtimeId = 'ext-id';
        expect(messages.validateExtensionMessage({ action: 'getStatus' }, { id: 'wrong', url: 'chrome-extension://ext-id/popup.html' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SENDER' });
        expect(messages.validateExtensionMessage({ action: 'startTimer', data: { teamId: 't', taskId: 'x' } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_ORIGIN' });
        expect(messages.validateExtensionMessage({ action: 'saveOAuthConfig', data: { clientId: 'id', clientSecret: 'secret' } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_ORIGIN' });
        expect(messages.validateExtensionMessage({ action: 'logout' }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_ORIGIN' });
        expect(messages.validateExtensionMessage({ action: 'authenticate' }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_ORIGIN' });
        expect(messages.validateExtensionMessage({ action: 'createTaskFull', listId: 'list', taskData: { name: 'Task' }, emailData: { threadId: 'th', subject: 's', from: 'f', html: '<p>ok</p>', htmlSanitized: true } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId).ok).toBe(true);
        expect(messages.validateExtensionMessage({ action: 'startTimer', data: { teamId: 't', taskId: 'x' } }, { id: runtimeId, url: 'https://app.clickup.com/123' }, runtimeId).ok).toBe(true);
        expect(messages.validateExtensionMessage({ action: 'attachToTask', taskId: 't', emailData: { threadId: 'th', subject: 's', from: 'f', html: 'x'.repeat(600000) } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
        expect(messages.validateExtensionMessage({ action: 'attachToTask', taskId: 't', emailData: { threadId: 'th', subject: 's', from: 'f', html: '<p>ok</p>' } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
        expect(messages.validateExtensionMessage({ action: 'createTaskFull', listId: 'list', taskData: { name: '', assignees: ['bad'] }, emailData: { threadId: 'th', subject: 's', from: 'f', html: '<p>ok</p>' } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
        expect(messages.validateExtensionMessage({ action: 'searchTasks', data: { query: 'x'.repeat(300) } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
        expect(messages.validateExtensionMessage({ action: 'addTimeEntry', data: { teamId: 't', taskId: 'x', duration: -1 } }, { id: runtimeId, url: 'https://app.clickup.com/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
        const bulkChange = { action: 'applyBulkTaskChange', data: { taskId: 'task-1', listId: 'list-1', status: 'Done', dueDate: null, assigneeId: 1 } };
        expect(messages.validateExtensionMessage(bulkChange, { id: runtimeId, url: 'chrome-extension://ext-id/app/app.html' }, runtimeId).ok).toBe(true);
        expect(messages.validateExtensionMessage(bulkChange, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_ORIGIN' });
        expect(messages.validateExtensionMessage({ ...bulkChange, data: { ...bulkChange.data, extra: true } }, { id: runtimeId, url: 'chrome-extension://ext-id/app/app.html' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
        expect(messages.validateExtensionMessage({ action: 'applyBulkTaskChange', data: { taskId: '../bad', listId: 'list-1', status: 'Done' } }, { id: runtimeId, url: 'chrome-extension://ext-id/app/app.html' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
        expect(messages.validateExtensionMessage({ action: 'attachToTask', taskId: 't', emailData: { threadId: 'th', subject: 's', from: 'f', html: '', attachments: [{ filename: 'x'.repeat(300), mimeType: 'text/plain' }] } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
    });

    test('accepts legitimate popup action schemas without widening Gmail-sensitive actions', () => {
        const runtimeId = 'ext-id';
        const sender = { id: runtimeId, url: 'chrome-extension://ext-id/popup.html' };
        const valid = (message) => messages.validateExtensionMessage(message, sender, runtimeId).ok;

        expect(valid({ action: 'savePreferredTeam', data: { teamId: 'team-1' } })).toBe(true);
        expect(valid({ action: 'getSpaces' })).toBe(true);
        expect(valid({ action: 'getSpaces', data: { teamId: 'team-1' } })).toBe(true);
        expect(valid({ action: 'searchTasks', data: { query: 'invoice', teamId: 'team-1' } })).toBe(true);
        expect(valid({ action: 'createTaskSimple', data: { listId: 'list-1', name: 'Task', description: 'Desc' } })).toBe(true);
        expect(valid({ action: 'startTimer', data: { teamId: 'team-1', taskId: 'task-1' } })).toBe(true);
        expect(valid({ action: 'stopTimer', data: { teamId: 'team-1' } })).toBe(true);
        expect(valid({ action: 'getRunningTimer', data: { teamId: 'team-1' } })).toBe(true);
        expect(valid({ action: 'addTimeEntry', data: { teamId: 'team-1', taskId: 'task-1', duration: 30 * 60 * 1000 } })).toBe(true);
        expect(valid({ action: 'getTimeEntries', data: { teamId: 'team-1' } })).toBe(true);
        expect(valid({ action: 'getTimeEntries', data: { teamId: 'team-1', start_date: Date.now() } })).toBe(false);
        expect(valid({ action: 'preloadFullHierarchy' })).toBe(true);
        expect(valid({ action: 'syncEmailTasks', data: { days: 30 } })).toBe(true);
        expect(valid({ action: 'clearLocalData' })).toBe(true);
        expect(valid({ action: 'findLinkedTasks', data: { threadId: '19b95d11476b81db' } })).toBe(true);

        expect(valid({ action: 'savePreferredTeam', data: { teamId: '' } })).toBe(false);
        expect(valid({ action: 'searchTasks', data: { teamId: 'team-1' } })).toBe(false);
        expect(valid({ action: 'getSpaces', data: { teamId: 't'.repeat(101) } })).toBe(false);
        expect(messages.validateExtensionMessage({ action: 'syncEmailTasks', data: { days: 30 } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_ORIGIN' });
        expect(messages.validateExtensionMessage({ action: 'syncEmailTasks', data: { emailData: { threadId: 'th', subject: 's', from: 'f' } } }, sender, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
        expect(messages.validateExtensionMessage({ action: 'findLinkedTasks', data: { threadId: 'fallback_123' } }, sender, runtimeId)).toEqual({ ok: false, code: 'INVALID_SCHEMA' });
        expect(messages.validateExtensionMessage({ action: 'savePreferredTeam', data: { teamId: 'team-1' } }, { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' }, runtimeId)).toEqual({ ok: false, code: 'INVALID_ORIGIN' });
    });

    test('accepts createTimeEntry legacy and direct shapes with bounded team, task, duration, and start', () => {
        const runtimeId = 'ext-id';
        const sender = { id: runtimeId, url: 'https://app.clickup.com/t/task-1' };
        const valid = (message) => messages.validateExtensionMessage(message, sender, runtimeId).ok;

        expect(valid({ action: 'createTimeEntry', data: { teamId: 'team-1', taskId: 'task-1', duration: 60_000, start: Date.now() } })).toBe(true);
        expect(valid({ action: 'createTimeEntry', data: { teamId: 'team-1', entry: { tid: 'task-1', duration: 60_000, start: Date.now() } } })).toBe(true);
        expect(valid({ action: 'createTimeEntry', data: { teamId: 'team-1', entry: { tid: 'task-1', duration: 60_000, start: '1234567890' } } })).toBe(true);
        expect(valid({ action: 'createTimeEntry', data: { teamId: 'team-1', entry: { tid: 'task-1', duration: -1 } } })).toBe(false);
        expect(valid({ action: 'createTimeEntry', data: { teamId: 'team-1', entry: { duration: 60_000 } } })).toBe(false);
        expect(valid({ action: 'createTimeEntry', data: { teamId: 'team-1', entry: { tid: 'task-1', duration: 60_000, start: '' } } })).toBe(false);
        expect(valid({ action: 'addTimeEntry', data: { teamId: 'team-1', entry: { tid: 'task-1', duration: 60_000 } } })).toBe(false);
    });

    test('accepts legitimate modal action schemas from Gmail and extension contexts', () => {
        const runtimeId = 'ext-id';
        const gmailSender = { id: runtimeId, url: 'https://mail.google.com/mail/u/0/' };
        const extensionSender = { id: runtimeId, url: 'chrome-extension://ext-id/task-modal.html' };
        const validGmail = (message) => messages.validateExtensionMessage(message, gmailSender, runtimeId).ok;
        const validExtension = (message) => messages.validateExtensionMessage(message, extensionSender, runtimeId).ok;
        const emailData = { threadId: 'thread-1', subject: 'Subject', from: 'sender@example.test', html: '<p>ok</p>', htmlSanitized: true };

        expect(validGmail({ action: 'getStatus' })).toBe(true);
        expect(validGmail({ action: 'getTeams' })).toBe(true);
        expect(validGmail({ action: 'getHierarchyCache' })).toBe(true);
        expect(validGmail({ action: 'preloadFullHierarchy' })).toBe(true);
        expect(validGmail({ action: 'getSpaces', teamId: 'team-1' })).toBe(true);
        expect(validGmail({ action: 'getFolders', spaceId: 'space-1' })).toBe(true);
        expect(validGmail({ action: 'getLists', spaceId: 'space-1', folderId: null })).toBe(true);
        expect(validGmail({ action: 'getLists', folderId: 'folder-1' })).toBe(true);
        expect(validGmail({ action: 'getList', listId: 'list-1' })).toBe(true);
        expect(validGmail({ action: 'getMembers', listId: 'list-1' })).toBe(true);
        expect(validGmail({ action: 'getTaskById', taskId: 'task-1' })).toBe(true);
        expect(validGmail({ action: 'searchTasks', query: 'thread task' })).toBe(true);
        expect(validGmail({ action: 'createTaskFull', listId: 'list-1', taskData: { name: 'Task' }, emailData, teamId: 'team-1' })).toBe(true);
        expect(validGmail({ action: 'attachToTask', taskId: 'task-1', emailData })).toBe(true);
        expect(validGmail({ action: 'validateTaskLink', taskId: 'task-1', threadId: 'thread-1' })).toBe(true);

        expect(validExtension({ action: 'createTaskFull', listId: 'list-1', taskData: { name: 'Task' }, emailData, teamId: 'team-1' })).toBe(true);
        expect(validGmail({ action: 'saveOAuthConfig', data: { clientId: 'id', clientSecret: 'secret' } })).toBe(false);
    });

    test('manifest removes contextMenus and restricts ClickUp wildcard', () => {
        const manifest = JSON.parse(source('manifest.json'));
        expect(manifest.permissions).not.toContain('contextMenus');
        expect(manifest.permissions).toContain('tabs');
        expect(manifest.host_permissions).toContain('https://api.clickup.com/*');
        expect(manifest.host_permissions).toContain('https://app.clickup.com/*');
        expect(manifest.host_permissions).not.toContain('https://*.clickup.com/*');
        expect(source('background.ts')).not.toMatch(/contextMenus\.create/);
    });

    test('static high-risk renders use escaping or safe URL helpers', () => {
        const popup = source('popup/popup.ts');
        expect(popup).toMatch(/escapeHTML\(task\.name/);
        expect(popup).toMatch(/safeClickUpUrl\(task\.url/);
        expect(popup).not.toMatch(/data-url="\$\{task\.url\}"/);
        expect(popup).not.toMatch(/<span class="task-name">\$\{task\.name\}<\/span>/);
        const modal = source('src/modal.ts');
        const gmail = source('src/gmail-native.ts');
        expect(modal).not.toMatch(/src="\$\{user\.profilePicture\}"|src="\$\{list\.spaceAvatar\}"|value="\$\{s\.status\}"|color:\s*\$\{s\.color\}|data-id="\$\{user\.id\}"|data-task-url="\$\{task\.url\}"/);
        expect(gmail).not.toMatch(/href="\$\{t\.url\}"|link\.href\s*=\s*matchedTasks\[0\]\.url|window\.open\(matchedTasks!\[0\]\.url/);
    });
});
