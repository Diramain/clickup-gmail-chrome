import { isConfirmedThreadId, shouldValidateLink, type EmailTaskMappingV2 } from './link-hardening';
import { safeClickUpUrl } from './utils/sanitize.utils';

type LinkedTaskView = Pick<EmailTaskMappingV2, 'id' | 'name' | 'url'>;

export function ensureThreadBar(
    container: HTMLElement,
    body: HTMLElement,
    threadId: string | null,
    createBar: (threadId: string | null) => HTMLElement,
    reconcileBar: (bar: HTMLElement, threadId: string | null) => void,
): HTMLElement {
    if (body.parentElement !== container) {
        throw new Error('Email body must be a direct child of mount container');
    }
    const directBars = Array.from(container.children).filter((child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains('cu-email-bar')
    );
    const existingBar = directBars[0] || body.querySelector('.cu-email-bar') as HTMLElement | null;
    if (existingBar) {
        for (const duplicate of directBars.slice(1)) duplicate.remove();
        const nextThreadId = threadId || '';
        if (existingBar.dataset.threadId !== nextThreadId) existingBar.dataset.threadId = nextThreadId;
        reconcileBar(existingBar, threadId);
        return existingBar;
    }
    const bar = createBar(threadId);
    container.insertBefore(bar, body);
    reconcileBar(bar, threadId);
    return bar;
}

export function shouldRunThreadValidation(tasks: EmailTaskMappingV2[], now = Date.now()): boolean {
    return tasks.some(task => shouldValidateLink(task, now));
}

export function reconcileThreadBarState(bar: HTMLElement, threadId: string | null): boolean {
    const confirmed = isConfirmedThreadId(threadId);
    const nextThreadId = confirmed ? threadId : '';
    if (bar.dataset.threadId !== nextThreadId) bar.dataset.threadId = nextThreadId;

    if (confirmed) {
        if (bar.dataset.threadPending !== undefined) delete bar.dataset.threadPending;
    } else if (bar.dataset.threadPending !== 'true') {
        bar.dataset.threadPending = 'true';
    }

    const button = bar.querySelector('.cu-add-btn') as HTMLButtonElement | null;
    const label = bar.querySelector('.cu-add-label') as HTMLElement | null;
    const title = confirmed ? 'Crear tarea de ClickUp desde este email' : 'Esperando datos de Gmail';
    const labelText = confirmed ? 'Agregar a ClickUp' : 'Esperando datos de Gmail…';
    const disabled = !confirmed;

    if (button) {
        if (button.disabled !== disabled) button.disabled = disabled;
        const ariaDisabled = String(disabled);
        if (button.getAttribute('aria-disabled') !== ariaDisabled) button.setAttribute('aria-disabled', ariaDisabled);
        if (button.title !== title) button.title = title;
    }
    if (label && label.textContent !== labelText) label.textContent = labelText;
    return confirmed;
}

export function reconcileLinkedTaskAnchors(container: Element, tasks: LinkedTaskView[]): void {
    const existingById = new Map<string, HTMLAnchorElement>();
    container.querySelectorAll<HTMLAnchorElement>(':scope > .cu-task-link').forEach((link) => {
        const taskId = link.dataset.taskId;
        if (!taskId || existingById.has(taskId)) {
            link.remove();
            return;
        }
        existingById.set(taskId, link);
    });

    const desired: HTMLAnchorElement[] = [];
    for (const task of tasks) {
        const safeUrl = safeClickUpUrl(task.url);
        const signature = JSON.stringify([task.id, task.name, safeUrl]);
        let link = existingById.get(task.id);

        if (!link || link.dataset.renderSignature !== signature) {
            const replacement = createLinkedTaskAnchor(task, safeUrl, signature);
            if (link) link.remove();
            link = replacement;
        }
        desired.push(link);
    }

    const desiredNodes = new Set(desired);
    for (const link of existingById.values()) {
        if (!desiredNodes.has(link)) link.remove();
    }
    desired.forEach((link, index) => {
        const currentAtIndex = container.children.item(index);
        if (currentAtIndex !== link) container.insertBefore(link, currentAtIndex);
    });
    while (container.children.length > desired.length) {
        container.lastElementChild?.remove();
    }
}

function createLinkedTaskAnchor(task: LinkedTaskView, safeUrl: string, signature: string): HTMLAnchorElement {
    const link = document.createElement('a');
    link.href = safeUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'cu-task-link';
    link.dataset.taskId = task.id;
    link.dataset.renderSignature = signature;

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '12');
    icon.setAttribute('height', '12');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', '#7B68EE');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
    icon.appendChild(path);
    link.append(icon, document.createTextNode(` ${task.name}`));
    return link;
}
