/**
 * Gmail Content Script - Native Implementation
 * Uses GmailAdapter for DOM queries and Logger for output
 * 
 * SECURITY: ISO 27001 compliant - CSP-safe
 */

import type { ILogger } from './logger';
import type { IGmailAdapter } from './gmail-adapter';

// Declare global types for content script context
declare const Logger: ILogger;
declare const GmailAdapter: IGmailAdapter;
declare const TaskModal: new () => {
    show(emailData: EmailData): void;
};

// ============================================================================
// Types
// ============================================================================

interface TaskMapping {
    id: string;
    name: string;
    url: string;
}

interface EmailData {
    threadId: string;
    subject: string;
    from: string;
    html: string;
}

interface ValidationResponse {
    exists: boolean;
    error?: string;
}

interface GmailData {
    thumbnail: null;
    html: string;
    data: {
        email: string;
        id: string;
        subject: string;
        from: string;
        attachments: string[];
        msg: string;
        client: string;
    };
}

interface TaskCreatedEvent extends CustomEvent<{ task: TaskMapping; threadId: string }> { }

// ============================================================================
// State
// ============================================================================

Logger.info('Gmail content script loading...');

const processedMessages = new WeakSet<Element>();
let linkedTasks: Record<string, TaskMapping[]> = {};
let hasValidatedTasks = false;

// Debounce utility
let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedScan(): void {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
        scanEmails();
        scanInbox();
    }, 100);
}

// ============================================================================
// Initialization
// ============================================================================

function initialize(): void {
    Logger.info('Initializing...');
    startObserver();
    loadLinkedTasks();

    window.addEventListener('cu-task-created', ((e: TaskCreatedEvent) => {
        const { task, threadId } = e.detail;
        updateLinkedTasksDisplay(threadId, task);
    }) as EventListener);
}

// ============================================================================
// Task Loading and Validation
// ============================================================================

async function loadLinkedTasks(): Promise<void> {
    try {
        const result = await chrome.storage.local.get('emailTaskMappings');
        const allTasks = (result.emailTaskMappings || {}) as Record<string, TaskMapping[]>;

        const keys = Object.keys(allTasks);
        if (keys.length > 0) {
            Logger.debug('Loaded linked tasks:', keys);
        }

        if (!hasValidatedTasks) {
            hasValidatedTasks = true;
            validateAndCleanTasks(allTasks);
        }

        linkedTasks = allTasks;
        scanInbox();
    } catch (e) {
        linkedTasks = {};
    }
}

async function validateAndCleanTasks(allTasks: Record<string, TaskMapping[]>): Promise<void> {
    Logger.info(' Validating tasks (one-time check)...');
    let hasChanges = false;

    for (const threadId of Object.keys(allTasks)) {
        const tasks = allTasks[threadId];
        if (!Array.isArray(tasks)) continue;

        const validTasks: TaskMapping[] = [];
        for (const task of tasks) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'validateTask',
                    taskId: task.id
                }) as ValidationResponse;

                const errorMsg = (response?.error || '').toLowerCase();
                const isDeleted = errorMsg.includes('not found') || errorMsg.includes('deleted');

                if (response && response.exists && !isDeleted) {
                    validTasks.push(task);
                } else {
                    hasChanges = true;
                    Logger.info(' Removed deleted task:', task.id);
                }
            } catch (e) {
                validTasks.push(task);
            }
        }

        if (validTasks.length !== tasks.length) {
            allTasks[threadId] = validTasks;
        }
    }

    if (hasChanges) {
        await chrome.storage.local.set({ emailTaskMappings: allTasks });
        linkedTasks = allTasks;
        refreshAllBars();
    }
}

function refreshAllBars(): void {
    document.querySelectorAll('.cu-email-bar').forEach((bar) => {
        const threadId = (bar as HTMLElement).dataset.threadId || '';
        const tasks = linkedTasks[threadId] || [];
        const container = bar.querySelector('.cu-linked-tasks');

        if (container) {
            container.innerHTML = tasks.map(t => `
                <a href="${t.url}" target="_blank" class="cu-task-link">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="#7B68EE">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                    ${escapeHtml(t.name)}
                </a>
            `).join('');
        }
    });
}

// ============================================================================
// DOM Observation
// ============================================================================

