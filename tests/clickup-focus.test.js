const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: filename,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
}

const {
    CLICKUP_TASK_TAB_INDEX_MAX_ENTRIES,
    applyManualStopSuppression,
    decideClickUpTaskTabIndexTransition,
    decideLastTaskTabCloseAction,
    decideFocusedTimerAction,
    executeFocusedTimerAction,
    extractTaskIdFromDirectPath,
    extractTaskIdFromInboxBundle,
    removeClickUpTaskTabIndexEntry,
    resolveClickUpFocusContext,
    sanitizeClickUpTaskTabIndex,
    updateClickUpTaskTabIndex,
} = loadTsModule('src/clickup-focus.ts');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function inboxBundle(data) {
    return Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
}

function realShapeBundle(taskId = '86bbbt7xn') {
    return inboxBundle({
        notificationBundleId: `wsid=459065#uid=synthetic##re=clickup:task:459065:${taskId}`,
        entityResourceId: taskId,
        entityResourceType: 'task',
    });
}

describe('ClickUp focused tab context', () => {
    test('resolves direct task URLs without retaining query or fragment data', () => {
        expect(resolveClickUpFocusContext('https://app.clickup.com/t/86bbbt7xn?comment=private#secret')).toEqual({
            kind: 'task', taskId: '86bbbt7xn', source: 'direct',
        });
    });

    test('resolves the task segment from modern workspace-scoped direct URLs', () => {
        expect(resolveClickUpFocusContext('https://app.clickup.com/t/123456/86modern01?comment=private#secret')).toEqual({
            kind: 'task', taskId: '86modern01', source: 'direct',
        });
        expect(extractTaskIdFromDirectPath(['t', '123456', '86modern01'])).toBe('86modern01');
    });

    test('fails closed for incomplete or ambiguous direct task paths', () => {
        expect(resolveClickUpFocusContext('https://app.clickup.com/t/123456/')).toEqual({
            kind: 'no-task', source: 'clickup-other',
        });
        expect(resolveClickUpFocusContext('https://app.clickup.com/t/workspace-name/86modern01')).toEqual({
            kind: 'no-task', source: 'clickup-other',
        });
        expect(resolveClickUpFocusContext('https://app.clickup.com/t/123456/bad%2Ftask')).toEqual({
            kind: 'no-task', source: 'clickup-other',
        });
        expect(resolveClickUpFocusContext('https://app.clickup.com/t/123456/86modern01/extra')).toEqual({
            kind: 'no-task', source: 'clickup-other',
        });
    });

    test('treats the general Inbox as a no-task view', () => {
        expect(resolveClickUpFocusContext('https://app.clickup.com/459065/inbox?tab=primary')).toEqual({
            kind: 'no-task', source: 'inbox',
        });
    });

    test('extracts a task ID from an Inbox notification bundle', () => {
        const bundle = realShapeBundle();
        const url = `https://app.clickup.com/459065/inbox/b/${bundle}`;
        expect(resolveClickUpFocusContext(url)).toEqual({
            kind: 'task', taskId: '86bbbt7xn', source: 'inbox-notification',
        });
    });

    test('accepts percent-encoded padding used by copied Inbox URLs', () => {
        const bundle = encodeURIComponent(realShapeBundle('DEMO_123'));
        expect(resolveClickUpFocusContext(`https://app.clickup.com/459065/inbox/b/${bundle}`)).toEqual({
            kind: 'task', taskId: 'DEMO_123', source: 'inbox-notification',
        });
    });

    test('fails closed for malformed, non-task, or invalid-ID bundles', () => {
        expect(extractTaskIdFromInboxBundle('not-base64')).toBeNull();
        expect(extractTaskIdFromInboxBundle(inboxBundle({ entityResourceType: 'comment', entityResourceId: '86bbbt7xn' }))).toBeNull();
        expect(extractTaskIdFromInboxBundle(inboxBundle({ entityResourceType: 'task', entityResourceId: 'bad/id' }))).toBeNull();
    });

    test('does not classify foreign origins as ClickUp', () => {
        expect(resolveClickUpFocusContext('https://example.test/t/86bbbt7xn')).toEqual({
            kind: 'outside-clickup', source: 'outside-clickup',
        });
    });
});

