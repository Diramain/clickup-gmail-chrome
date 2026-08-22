/**
 * Gmail Content Script - Native Implementation
 * Uses GmailAdapter for DOM queries and Logger for output
 * 
 * SECURITY: ISO 27001 compliant - CSP-safe
 */

import type { ILogger } from './logger';
import type { IGmailAdapter } from './gmail-adapter';
import { TaskModal } from './modal';
import { ensureThreadBar, reconcileLinkedTaskAnchors, reconcileThreadBarState } from './gmail-render-utils';
import {
    applyValidationToTask,
    isConfirmedThreadId,
    readMappingsWithFallback,
    shouldValidateLink,
    toVisibleLinkedTasks,
    type EmailTaskMappingV2,
    type LinkValidationResult,
} from './link-hardening';
import { safeClickUpUrl, sanitizeGmailHtml } from './utils/sanitize.utils';
import { isAllowedGmailAttachmentUrl, isAllowedGmailImageMimeType, sanitizeGmailAttachmentFilename } from './gmail-attachment-security';

// Declare global types for content script context
declare const Logger: ILogger;
declare const GmailAdapter: IGmailAdapter;

// ============================================================================
// Types
// ============================================================================

type TaskMapping = EmailTaskMappingV2;

interface EmailData {
    threadId: string;
    subject: string;
    from: string;
    html: string;
    htmlSanitized?: true;
    attachments?: { url: string; filename: string; mimeType: string }[];
}

interface TaskCreatedEvent extends CustomEvent<{ task: TaskMapping; threadId: string }> { }

// ============================================================================
// State
// ============================================================================

Logger.info('Gmail content script loading...');

// Listen for messages from popup immediately
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'gmailIntegrationPreferenceChanged' && typeof request.enabled === 'boolean') {
        gmailIntegrationEnabled = request.enabled;
        applyGmailIntegrationState();
        sendResponse({ success: true });
        return;
    }
    if (request.action === 'openTaskModal') {
        if (!gmailIntegrationEnabled) {
            sendResponse({ success: false });
            return;
        }
        Logger.info(' Received openTaskModal command from popup');
        const threadId = getThreadId();
        if (threadId) {
            openTaskModal(threadId);
            sendResponse({ success: true });
        } else {
                Logger.warn('THREAD_ID_NOT_AVAILABLE_FOR_MODAL');
            sendResponse({ success: false });
        }
    }
});

let linkedTasks: Record<string, TaskMapping[]> = {};
const validationInFlight = new Map<string, Promise<void>>();
const messageBodyByBar = new WeakMap<HTMLElement, HTMLElement>();
let gmailIntegrationEnabled = true;
let gmailObserver: MutationObserver | null = null;

// Debounce utility
let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedScan(): void {
    if (scanDebounceTimer) return;
    scanDebounceTimer = setTimeout(() => {
        scanDebounceTimer = null;
        scanEmails();
        scanInbox();
    }, 100);
}

// ============================================================================
// Initialization
// ============================================================================

async function initialize(): Promise<void> {
    Logger.info('Initializing...');
    try {
        const preference = await chrome.runtime.sendMessage({ action: 'getGmailIntegrationPreference' }) as { enabled?: boolean };
        gmailIntegrationEnabled = preference?.enabled !== false;
    } catch {
        gmailIntegrationEnabled = true;
    }
    applyGmailIntegrationState();
    loadLinkedTasks();

    window.addEventListener('cu-task-created', ((e: TaskCreatedEvent) => {
        const { task, threadId } = e.detail;
        updateLinkedTasksDisplay(threadId, task);
    }) as EventListener);


}

function applyGmailIntegrationState(): void {
    if (!gmailIntegrationEnabled) {
        gmailObserver?.disconnect();
        gmailObserver = null;
        if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
        scanDebounceTimer = null;
        document.querySelectorAll('.cu-email-bar, .cu-inbox-task-badge').forEach(element => element.remove());
        document.querySelectorAll('.cu-modal-container').forEach(element => element.remove());
        return;
    }
    startObserver();
}