function startObserver(): void {
    Logger.debug('Starting MutationObserver...');
    const observer = new MutationObserver(() => {
        requestAnimationFrame(debouncedScan);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    scanEmails();
    scanInbox();
}

// ============================================================================
// Email Scanning
// ============================================================================

function scanEmails(): void {
    const emailBodies = GmailAdapter.getAllEmailBodies();
    if (emailBodies.length > 0) {
        Logger.debug(`ScanEmails: found ${emailBodies.length} email bodies`);
    }

    emailBodies.forEach((body) => {
        const messageContainer = body.closest('.gs') || body.closest('.h7') || body.parentElement;
        if (!messageContainer) return;

        const existingBar = messageContainer.querySelector('.cu-email-bar') as HTMLElement | null;

        if (existingBar) {
            const createdAt = parseInt(existingBar.dataset.createdAt || '0');
            const age = Date.now() - createdAt;

            if (age < 30000) return;

            Logger.info(` Refreshing stale bar. Age: ${Math.round(age / 1000)}s`);
            existingBar.remove();
        }

        const threadId = getThreadId();
        Logger.info(' Injecting bar for thread:', threadId);
        injectClickUpBar(messageContainer as HTMLElement, body as HTMLElement, threadId);
    });
}

function scanInbox(): void {
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
                link.href = matchedTasks[0].url;
                link.target = '_blank';
                link.className = 'cu-inbox-task-link';
                link.textContent = '#' + matchedTasks[0].id;
                link.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    window.open(matchedTasks![0].url, '_blank');
                });
                badge.appendChild(link);
            } else {
                const countSpan = document.createElement('span');
                countSpan.className = 'cu-inbox-task-count';
                countSpan.textContent = matchedTasks.length + ' tasks';
                badge.appendChild(countSpan);
            }

            if (subjectSpan?.parentElement) {
                subjectSpan.parentElement.insertBefore(badge, subjectSpan);
                Logger.info(' Added inbox badge for:', legacyThreadId);
            } else if (subjectCell) {
                const firstChild = subjectCell.querySelector('.y6') || subjectCell.firstChild;
                if (firstChild?.parentElement) {
                    firstChild.parentElement.insertBefore(badge, firstChild);
                    Logger.info(' Added inbox badge (fallback) for:', legacyThreadId);
                }
            }
        }
    });
}

// ============================================================================
// Helper Functions
// ============================================================================

function getThreadId(): string {
    const threadId = GmailAdapter.getThreadId();
    Logger.debug('Thread ID:', threadId);
    return threadId;
}

function getEmailSubject(): string {
    return GmailAdapter.getSubject();
}

function getSenderEmail(): string {
    return GmailAdapter.getSenderEmail();
}

function getEmailBody(): string {
    return GmailAdapter.getEmailBodyHtml();
}

// ============================================================================
// ClickUp Bar Injection
// ============================================================================

function injectClickUpBar(container: HTMLElement, body: HTMLElement, threadId: string): void {
    const bar = document.createElement('div');
    bar.className = 'cu-email-bar';
    bar.dataset.threadId = threadId;
    bar.dataset.createdAt = Date.now().toString();

    Logger.debug(` Injecting bar for thread: ${threadId}`, { tasks: linkedTasks[threadId] });

    const existingTasks = linkedTasks[threadId] || [];

    bar.innerHTML = `
    <div class="cu-bar-content">
      <button class="cu-add-btn" title="Create ClickUp task from this email">
        <svg width="16" height="16" viewBox="0 0 180 180" fill="currentColor">
          <path d="M25.4 129.1L49.2 110.9C61.9 127.4 75.3 135 90.3 135C105.1 135 118.2 127.5 130.3 111.1L154.4 128.9C137 152.5 115.3 165 90.3 165C65.3 165 43.4 152.6 25.4 129.1Z"/>
          <polygon points="90.2 49.8 47.8 86.4 28.2 63.6 90.3 10.2 151.8 63.7 132.2 86.3"/>
        </svg>
        Add to ClickUp
      </button>
      <div class="cu-linked-tasks">
        ${getLinkedTasksHtml(existingTasks)}
      </div>
    </div>
    `;

    const addBtn = bar.querySelector('.cu-add-btn');
    addBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        openTaskModal(threadId);
    });

    body.parentElement?.insertBefore(bar, body);
    Logger.info(' Bar injected');

    verifyThreadTasks(threadId, bar);
}

function getLinkedTasksHtml(tasks: TaskMapping[]): string {
    if (!tasks || tasks.length === 0) return '';
    return tasks.map(t => `
        <a href="${t.url}" target="_blank" class="cu-task-link">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#7B68EE">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
          ${escapeHtml(t.name)}
        </a>
    `).join('');
}

// ============================================================================
// Task Verification
// ============================================================================

async function verifyThreadTasks(threadId: string, barElement: Element): Promise<void> {
    const tasks = linkedTasks[threadId] || [];
    if (tasks.length === 0) return;

    let changed = false;
    const validTasks: TaskMapping[] = [];

    for (const task of tasks) {
        try {
            Logger.debug(' Verifying task:', task.id);
            const response = await chrome.runtime.sendMessage({
                action: 'validateTask',
                taskId: task.id
            }) as ValidationResponse;
            Logger.debug(` Validation response for ${task.id}:`, response);

            const errorMsg = (response?.error || '').toLowerCase();
            const isDeleted = errorMsg.includes('not found') || errorMsg.includes('deleted');

            if (response && response.exists && !isDeleted) {
                validTasks.push(task);
            } else {
                Logger.info(' Detected deleted/archived task:', task.id);
                changed = true;
            }
        } catch (e) {
            validTasks.push(task);
        }
    }

    if (changed) {
        Logger.info(' Updating thread tasks after validation');
        linkedTasks[threadId] = validTasks;

        const store = await chrome.storage.local.get('emailTaskMappings');
        const mapping = (store.emailTaskMappings || {}) as Record<string, TaskMapping[]>;
        mapping[threadId] = validTasks;
        await chrome.storage.local.set({ emailTaskMappings: mapping });

        const container = barElement.querySelector('.cu-linked-tasks');
        if (container) {
            container.innerHTML = getLinkedTasksHtml(validTasks);
        }
    }
}