describe('ClickUp task-tab session index', () => {
    test('stores only bounded tab/task pairs and never retains a URL or Inbox payload', () => {
        let index = updateClickUpTaskTabIndex({}, 7, 'https://app.clickup.com/t/123456/TASK_A?private=value');
        const bundle = realShapeBundle('TASK_A');
        index = updateClickUpTaskTabIndex(index, 8, `https://app.clickup.com/123456/inbox/b/${bundle}`);

        expect(index).toEqual({ 7: 'TASK_A', 8: 'TASK_A' });
        expect(JSON.stringify(index)).not.toContain('clickup.com');
        expect(JSON.stringify(index)).not.toContain(bundle);

        index = updateClickUpTaskTabIndex(index, 7, 'https://app.clickup.com/123456/inbox?tab=primary');
        expect(index).toEqual({ 8: 'TASK_A' });
    });

    test('sanitizes malformed state and refuses to grow beyond the fixed cap', () => {
        expect(sanitizeClickUpTaskTabIndex({
            1: 'TASK_A',
            '-1': 'TASK_B',
            nope: 'TASK_C',
            2: 'bad/task',
        })).toEqual({ 1: 'TASK_A' });

        const full = Object.fromEntries(Array.from(
            { length: CLICKUP_TASK_TAB_INDEX_MAX_ENTRIES },
            (_, index) => [String(index + 1), `TASK_${index}`],
        ));
        const unchanged = updateClickUpTaskTabIndex(
            full,
            CLICKUP_TASK_TAB_INDEX_MAX_ENTRIES + 10,
            'https://app.clickup.com/t/123456/EXTRA_TASK',
        );
        expect(Object.keys(unchanged)).toHaveLength(CLICKUP_TASK_TAB_INDEX_MAX_ENTRIES);
        expect(unchanged[CLICKUP_TASK_TAB_INDEX_MAX_ENTRIES + 10]).toBeUndefined();
    });

    test('atomically returns and removes the task associated with a closed tab', () => {
        expect(removeClickUpTaskTabIndexEntry({ 7: 'TASK_A', 8: 'TASK_B' }, 7)).toEqual({
            nextIndex: { 8: 'TASK_B' },
            taskId: 'TASK_A',
        });
        expect(removeClickUpTaskTabIndexEntry({ 8: 'TASK_B' }, 99)).toEqual({
            nextIndex: { 8: 'TASK_B' },
            taskId: null,
        });
    });

    test('pure transition detects task to Kanban, Home, Inbox, and task A to B without raw retention', () => {
        expect(decideClickUpTaskTabIndexTransition({ 7: 'TASK_A' }, 7, 'https://app.clickup.com/123/v/l/li/list')).toEqual({
            nextIndex: {}, previousTaskId: 'TASK_A', nextTaskId: null, exitedTaskId: 'TASK_A', outcome: 'index-hit',
        });
        expect(decideClickUpTaskTabIndexTransition({ 7: 'TASK_A' }, 7, 'https://app.clickup.com/')).toEqual({
            nextIndex: {}, previousTaskId: 'TASK_A', nextTaskId: null, exitedTaskId: 'TASK_A', outcome: 'index-hit',
        });
        expect(decideClickUpTaskTabIndexTransition({ 7: 'TASK_A' }, 7, 'https://app.clickup.com/123/inbox?tab=primary')).toEqual({
            nextIndex: {}, previousTaskId: 'TASK_A', nextTaskId: null, exitedTaskId: 'TASK_A', outcome: 'index-hit',
        });
        expect(decideClickUpTaskTabIndexTransition({ 7: 'TASK_A' }, 7, 'https://app.clickup.com/t/123/TASK_B?secret=value')).toEqual({
            nextIndex: { 7: 'TASK_B' }, previousTaskId: 'TASK_A', nextTaskId: 'TASK_B', exitedTaskId: 'TASK_A', outcome: 'index-hit',
        });
    });
});