// ============================================================================
// Task Loading and Validation
// ============================================================================

async function loadLinkedTasks(): Promise<void> {
    try {
        const result = await chrome.runtime.sendMessage({ action: 'getEmailTaskMappings' });
        const allTasks = readMappingsWithFallback(result || {}, {}) as Record<string, TaskMapping[]>;

        const keys = Object.keys(allTasks);
        if (keys.length > 0) {
            Logger.debug(`Loaded linked task threads: ${keys.length}`);
        }

        linkedTasks = allTasks;
        scanInbox();
    } catch (e) {
        linkedTasks = {};
    }
}

// ============================================================================
// DOM Observation
// ============================================================================

function startObserver(): void {
    if (gmailObserver || !gmailIntegrationEnabled) return;
    Logger.debug('Starting MutationObserver...');
    gmailObserver = new MutationObserver(() => {
        requestAnimationFrame(debouncedScan);
    });

    gmailObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
            'data-legacy-thread-id',
            'data-thread-perm-id',
            'data-thread-id',
            'data-message-id',
            'data-legacy-message-id',
        ],
    });

    scanEmails();
    scanInbox();
}

// ============================================================================
// Email Scanning
// ============================================================================

function scanEmails(): void {
    if (!gmailIntegrationEnabled) return;
    const emailBodies = GmailAdapter.getAllEmailBodies();
    if (emailBodies.length > 0) {
        Logger.debug(`ScanEmails: found ${emailBodies.length} email bodies`);
    }

    emailBodies.forEach((body) => {
        try {
            if (!body.isConnected) return;
            const mountHost = body.parentElement;
            if (!mountHost) return;

            const threadId = getThreadId();
            const bar = ensureThreadBar(
                mountHost as HTMLElement,
                body as HTMLElement,
                threadId,
                (id) => createClickUpBar(id, body as HTMLElement),
                reconcileClickUpBar,
            );
            messageBodyByBar.set(bar, body as HTMLElement);
        } catch (error) {
            Logger.warn('EMAIL_BODY_SCAN_FAILED');
        }
    });
}

function scanInbox(): void {
    if (!gmailIntegrationEnabled) return;
    const inboxRows = document.querySelectorAll('tr.zA');

    inboxRows.forEach((row) => {
        const threadEl = row.querySelector('[data-legacy-thread-id]');
        if (!threadEl) return;

        const legacyThreadId = threadEl.getAttribute('data-legacy-thread-id');
        if (!legacyThreadId) return;

        if (row.querySelector('.cu-inbox-task-badge')) return;

        let matchedTasks = linkedTasks[legacyThreadId] ||
            linkedTasks['email_' + legacyThreadId];

        if (!matchedTasks) {
            for (const [key, tasks] of Object.entries(linkedTasks)) {
                if (key.includes(legacyThreadId)) {
                    matchedTasks = tasks;
                    break;
                }
            }
        }

        if (matchedTasks) matchedTasks = toVisibleLinkedTasks(matchedTasks);

        if (matchedTasks && matchedTasks.length > 0) {
            const subjectSpan = row.querySelector('.bqe') ||
                row.querySelector('.bog span') ||
                row.querySelector('.y6 span');
            const subjectCell = row.querySelector('td.xY') || row.querySelector('td.a4W');

            const badge = document.createElement('span');
            badge.className = 'cu-inbox-task-badge';
            badge.title = `ClickUp: ${matchedTasks.map(t => t.name).join(', ')}`;
            badge.style.cssText = 'display: inline-flex; margin-right: 6px; vertical-align: middle;';

            if (matchedTasks.length === 1) {
                const link = document.createElement('a');
                link.href = safeClickUpUrl(matchedTasks[0].url);
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.className = 'cu-inbox-task-link';
                link.textContent = '#' + matchedTasks[0].id;
                link.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    window.open(safeClickUpUrl(matchedTasks![0].url), '_blank', 'noopener,noreferrer');
                });
                badge.appendChild(link);
            } else {
                const countSpan = document.createElement('span');
                countSpan.className = 'cu-inbox-task-count';
                countSpan.textContent = `${matchedTasks.length} tareas`;
                badge.appendChild(countSpan);
            }

            if (subjectSpan?.parentElement) {
                subjectSpan.parentElement.insertBefore(badge, subjectSpan);
                Logger.info(' Added inbox badge');
            } else if (subjectCell) {
                const firstChild = subjectCell.querySelector('.y6') || subjectCell.firstChild;
                if (firstChild?.parentElement) {
                    firstChild.parentElement.insertBefore(badge, firstChild);
                    Logger.info(' Added inbox badge fallback');
                }
            }
        }
    });
}

