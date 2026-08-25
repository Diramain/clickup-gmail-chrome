const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadTsModule(relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;

    const module = { exports: {} };
    const localRequire = (request) => {
        if (request.startsWith('./') || request.startsWith('../')) {
            return loadTsModule(path.join(path.dirname(relativePath), request));
        }
        return require(request);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
}

const hardening = loadTsModule('src/link-hardening.ts');

describe('link hardening helpers', () => {
    test('429/5xx/network are ambiguous and do not purge or mark inactive', () => {
        const task = { id: 't1', name: 'Task', url: 'https://example.test/t/t1', linkStatus: 'linked', createdAt: 1, updatedAt: 1 };

        for (const result of [
            hardening.classifyValidationError(429),
            hardening.classifyValidationError(500),
            hardening.classifyValidationError(undefined, new Error('Network fetch failed')),
        ]) {
            const updated = hardening.applyValidationToTask(task, result, 10);
            expect(updated.linkStatus).toBe('linked');
        }
    });

    test('404 and unlink become explicit inactive states without physical purge', () => {
        const task = { id: 't1', name: 'Task', url: 'https://example.test/t/t1', linkStatus: 'linked', createdAt: 1, updatedAt: 1 };
        const notFound = hardening.applyValidationToTask(task, hardening.classifyValidationError(404), 10);
        const unlinked = hardening.applyValidationToTask(task, { status: 'unlinked', valid: true, linked: false }, 11);

        expect(notFound.linkStatus).toBe('not_found_candidate');
        expect(unlinked.linkStatus).toBe('unlinked_candidate');
        expect(hardening.needsInactiveLinkConfirmation(notFound, hardening.classifyValidationError(404))).toBe(true);
        expect(hardening.needsInactiveLinkConfirmation(unlinked, { status: 'unlinked', valid: true, linked: false })).toBe(true);
        expect([notFound]).toHaveLength(1);
        expect(hardening.toVisibleLinkedTasks([notFound, unlinked])).toHaveLength(2);
    });

    test('second remote confirmation promotes candidate to terminal inactive state', () => {
        const task = { id: 't1', name: 'Task', url: 'https://example.test/t/t1', linkStatus: 'linked', createdAt: 1, updatedAt: 1 };
        const first = hardening.applyValidationToTask(task, hardening.classifyValidationError(404), 10);
        const second = hardening.applyValidationToTask(first, hardening.classifyValidationError(404), 20);
        const firstUnlink = hardening.applyValidationToTask(task, { status: 'unlinked', valid: true, linked: false }, 10);
        const secondUnlink = hardening.applyValidationToTask(firstUnlink, { status: 'unlinked', valid: true, linked: false }, 20);

        expect(second.linkStatus).toBe('not_found');
        expect(secondUnlink.linkStatus).toBe('unlinked');
        expect(hardening.toVisibleLinkedTasks([second, secondUnlink])).toHaveLength(0);
    });

    test('ambiguous errors preserve visible candidate and do not promote terminal', () => {
        const candidate = { id: 't1', name: 'Task', url: 'https://example.test/t/t1', linkStatus: 'not_found_candidate', createdAt: 1, updatedAt: 1 };
        const updated = hardening.applyValidationToTask(candidate, hardening.classifyValidationError(500), 20);

        expect(updated.linkStatus).toBe('not_found_candidate');
        expect(hardening.toVisibleLinkedTasks([updated])).toHaveLength(1);
    });

    test('pending transitions only become linked after confirmed remote linkage', () => {
        expect(hardening.transitionLinkStatus('pending', true)).toBe('linked');
        expect(hardening.transitionLinkStatus('pending', false)).toBe('unverified');
        expect(hardening.transitionLinkStatus('linked', false)).toBe('linked');
    });

    test('custom field selection prefers persisted ID then normalized configured name with emoji support', () => {
        const fields = [
            { id: 'field-name', name: '📧 Gmail Thread ID', value: 'thread-a' },
            { id: 'field-id', name: 'Other Field', value: 'thread-b' },
        ];

        expect(hardening.selectThreadIdCustomField(fields, 'field-id', '📧 Gmail Thread ID').id).toBe('field-id');
        expect(hardening.selectThreadIdCustomField(fields, null, '  📧 Gmail Thread ID  ').id).toBe('field-name');
        expect(hardening.selectThreadIdCustomField(fields, null, 'missing')).toBeNull();
    });

    test('custom field selection excludes fields scoped to a different custom task type', () => {
        const fields = [
            { id: 'default-field', name: 'Gmail Thread ID' },
            { id: 'bug-field', name: 'Gmail Thread ID', applied_objects: [{ object_type: 19, object_id: 101 }] },
            { id: 'request-field', name: 'Gmail Thread ID', applied_objects: [{ object_type: 19, object_id: 202 }] },
        ];

        expect(hardening.selectThreadIdCustomField(fields, null, 'Gmail Thread ID', 202).id).toBe('default-field');
        expect(hardening.selectThreadIdCustomField(fields.slice(1), null, 'Gmail Thread ID', 202).id).toBe('request-field');
        expect(hardening.selectThreadIdCustomField(fields.slice(1), 'bug-field', 'Gmail Thread ID', 202).id).toBe('request-field');
        expect(hardening.selectThreadIdCustomField(fields.slice(1), null, 'Gmail Thread ID', null)).toBeNull();
    });

    test('task creation payload atomically includes only the background-selected Gmail field', () => {
        const payload = hardening.prepareThreadLinkedTaskPayload({
            name: 'Task',
            custom_fields: [{ id: 'untrusted-field', value: 'untrusted' }],
        }, 'gmail-field', 'thread-confirmed');

        expect(payload).toEqual({
            name: 'Task',
            custom_fields: [{ id: 'gmail-field', value: 'thread-confirmed' }],
        });
        expect(hardening.prepareThreadLinkedTaskPayload({ name: 'Task', custom_fields: [{ id: 'x', value: 'y' }] }, null, 'thread-confirmed'))
            .toEqual({ name: 'Task' });
    });

    test('full creation sends the Thread ID in the initial task transaction', () => {
        const background = fs.readFileSync(path.join(__dirname, '..', 'background.ts'), 'utf8');
        const transaction = background.slice(background.indexOf('async function createTaskFull'));
        expect(transaction).toMatch(/prepareThreadLinkedTaskPayload\([\s\S]*clickupAPI!\.createTask\(listId, createPayload\)/);
        expect(transaction).not.toMatch(/appendThreadIdToCustomFieldSerialized/);
        expect(transaction).toMatch(/LINK_LOCAL_MAPPING_FAILED/);
        expect(background).toMatch(/selectThreadIdCustomField\(task\.custom_fields as any\[\], undefined, customFieldName\)/);
        expect(background).toMatch(/if \(!threadIdField\)[\s\S]{0,180}getAccessibleCustomFieldsWithAppliedObjects\(task\.list\.id\)/);
        expect(background).toMatch(/selectThreadIdCustomField\(customFields\.fields as any\[\], undefined, customFieldName, task\.custom_item_id \?\? null\)/);
        expect(background).toMatch(/setCustomFieldValue\(taskId, field\?\.id \|\| fieldId, newValue\)/);
        expect(background).toMatch(/isClickUpCustomFieldUsageLimitError\(e\)[\s\S]{0,420}plan actual de ClickUp alcanzó el límite/);
        expect(background).toMatch(/linkStatus: linkConfirmed \? 'partial_failed' : 'unverified'/);
        expect(background).toMatch(/if \(linkConfirmed\)[\s\S]{0,300}removeEmailTaskMapping\(emailData\.threadId, task\.id\)/);
        const modal = fs.readFileSync(path.join(__dirname, '..', 'src/modal.ts'), 'utf8');
        expect(modal).toMatch(/warning \? 12_000 : 3_000/);
        expect(modal).toMatch(/\.linkStatus !== 'unverified'/);
    });

    test('thread ID values are merged without duplicate comma-separated entries', () => {
        expect(hardening.mergeThreadIdValue('thread-a, thread-b', 'thread-b')).toBe('thread-a,thread-b');
        expect(hardening.mergeThreadIdValue('thread-a', 'thread-c')).toBe('thread-a,thread-c');
    });

    test('migration V1 to V2 is idempotent and preserves V1 fallback reads', () => {
        const v1 = { thread1: [{ id: 't1', name: 'Task', url: 'https://example.test/t/t1' }] };
        const first = hardening.migrateMappingsV1ToV2(v1, {}, 100);
        const second = hardening.migrateMappingsV1ToV2(v1, first, 200);

        expect(second.thread1).toHaveLength(1);
        expect(second.thread1[0].linkStatus).toBe('unverified');
        expect(second.thread1[0].createdAt).toBe(100);
        expect(hardening.toVisibleLinkedTasks(second.thread1)).toHaveLength(1);
        expect(hardening.readMappingsWithFallback(null, v1, 300).thread1[0].createdAt).toBe(300);
    });

    test('sanitizeMappingsV2 normalizes benign missing status/source and strips arbitrary properties', () => {
        const dirty = {
            thread1: [{
                id: 't1',
                name: 'Task',
                url: 'https://example.test/t/t1',
                status: 'open',
                linkStatus: 'surprise',
                linkSource: 'remote_magic',
                createdAt: 1,
                updatedAt: 2,
                token: 'must-not-propagate',
                nested: { arbitrary: true },
            }],
            fallback_123: [{ id: 'bad', name: 'Bad', url: 'u', createdAt: 1, updatedAt: 1 }],
        };

        const sanitized = hardening.sanitizeMappingsV2(dirty);

        expect(Object.keys(sanitized)).toEqual(['thread1']);
        expect(sanitized.thread1[0]).toEqual({
            id: 't1',
            name: 'Task',
            url: 'https://example.test/t/t1',
            status: 'open',
            linkStatus: 'unverified',
            linkSource: 'unknown',
            customFieldId: undefined,
            createdAt: 1,
            updatedAt: 2,
            lastValidatedAt: undefined,
            failureCount: 0,
        });
        expect(sanitized.thread1[0].token).toBeUndefined();
        expect(sanitized.thread1[0].nested).toBeUndefined();
    });

    test('normalizers accept benign trim/case variants and degrade unknowns safely', () => {
        expect(hardening.normalizeLinkStatus(' Linked ')).toBe('linked');
        expect(hardening.normalizeLinkStatus('NOT_FOUND_CANDIDATE')).toBe('not_found_candidate');
        expect(hardening.normalizeLinkStatus('surprise')).toBe('unverified');
        expect(hardening.normalizeLinkSource(' Custom_Field ')).toBe('custom_field');
        expect(hardening.normalizeLinkSource('SYNC')).toBe('sync');
        expect(hardening.normalizeLinkSource('remote_magic')).toBe('unknown');
    });

    test('legacy normalization rejects non-string IDs and normalizes lastValidatedAt', () => {
        const v1 = {
            thread1: [
                { id: { object: true }, name: 'Bad', url: 'https://example.test/t/bad' },
                { id: 'good', name: 'Good', url: 'https://example.test/t/good', lastValidatedAt: '123', linkStatus: ' Linked ', linkSource: ' Legacy ' },
                { id: 'bad-time', name: 'Bad Time', url: 'https://example.test/t/bad-time', lastValidatedAt: -1 },
            ]
        };

        const migrated = hardening.migrateMappingsV1ToV2(v1, {}, 100);

        expect(migrated.thread1.map(task => task.id)).toEqual(['good', 'bad-time']);
        expect(migrated.thread1[0].lastValidatedAt).toBe(123);
        expect(migrated.thread1[0].linkStatus).toBe('linked');
        expect(migrated.thread1[0].linkSource).toBe('legacy');
        expect(migrated.thread1[1].lastValidatedAt).toBeUndefined();
    });

    test('sanitizeMappingsV2 preserves V1 fallback and is idempotent after normalization', () => {
        const v1 = { thread1: [{ id: 'legacy', name: 'Legacy', url: 'https://example.test/t/legacy' }] };
        const v2 = { thread1: [{ id: 'v2', name: 'V2', url: 'https://example.test/t/v2', createdAt: 10, updatedAt: 11 }] };
        const first = hardening.migrateMappingsV1ToV2(v1, v2, 100);
        const second = hardening.migrateMappingsV1ToV2(v1, first, 200);

        expect(second.thread1.map(task => task.id).sort()).toEqual(['legacy', 'v2']);
        expect(second.thread1.find(task => task.id === 'v2').linkStatus).toBe('unverified');
        expect(second.thread1.find(task => task.id === 'legacy').linkSource).toBe('legacy');
    });

    test('rejects GmailAdapter timestamp fallback thread IDs and temporary IDs', () => {
        expect(hardening.isConfirmedThreadId('email_1723312345678')).toBe(false);
        expect(hardening.isConfirmedThreadId('fallback_abc')).toBe(false);
        expect(hardening.isConfirmedThreadId('temp_abc')).toBe(false);
        expect(hardening.isConfirmedThreadId('19b95d11476b81db')).toBe(true);
    });

    test('single-flight shares in-flight work for the same team', async () => {
        const sf = new hardening.SingleFlight();
        let calls = 0;
        const factory = async () => {
            calls += 1;
            return 7;
        };

        const [a, b] = await Promise.all([sf.run('team1', factory), sf.run('team1', factory)]);
        expect(a).toBe(7);
        expect(b).toBe(7);
        expect(calls).toBe(1);
    });

    test('concurrency limiter caps active workers', async () => {
        let active = 0;
        let maxActive = 0;
        await hardening.runWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async (item) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await Promise.resolve();
            active -= 1;
            return item;
        });

        expect(maxActive).toBeLessThanOrEqual(2);
    });

    test('retry delay honors Retry-After/X-RateLimit-Reset with jitter and cap', () => {
        const retryAfterHeaders = new Headers({ 'Retry-After': '2' });
        expect(hardening.calculateRetryDelayMs(retryAfterHeaders, 0, 1000, () => 0)).toBe(2000);

        const resetHeaders = new Headers({ 'X-RateLimit-Reset': '5' });
        expect(hardening.calculateRetryDelayMs(resetHeaders, 0, 1000, () => 0)).toBe(4000);

        const capped = hardening.calculateRetryDelayMs(new Headers({ 'Retry-After': '999' }), 0, 1000, () => 1);
        expect(capped).toBeLessThanOrEqual(hardening.MAX_RETRY_DELAY_MS);
    });

    test('TTL helper revalidates only after the configured window', () => {
        expect(hardening.shouldValidateLink({}, 1000)).toBe(true);
        expect(hardening.shouldValidateLink({ lastValidatedAt: 1000 }, 1000 + hardening.LINK_REVALIDATION_TTL_MS - 1)).toBe(false);
        expect(hardening.shouldValidateLink({ lastValidatedAt: 1000 }, 1000 + hardening.LINK_REVALIDATION_TTL_MS)).toBe(true);
    });

    test('hierarchy preload cooldown suppresses repeated failed attempts', () => {
        const failed = { lastAttemptAt: 1000, status: 'failed' };

        expect(hardening.shouldAttemptHierarchyPreload(failed, 1000 + hardening.HIERARCHY_PRELOAD_COOLDOWN_MS - 1)).toBe(false);
        expect(hardening.shouldAttemptHierarchyPreload(failed, 1000 + hardening.HIERARCHY_PRELOAD_COOLDOWN_MS)).toBe(true);
        expect(hardening.nextHierarchyPreloadStatus(failed, 'success', 5000)).toEqual({
            lastAttemptAt: 5000,
            lastSuccessAt: 5000,
            status: 'success',
        });
    });
});