describe('Last task-tab close policy', () => {
    const enabled = { autoStopTimer: true };

    test('stops only when the closed tab and running timer are the same task', () => {
        expect(decideLastTaskTabCloseAction(enabled, 'TASK_A', 'TASK_A', [], false)).toEqual({
            type: 'stop', reason: 'last-task-tab-closed',
        });
        expect(decideLastTaskTabCloseAction(enabled, 'TASK_B', 'TASK_A', [], false)).toEqual({
            type: 'none', reason: 'closed-different-task',
        });
    });

    test('another direct or Inbox-notification tab for the same task preserves the timer', () => {
        const inboxUrl = `https://app.clickup.com/123456/inbox/b/${realShapeBundle('TASK_A')}`;
        expect(decideLastTaskTabCloseAction(
            enabled,
            'TASK_A',
            'TASK_A',
            ['https://app.clickup.com/t/123456/TASK_A'],
            false,
        )).toEqual({ type: 'none', reason: 'same-task-tab-open' });
        expect(decideLastTaskTabCloseAction(enabled, 'TASK_A', 'TASK_A', [inboxUrl], false)).toEqual({
            type: 'none', reason: 'same-task-tab-open',
        });
    });

    test('general Inbox and unrelated task tabs do not preserve the closed task', () => {
        expect(decideLastTaskTabCloseAction(
            enabled,
            'TASK_A',
            'TASK_A',
            [
                'https://app.clickup.com/123456/inbox?tab=primary',
                'https://app.clickup.com/t/123456/TASK_B',
                'https://mail.google.com/mail/u/0/#inbox',
            ],
            false,
        )).toEqual({ type: 'stop', reason: 'last-task-tab-closed' });
    });

    test('task to Kanban/Home/Inbox stops only without another equivalent task view', () => {
        for (const remaining of [
            ['https://app.clickup.com/123/v/l/li/list'],
            ['https://app.clickup.com/'],
            ['https://app.clickup.com/123/inbox?tab=primary'],
        ]) {
            expect(decideLastTaskTabCloseAction(enabled, 'TASK_A', 'TASK_A', remaining, false)).toEqual({ type: 'stop', reason: 'last-task-tab-closed' });
            expect(decideLastTaskTabCloseAction(enabled, 'TASK_A', 'TASK_A', [...remaining, 'https://app.clickup.com/t/123/TASK_A'], false)).toEqual({ type: 'none', reason: 'same-task-tab-open' });
        }
    });

    test('fails closed when Auto-Stop is disabled, identity is unknown, or Meet has authority', () => {
        expect(decideLastTaskTabCloseAction({ autoStopTimer: false }, 'TASK_A', 'TASK_A', [], false)).toEqual({
            type: 'none', reason: 'auto-stop-disabled',
        });
        expect(decideLastTaskTabCloseAction(enabled, null, 'TASK_A', [], false)).toEqual({
            type: 'none', reason: 'closed-task-unknown',
        });
        expect(decideLastTaskTabCloseAction(enabled, 'TASK_A', null, [], false)).toEqual({
            type: 'none', reason: 'running-task-unknown',
        });
        expect(decideLastTaskTabCloseAction(enabled, 'TASK_A', 'TASK_A', [], true)).toEqual({
            type: 'none', reason: 'meet-priority',
        });
    });
});