// ============================================================================
// Helper Functions
// ============================================================================

function getThreadId(): string | null {
    const threadId = GmailAdapter.getThreadId();
    Logger.debug('Thread ID resolved');
    return threadId;
}

function getEmailSubject(): string {
    return GmailAdapter.getSubject();
}

function getSenderEmail(scope?: Element | null): string {
    return GmailAdapter.getSenderEmail(scope);
}

function getEmailBody(body?: Element | null): string {
    return sanitizeGmailHtml(GmailAdapter.getEmailBodyHtml(body));
}

// ============================================================================
// ClickUp Bar Injection
// ============================================================================

function injectClickUpBar(container: HTMLElement, body: HTMLElement, threadId: string | null): void {
    const bar = createClickUpBar(threadId);
    body.parentElement?.insertBefore(bar, body);
    Logger.info(' Bar injected');
    if (isConfirmedThreadId(threadId)) verifyThreadTasks(threadId, bar);
}

function createClickUpBar(threadId: string | null, messageBody?: HTMLElement): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'cu-email-bar';
    if (isConfirmedThreadId(threadId)) {
        bar.dataset.threadId = threadId;
        delete bar.dataset.threadPending;
    } else {
        bar.dataset.threadId = '';
        bar.dataset.threadPending = 'true';
    }
    bar.dataset.createdAt = Date.now().toString();

    Logger.debug(` Injecting bar with tasks: ${isConfirmedThreadId(threadId) ? (linkedTasks[threadId] || []).length : 0}`);

    const pending = !isConfirmedThreadId(threadId);

    bar.innerHTML = `
    <div class="cu-bar-content">
      <div class="cu-bar-actions">
      <button class="cu-add-btn" title="${pending ? 'Esperando datos de Gmail' : 'Crear tarea de ClickUp desde este email'}" ${pending ? 'disabled aria-disabled="true"' : ''}>
        <svg width="16" height="16" viewBox="0 0 180 180" fill="currentColor">
          <path d="M25.4 129.1L49.2 110.9C61.9 127.4 75.3 135 90.3 135C105.1 135 118.2 127.5 130.3 111.1L154.4 128.9C137 152.5 115.3 165 90.3 165C65.3 165 43.4 152.6 25.4 129.1Z"/>
          <polygon points="90.2 49.8 47.8 86.4 28.2 63.6 90.3 10.2 151.8 63.7 132.2 86.3"/>
        </svg>
        <span class="cu-add-label">${pending ? 'Esperando datos de Gmail…' : 'Crear tarea'}</span>
      </button>
      <button class="cu-attach-btn" type="button" title="${pending ? 'Esperando datos de Gmail' : 'Vincular este email a una tarea existente'}" ${pending ? 'disabled aria-disabled="true"' : ''}>Vincular existente</button>
      </div>
      <section class="cu-linked-section" aria-label="Tareas vinculadas">
        <div class="cu-linked-heading"><strong>Tareas vinculadas</strong><span class="cu-linked-count">0</span></div>
        <p class="cu-linked-empty">Este email todavía no tiene tareas vinculadas.</p>
        <div class="cu-linked-tasks"></div>
      </section>
    </div>
    `;

    const addBtn = bar.querySelector('.cu-add-btn') as HTMLButtonElement | null;
    addBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const currentThreadId = bar.dataset.threadId || null;
        if (!isConfirmedThreadId(currentThreadId)) return;
        openTaskModal(currentThreadId, 'create', messageBodyByBar.get(bar) || messageBody);
    });
    const attachBtn = bar.querySelector('.cu-attach-btn') as HTMLButtonElement | null;
    attachBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        const currentThreadId = bar.dataset.threadId || null;
        if (!isConfirmedThreadId(currentThreadId)) return;
        openTaskModal(currentThreadId, 'attach', messageBodyByBar.get(bar) || messageBody);
    });

    return bar;
}

