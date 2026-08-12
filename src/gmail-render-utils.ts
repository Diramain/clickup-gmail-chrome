import { shouldValidateLink, type EmailTaskMappingV2 } from './link-hardening';

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