describe('Focused timer execution ordering', () => {
    function executor(overrides = {}) {
        return {
            isCurrent: jest.fn().mockResolvedValue(true),
            validateTask: jest.fn().mockResolvedValue(true),
            stopTimer: jest.fn().mockResolvedValue(undefined),
            startTimer: jest.fn().mockResolvedValue(undefined),
            ...overrides,
        };
    }

    test('validates the destination before stopping the current task', async () => {
        const calls = [];
        const deps = executor({
            validateTask: jest.fn(async () => { calls.push('validate'); return true; }),
            isCurrent: jest.fn(async () => { calls.push('current'); return true; }),
            stopTimer: jest.fn(async () => { calls.push('stop'); }),
            startTimer: jest.fn(async () => { calls.push('start'); }),
        });

        await expect(executeFocusedTimerAction({ type: 'switch', taskId: 'B', reason: 'direct' }, deps)).resolves.toBe('switched');
        expect(calls).toEqual(['validate', 'current', 'stop', 'current', 'start']);
    });

    test('does not stop when the destination task is invalid', async () => {
        const deps = executor({ validateTask: jest.fn().mockResolvedValue(false) });
        await expect(executeFocusedTimerAction({ type: 'switch', taskId: 'B', reason: 'direct' }, deps)).resolves.toBe('invalid-task');
        expect(deps.stopTimer).not.toHaveBeenCalled();
        expect(deps.startTimer).not.toHaveBeenCalled();
    });

    test('never starts the destination when focus changes after stop', async () => {
        const deps = executor({
            isCurrent: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
        });
        await expect(executeFocusedTimerAction({ type: 'switch', taskId: 'B', reason: 'direct' }, deps)).resolves.toBe('stopped-after-focus-change');
        expect(deps.stopTimer).toHaveBeenCalledTimes(1);
        expect(deps.startTimer).not.toHaveBeenCalled();
    });

    test('a failed stop rejects and cannot start the destination', async () => {
        const deps = executor({ stopTimer: jest.fn().mockRejectedValue(new Error('stop failed')) });
        await expect(executeFocusedTimerAction({ type: 'switch', taskId: 'B', reason: 'direct' }, deps)).rejects.toThrow('stop failed');
        expect(deps.startTimer).not.toHaveBeenCalled();
    });
});