function reconcileClickUpBar(bar: HTMLElement, threadId: string | null): void {
    const confirmedThreadId = isConfirmedThreadId(threadId) ? threadId : null;
    reconcileThreadBarState(bar, confirmedThreadId);

    reconcileLinkedTasksSection(bar, confirmedThreadId ? toVisibleLinkedTasks(linkedTasks[confirmedThreadId] || []) : []);

    if (confirmedThreadId) verifyThreadTasks(confirmedThreadId, bar);
}

// ============================================================================
// Task Verification
// ============================================================================

async function verifyThreadTasks(threadId: string, barElement: Element): Promise<void> {
    const tasks = linkedTasks[threadId] || [];
    if (tasks.length === 0) return;

    const dueTasks = tasks.filter(task => shouldValidateLink(task));
    if (dueTasks.length === 0) return;

    const taskIdsKey = dueTasks.map(task => task.id).sort().join(',');
    const inFlightKey = `${threadId}:${taskIdsKey}`;
    const existing = validationInFlight.get(inFlightKey);
    if (existing) return existing;

    const validation = runThreadValidation(threadId, barElement, dueTasks).finally(() => {
        validationInFlight.delete(inFlightKey);
    });
    validationInFlight.set(inFlightKey, validation);
    return validation;
}

async function runThreadValidation(threadId: string, barElement: Element, dueTasks: TaskMapping[]): Promise<void> {
    let changed = false;
    const currentTasks = linkedTasks[threadId] || [];
    const updates = new Map<string, TaskMapping>();

    for (const task of dueTasks) {
        try {
            Logger.debug(' Verifying task link');
            const response = await chrome.runtime.sendMessage({
                action: 'validateTaskLink',
                taskId: task.id,
                threadId: threadId
            }) as LinkValidationResult;
            Logger.debug(` Validation response status: ${response?.status || 'unknown'}`);

            if (response?.status) {
                const updated = (response as any).linkRecord || applyValidationToTask(task, response);
                updates.set(task.id, updated);
                changed = changed || updated.linkStatus !== task.linkStatus || updated.lastValidatedAt !== task.lastValidatedAt;
                if (response.status === 'not_found' || response.status === 'unlinked') {
                    Logger.info(` Marked task link inactive: ${response.status}`);
                }
            } else {
                changed = true;
            }
        } catch (e) {
            // Network/message errors are ambiguous; keep current visible state and retry after TTL.
        }
    }

    if (changed) {
        Logger.info(' Updating thread task statuses after validation');
        const nextTasks = currentTasks.map(task => updates.get(task.id) || task);
        linkedTasks[threadId] = nextTasks;
        reconcileLinkedTasksSection(barElement, toVisibleLinkedTasks(nextTasks));
    }
}

// ============================================================================
// Modal Functions
// ============================================================================