// ============================================================================
// Modal Functions
// ============================================================================

function openTaskModal(threadId: string): void {
    const emailData: EmailData = {
        threadId: threadId,
        subject: getEmailSubject(),
        from: getSenderEmail(),
        html: getEmailBody()
    };

    if (typeof TaskModal !== 'undefined') {
        const modal = new TaskModal();
        modal.show(emailData);
    } else {
        console.error('[ClickUp Task Tracker] TaskModal not found');
        showNotification('Error: Modal not loaded', 'error');
    }
}

function openClickUpOfficial(threadId: string): void {
    const bodyEl = document.querySelector('.a3s.aiL');
    const emailHtml = bodyEl ? bodyEl.innerHTML : '';

    const senderEl = document.querySelector('.gD[email]');
    const senderEmail = senderEl ? senderEl.getAttribute('email') || '' : '';

    const userEmailEl = document.querySelector('[data-inboxsdk-user-email-address]') ||
        document.querySelector('[data-email]');
    const userEmail = userEmailEl ?
        (userEmailEl.getAttribute('data-inboxsdk-user-email-address') ||
            userEmailEl.getAttribute('data-email') || '') : '';

    const subjectEl = document.querySelector('h2[data-thread-perm-id]') ||
        document.querySelector('.hP');
    const subject = subjectEl ? subjectEl.textContent?.trim() || 'Email' : 'Email';

    const msgContainer = document.querySelector('[data-message-id]');
    const legacyMsgEl = document.querySelector('[data-legacy-message-id]');
    let messageId = threadId;
    if (legacyMsgEl) {
        messageId = legacyMsgEl.getAttribute('data-legacy-message-id') || messageId;
    } else if (msgContainer) {
        const rawMsgId = msgContainer.getAttribute('data-message-id');
        messageId = rawMsgId && rawMsgId.includes('-') && legacyMsgEl ?
            (legacyMsgEl as Element).getAttribute('data-legacy-message-id') || '' : rawMsgId || messageId;
    }

    const attachments: string[] = [];
    const attEls = document.querySelectorAll('.ii.gt [download_url], .a3s.aiL [download_url]');
    attEls.forEach(el => {
        const url = el.getAttribute('download_url');
        if (url) attachments.push(url);
    });

    const gmailData: GmailData = {
        thumbnail: null,
        html: emailHtml,
        data: {
            email: userEmail,
            id: threadId,
            subject: subject,
            from: senderEmail,
            attachments: attachments,
            msg: messageId,
            client: 'gmail'
        }
    };

    Logger.info(' Saving Gmail data for ClickUp:', gmailData.data);

    chrome.storage.local.set({
        screenshotTime: Date.now(),
        gmail: JSON.stringify(gmailData),
        url: '/email'
    }).then(() => {
        Logger.info(' Data saved. Opening ClickUp interface...');
        createClickUpIframe();
    }).catch((err: Error) => {
        Logger.error(' Failed to save data:', err);
        showNotification('Error saving email data', 'error');
    });
}

function createClickUpIframe(): void {
    const popup = window.open(
        'https://app.clickup.com/',
        'clickup_create',
        'width=500,height=700,left=200,top=100,scrollbars=yes,resizable=yes'
    );

    if (!popup) {
        showNotification('Popup blocked! Please allow popups for this site.', 'error');
        return;
    }

    Logger.info(' Popup opened - data saved to storage for ClickUp to read');
    showNotification('ClickUp opened in new window. Create your task there!', 'success');
}

// ============================================================================
// UI Functions
// ============================================================================

function updateLinkedTasksDisplay(threadId: string, task: TaskMapping): void {
    const bar = document.querySelector(`.cu-email-bar[data-thread-id="${threadId}"]`);
    if (!bar) return;

    const tasksContainer = bar.querySelector('.cu-linked-tasks');
    const taskLink = document.createElement('a');
    taskLink.href = task.url;
    taskLink.target = '_blank';
    taskLink.className = 'cu-task-link cu-task-new';
    taskLink.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#7B68EE">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>
    ${escapeHtml(task.name)}
    `;
    tasksContainer?.appendChild(taskLink);

    if (!linkedTasks[threadId]) linkedTasks[threadId] = [];
    linkedTasks[threadId].push({ id: task.id, name: task.name, url: task.url });
}

function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

setInterval(() => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        Logger.info(' URL changed, reloading tasks...');
        loadLinkedTasks();
        debouncedScan();
    }
}, 1000);

setInterval(() => {
    scanInbox();
}, 5000);

// ============================================================================
// Start
// ============================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