describe('Focused timer transition policy', () => {
    const both = { autoStartTimer: true, autoStopTimer: true };

    test('starts when a task is focused and no timer is running', () => {
        expect(decideFocusedTimerAction(both, { kind: 'task', taskId: 'A', source: 'direct' }, null)).toEqual({
            type: 'start', taskId: 'A', reason: 'direct',
        });
    });

    test('switches only when both automatic controls are enabled', () => {
        expect(decideFocusedTimerAction(both, { kind: 'task', taskId: 'B', source: 'direct' }, 'A')).toEqual({
            type: 'switch', taskId: 'B', reason: 'direct',
        });
        expect(decideFocusedTimerAction({ autoStartTimer: true, autoStopTimer: false }, { kind: 'task', taskId: 'B', source: 'direct' }, 'A')).toEqual({
            type: 'none', reason: 'timer-already-running',
        });
    });

    test('keeps the current work session on general Inbox', () => {
        expect(decideFocusedTimerAction(both, { kind: 'no-task', source: 'inbox' }, 'A')).toEqual({
            type: 'none', reason: 'inbox',
        });
        expect(decideFocusedTimerAction({ autoStartTimer: true, autoStopTimer: false }, { kind: 'no-task', source: 'inbox' }, 'A')).toEqual({
            type: 'none', reason: 'inbox',
        });
    });

    test('keeps the current work session on ClickUp lists, dashboards, and settings', () => {
        const context = resolveClickUpFocusContext('https://app.clickup.com/459065/v/l/li/123');
        expect(context).toEqual({ kind: 'no-task', source: 'clickup-other' });
        expect(decideFocusedTimerAction(both, context, 'A')).toEqual({
            type: 'none', reason: 'clickup-other',
        });
    });

    test('keeps the current work session while Gmail, Chatwoot, or another web tab is focused', () => {
        expect(decideFocusedTimerAction(both, { kind: 'outside-clickup', source: 'outside-clickup' }, 'A')).toEqual({
            type: 'none', reason: 'outside-clickup',
        });
        expect(decideFocusedTimerAction({ autoStartTimer: true, autoStopTimer: false }, { kind: 'outside-clickup', source: 'outside-clickup' }, 'A')).toEqual({
            type: 'none', reason: 'outside-clickup',
        });
    });

    test('uses auto-stop to leave task A and auto-start to enter task B', () => {
        expect(decideFocusedTimerAction({ autoStartTimer: true, autoStopTimer: false }, { kind: 'task', taskId: 'B', source: 'direct' }, 'A')).toEqual({
            type: 'none', reason: 'timer-already-running',
        });
        expect(decideFocusedTimerAction({ autoStartTimer: false, autoStopTimer: true }, { kind: 'task', taskId: 'B', source: 'direct' }, 'A')).toEqual({
            type: 'stop', reason: 'different-task',
        });
    });

    test('manual stop suppression blocks only the same task and clears on a different task', () => {
        const { applyManualStopSuppression } = loadTsModule('src/clickup-focus.ts');
        const startA = { type: 'start', taskId: 'A', reason: 'direct' };
        const startB = { type: 'start', taskId: 'B', reason: 'direct' };

        expect(applyManualStopSuppression(startA, 'A')).toEqual({
            action: { type: 'none', reason: 'manually-stopped' },
            nextSuppressedTaskId: 'A',
        });
        expect(applyManualStopSuppression(startB, 'A')).toEqual({
            action: startB,
            nextSuppressedTaskId: 'A',
        });
    });

    test('invalid task B cannot clear task A suppression or stop/start any timer', async () => {
        const proposed = decideFocusedTimerAction(both, { kind: 'task', taskId: 'B', source: 'direct' }, null);
        const suppression = applyManualStopSuppression(proposed, 'A');
        const deps = {
            isCurrent: jest.fn().mockResolvedValue(true),
            validateTask: jest.fn().mockResolvedValue(false),
            stopTimer: jest.fn().mockResolvedValue(undefined),
            startTimer: jest.fn().mockResolvedValue(undefined),
        };

        await expect(executeFocusedTimerAction(suppression.action, deps)).resolves.toBe('invalid-task');
        expect(suppression.nextSuppressedTaskId).toBe('A');
        expect(deps.stopTimer).not.toHaveBeenCalled();
        expect(deps.startTimer).not.toHaveBeenCalled();
    });

    test('valid task B keeps task A suppression until B has actually started', async () => {
        const proposed = decideFocusedTimerAction(both, { kind: 'task', taskId: 'B', source: 'direct' }, null);
        const suppression = applyManualStopSuppression(proposed, 'A');
        let persistedSuppression = suppression.nextSuppressedTaskId;
        const deps = {
            isCurrent: jest.fn().mockResolvedValue(true),
            validateTask: jest.fn().mockResolvedValue(true),
            stopTimer: jest.fn().mockResolvedValue(undefined),
            startTimer: jest.fn(async () => { persistedSuppression = null; }),
        };

        expect(persistedSuppression).toBe('A');
        await expect(executeFocusedTimerAction(suppression.action, deps)).resolves.toBe('started');
        expect(persistedSuppression).toBeNull();
    });

    test('does nothing for the same task or disabled automation', () => {
        expect(decideFocusedTimerAction(both, { kind: 'task', taskId: 'A', source: 'direct' }, 'A')).toEqual({
            type: 'none', reason: 'same-task',
        });
        expect(decideFocusedTimerAction({ autoStartTimer: false, autoStopTimer: false }, { kind: 'task', taskId: 'A', source: 'direct' }, null)).toEqual({
            type: 'none', reason: 'disabled',
        });
    });
});

