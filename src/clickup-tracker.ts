/**
 * ClickUp Tracker - Content Script for ClickUp.com
 * Legacy ClickUp content script retained as an inert compatibility entrypoint.
 * Timer authority lives in background.ts. A recognized task can drive an
 * automatic transition; non-task tabs preserve the current work session.
 */

let lastReportedLocation = '';

function notifyBackgroundIfLocationChanged(): void {
    if (location.href === lastReportedLocation) return;
    lastReportedLocation = location.href;
    void chrome.runtime.sendMessage({ action: 'focusedClickUpNavigation' }).catch(() => undefined);
}

notifyBackgroundIfLocationChanged();
window.addEventListener('popstate', notifyBackgroundIfLocationChanged);
window.addEventListener('hashchange', notifyBackgroundIfLocationChanged);
setInterval(notifyBackgroundIfLocationChanged, 750);