function openTaskModal(threadId: string, initialTab: 'create' | 'attach' = 'create', messageBody?: HTMLElement): void {
    const body = messageBody?.isConnected ? messageBody : GmailAdapter.getEmailBodyElement();
    const messageContainer = body ? GmailAdapter.getMessageContainer(body) : null;
    const attachments = GmailAdapter.getAttachmentUrls(messageContainer)
        .filter(attachment => isAllowedGmailImageMimeType(attachment.mimeType)
            && isAllowedGmailAttachmentUrl(attachment.url)
            && sanitizeGmailAttachmentFilename(attachment.filename));
    const emailData: EmailData = {
        threadId: threadId,
        subject: getEmailSubject(),
        from: getSenderEmail(messageContainer),
        html: getEmailBody(body),
        htmlSanitized: true,
        attachments,
    };

    if (typeof TaskModal !== 'undefined') {
        const modal = new TaskModal();
        void modal.show(emailData, initialTab);
    } else {
        Logger.error('TASK_MODAL_NOT_FOUND');
        showNotification('No se pudo abrir el formulario de tarea', 'error');
    }
}

// ============================================================================
// UI Functions
// ============================================================================

function updateLinkedTasksDisplay(threadId: string, task: TaskMapping): void {
    const bar = document.querySelector(`.cu-email-bar[data-thread-id="${threadId}"]`);
    if (!bar) return;

    if (!isConfirmedThreadId(threadId)) return;
    if (!linkedTasks[threadId]) linkedTasks[threadId] = [];
    const nextTask: TaskMapping = {
        id: task.id,
        name: task.name,
        url: task.url,
        linkStatus: task.linkStatus || 'unverified',
        linkSource: task.linkSource || 'unknown',
        customFieldId: task.customFieldId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        failureCount: 0,
    };
    const existingIndex = linkedTasks[threadId].findIndex(candidate => candidate.id === task.id);
    if (existingIndex >= 0) linkedTasks[threadId][existingIndex] = nextTask;
    else linkedTasks[threadId].push(nextTask);
    reconcileLinkedTasksSection(bar, toVisibleLinkedTasks(linkedTasks[threadId]));
}

function reconcileLinkedTasksSection(barElement: Element, tasks: TaskMapping[]): void {
    const container = barElement.querySelector('.cu-linked-tasks');
    if (container) reconcileLinkedTaskAnchors(container, tasks);
    const count = barElement.querySelector('.cu-linked-count');
    if (count) count.textContent = String(tasks.length);
    const empty = barElement.querySelector<HTMLElement>('.cu-linked-empty');
    if (empty) empty.hidden = tasks.length > 0;
}

function showNotification(message: string, type: 'success' | 'error'): void {
    const existing = document.querySelector('.cu-notification');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = `cu-notification cu-notification-${type}`;
    el.textContent = message;
    document.body.appendChild(el);

    setTimeout(() => el.remove(), 3000);
}

// ============================================================================
// SPA Navigation Handling
// ============================================================================

let lastUrl = '';

window.addEventListener('popstate', () => {
    Logger.info(' Navigation detected (popstate)');
    loadLinkedTasks();
    debouncedScan();
});

window.addEventListener('focus', () => {
    revalidateVisibleBars();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        revalidateVisibleBars();
    }
});

function revalidateVisibleBars(): void {
    document.querySelectorAll('.cu-email-bar').forEach((bar) => {
        const threadId = (bar as HTMLElement).dataset.threadId || '';
        if (isConfirmedThreadId(threadId)) {
            verifyThreadTasks(threadId, bar);
        }
    });
}

setInterval(() => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        Logger.info(' URL changed, reloading tasks...');
        loadLinkedTasks();
        debouncedScan();
    }
}, 1000);

setInterval(() => {
    if (gmailIntegrationEnabled) {
            scanEmails();
            scanInbox();
    }
}, 5000);

// ============================================================================
// Start
// ============================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void initialize());
} else {
    void initialize();
}