describe('Focused timer integration guardrails', () => {
    test('background owns focus and URL events while content script cannot write timers', () => {
        const background = source('background.ts');
        const content = source('src/clickup-tracker.ts');

        expect(background).toMatch(/chrome\.windows\.onFocusChanged\.addListener/);
        expect(background).toMatch(/chrome\.tabs\.onActivated\.addListener/);
        expect(background).toMatch(/chrome\.tabs\.onUpdated\.addListener/);
        expect(background).toMatch(/chrome\.windows\.getLastFocused/);
        expect(background).toMatch(/chrome\.tabs\.query\(\{ active: true, windowId: focusedWindow\.id \}\)/);
        expect(background).toMatch(/const result = timerWriteQueue\.then/);
        expect(background).toMatch(/timerWriteQueue = result\.then/);
        expect(background).toMatch(/case 'startTimer':[\s\S]{0,200}runTimerWrite/);
        expect(content).toMatch(/focusedClickUpNavigation/);
        expect(content).not.toMatch(/startTimer|stopTimer|time_entries|dispatchEvent|\.click\(/);
    });

    test('last-tab close uses session-only identity, global tab read-back, and a race-safe single stop', () => {
        const background = source('background.ts');

        expect(background).toMatch(/CLICKUP_TASK_TAB_INDEX_SESSION_KEY = 'clickUpTaskTabIndexV1'/);
        expect(background).toMatch(/chrome\.tabs\.onRemoved\.addListener[\s\S]{0,350}handleTrackedClickUpTaskTabRemoved\(tabId\)/);
        expect(background).toMatch(/case 'focusedClickUpNavigation':[\s\S]{0,220}updateTrackedClickUpTaskTab\(sender\.tab\.id/);
        expect(background).toMatch(/stopTimerAfterLastTaskTabClose[\s\S]{0,1800}chrome\.tabs\.query\(\{ url: 'https:\/\/app\.clickup\.com\/\*' \}\)/);
        expect(background).toMatch(/const runningBeforeTabQuery = await clickupAPI!\.getRunningTimer\(teamId\)[\s\S]{0,1800}const runningBeforeStop = await clickupAPI!\.getRunningTimer\(teamId\)/);
        expect(background).toMatch(/if \(getRunningTaskId\(runningBeforeStop\) !== closedTaskId\) \{[\s\S]{0,220}return;[\s\S]{0,120}\}[\s\S]{0,120}await clickupAPI!\.stopTimer\(teamId\)/);
        expect(background).toMatch(/handleTrackedClickUpTaskTabRemoved[\s\S]{0,520}emitCausalTrace\(\{ event: 'index'[\s\S]{0,320}runTimerWrite\(\(\) => stopTimerAfterLastTaskTabClose\(closedTaskId\)\)/);
        expect(background).toMatch(/meetPriorityActive[\s\S]{0,180}if \(meetPriorityActive\) return/);
        expect(background).toMatch(/if \(changes\.autoStopTimer\)[\s\S]{0,220}hydrateTrackedClickUpTaskTabs\(\)[\s\S]{0,120}clearTrackedClickUpTaskTabIndex\(\)/);
        expect(background).toMatch(/async function hydrateTrackedClickUpTaskTabs[\s\S]{0,220}if \(!settings\.autoStopTimer\)[\s\S]{0,100}clearTrackedClickUpTaskTabIndex/);
    });

    test('task-tab index is cleared at authentication and local-data boundaries', () => {
        const background = source('background.ts');
        expect((background.match(/CLICKUP_TASK_TAB_INDEX_SESSION_KEY/g) || []).length).toBeGreaterThanOrEqual(5);
        expect(background).toMatch(/invalidateAuthenticationSession[\s\S]{0,1800}CLICKUP_TASK_TAB_INDEX_SESSION_KEY/);
        expect(background).toMatch(/case 'logout':[\s\S]{0,1500}CLICKUP_TASK_TAB_INDEX_SESSION_KEY/);
        expect(background).toMatch(/async function clearLocalData[\s\S]{0,1800}CLICKUP_TASK_TAB_INDEX_SESSION_KEY/);
    });

    test('manual stop is persisted as a same-task auto-start suppression', () => {
        const background = source('background.ts');
        expect(background).toMatch(/AUTO_START_SUPPRESSED_TASK_SESSION_KEY/);
        expect(background).toMatch(/case 'stopTimer':[\s\S]{0,500}persistManualStopSuppression/);
        expect(background).toMatch(/applyManualStopSuppression/);
        expect(background).toMatch(/case 'startTimer':[\s\S]{0,700}validateFocusedTask[\s\S]{0,350}getRunningTimer[\s\S]{0,350}stopTimer[\s\S]{0,350}startTimer/);
    });

    test('logout suspends focus automation and attempts remote stop before token removal', () => {
        const background = source('background.ts');
        expect(background).toMatch(/case 'logout':[\s\S]{0,100}logoutInProgress = true/);
        expect(background.indexOf('await stopRunningTimerBeforeLogout()')).toBeLessThan(background.indexOf("await removeSecureToken(STORAGE_KEYS.AUTH_TOKEN)", background.indexOf("case 'logout':")));
        expect(background).toMatch(/revision !== focusedTimerRevision \|\| logoutInProgress/);
    });

    test('session guard survives worker restarts but is cleared at identity/data boundaries', () => {
        const background = source('background.ts');
        expect(background).toMatch(/chrome\.storage\.session\.get\(AUTO_START_SUPPRESSED_TASK_SESSION_KEY\)/);
        expect(background).toMatch(/invalidateAuthenticationSession[\s\S]{0,1600}AUTO_START_SUPPRESSED_TASK_SESSION_KEY/);
        expect(background).toMatch(/case 'logout':[\s\S]{0,1400}AUTO_START_SUPPRESSED_TASK_SESSION_KEY/);
        expect(background).toMatch(/async function clearLocalData[\s\S]{0,1700}AUTO_START_SUPPRESSED_TASK_SESSION_KEY/);
    });

    test('creating task B in Gmail cannot write timers until a ClickUp task becomes focused', () => {
        const gmail = source('src/gmail-native.ts');
        const modal = source('src/modal.ts');
        expect(gmail).not.toMatch(/action:\s*['"](?:startTimer|stopTimer)['"]/);
        expect(modal).toMatch(/action: 'createTaskFull'/);
        expect(modal).not.toMatch(/action:\s*['"](?:startTimer|stopTimer)['"]/);
    });

    test('focused-task validation diagnostics expose only bounded failure classes', () => {
        const background = source('background.ts');
        expect(background).toMatch(/FOCUSED_TIMER_TASK_VALIDATION_FAILED_\$\{classifyFocusedTaskValidationFailure\(error\)\}/);
        expect(background).toMatch(/status === 401 \|\| status === 403 \|\| status === 404 \|\| status === 429/);
        expect(background).toMatch(/WORKSPACE_NOT_AUTHORIZED/);
        expect(background).not.toMatch(/FOCUSED_TIMER_TASK_VALIDATION_FAILED_\$\{(?:taskId|teamId|error\.message)/);
        expect(background).toMatch(/isClickUpWorkspaceAuthorizationError\(error\)[\s\S]{0,300}getWorkspaceTaskById\(teamId, taskId\)/);
        expect(background).toMatch(/FOCUSED_TIMER_TASK_NOT_IN_AUTHORIZED_WORKSPACE/);
    });

    test('message gate allows only payload-free navigation notifications from ClickUp', () => {
        const security = source('src/message-security.ts');
        expect(security).toMatch(/CLICKUP_ACTIONS[^\n]*'focusedClickUpNavigation'/);
        expect(security).toMatch(/origin\.startsWith\('https:\/\/app\.clickup\.com\/'\)/);
        expect(security).toMatch(/case 'focusedClickUpNavigation':[\s\S]*Object\.keys\(data\)\.length === 0/);
        expect(security).not.toMatch(/case 'focusedClickUpNavigation':[\s\S]{0,200}(data\.url|message\.url)/);
    });
});
