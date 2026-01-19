/**
 * ClickUp Tracker - Content Script for ClickUp.com
 * Auto-starts/stops timer when navigating tasks
 * 
 * Based on reverse engineering of Clickup-Automatic-Time-Tracking extension
 */

// ============================================================================
// Settings
// ============================================================================

interface TrackerSettings {
    autoStartTimer: boolean;
    autoStopTimer: boolean;
}

let settings: TrackerSettings = {
    autoStartTimer: false,
    autoStopTimer: false
};

async function loadSettings(): Promise<TrackerSettings> {
    return new Promise((resolve) => {
        chrome.storage.local.get(['autoStartTimer', 'autoStopTimer'], (data) => {
            settings = {
                autoStartTimer: data.autoStartTimer || false,
                autoStopTimer: data.autoStopTimer || false
            };
            resolve(settings);
        });
    });
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.autoStartTimer) {
            settings.autoStartTimer = changes.autoStartTimer.newValue;
        }
        if (changes.autoStopTimer) {
            settings.autoStopTimer = changes.autoStopTimer.newValue;
        }
        console.log('[ClickUp Tracker] Settings updated:', settings);
    }
});

// ============================================================================
// CSS Selectors for Timer
// ============================================================================

const SELECTORS = {
    // Timer not running (play icon visible)
    TIMER_NOT_RUNNING: '.cu-task-view-task-content__body cu-time-tracker-timer-toggle-v3 cu3-icon.cu-time-tracker-timer-toggle__play-icon',
    // Timer running (stop icon visible)
    TIMER_RUNNING: 'cu3-icon.cu-time-tracker-timer-toggle__stop-icon',
    // Timer container
    TIMER_TOGGLE: 'cu-time-tracker-timer-toggle-v3',
    // Task view body (to confirm we're in a task)
    TASK_VIEW: 'cu-task-view-body',
    // Task ID display
    TASK_ID: '[data-test=task-view-task-label__taskid-button]',
    // Page loader
    LOADER: '.cu-loader-mind'
};

// ============================================================================
// URL Detection
// ============================================================================

type ClickUpUrlType = 'task' | 'inbox' | null;

function getClickupUrlType(url: string): ClickUpUrlType {
    if (!url.includes('https://app.clickup.com/')) return null;

    if (url.includes('inbox')) return 'inbox';
    if (url.includes('/t/')) return 'task';

    return null;
}

// ============================================================================
// DOM Helpers
// ============================================================================

function exists(selector: string): boolean {
    return document.querySelector(selector) !== null;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Click an element using various methods for ClickUp 4.0 compatibility
 */
function clickElement(selector: string): boolean {
    const element = document.querySelector(selector);
    console.log('[ClickUp Tracker] clickElement:', selector, 'found:', !!element);

    if (!element) return false;

    const node = element as HTMLElement;
    const candidates: HTMLElement[] = [];

    // Collect click candidates
    candidates.push(node);

    // Check for timer toggle container
    const toggleContainer = node.closest('.cu-time-tracker-timer-toggle');
    if (toggleContainer) candidates.push(toggleContainer as HTMLElement);

    // Check for v3 toggle component
    const hostEl = node.closest('cu-time-tracker-timer-toggle-v3');
    if (hostEl) {
        candidates.push(hostEl as HTMLElement);
        // Check shadow DOM for ClickUp 4.0
        const shadowRoot = (hostEl as any).shadowRoot;
        if (shadowRoot) {
            const shadowButton = shadowRoot.querySelector('.cu-time-tracker-timer-toggle, button, [role="button"]');
            if (shadowButton) candidates.push(shadowButton);
        }
    }

    // Parent fallback
    if (node.parentElement) candidates.push(node.parentElement);

    // Dedupe candidates
    const uniqueCandidates = [...new Set(candidates)];
    console.log('[ClickUp Tracker] Click candidates:', uniqueCandidates.length);

    // Dispatch click events
    const dispatchClick = (target: HTMLElement) => {
        const init: MouseEventInit = { bubbles: true, cancelable: true, view: window };
        try {
            target.dispatchEvent(new MouseEvent('pointerdown', init));
            target.dispatchEvent(new MouseEvent('mousedown', init));
            target.dispatchEvent(new MouseEvent('pointerup', init));
            target.dispatchEvent(new MouseEvent('mouseup', init));
            target.dispatchEvent(new MouseEvent('click', init));
            if (typeof target.click === 'function') target.click();
        } catch (e) {
            console.log('[ClickUp Tracker] Click dispatch error:', e);
        }
    };

    // Try each candidate
    for (const target of uniqueCandidates) {
        try {
            target.scrollIntoView({ block: 'center', inline: 'center' });
            dispatchClick(target);

            // Check if timer state changed
            const isNowRunning = exists(SELECTORS.TIMER_RUNNING);
            console.log('[ClickUp Tracker] After click, running:', isNowRunning);
            return true;
        } catch (e) {
            console.log('[ClickUp Tracker] Candidate click failed:', e);
        }
    }

    return false;
}

// ============================================================================
// Timer Control
// ============================================================================

function startTimer(): boolean {
    if (exists(SELECTORS.TIMER_NOT_RUNNING)) {
        console.log('[ClickUp Tracker] Starting timer...');
        return clickElement(SELECTORS.TIMER_NOT_RUNNING);
    }
    return false;
}

function stopTimer(): boolean {
    if (exists(SELECTORS.TIMER_RUNNING)) {
        console.log('[ClickUp Tracker] Stopping timer...');
        return clickElement(SELECTORS.TIMER_RUNNING);
    }
    return false;
}

function isTimerRunning(): boolean {
    return exists(SELECTORS.TIMER_RUNNING);
}

// ============================================================================
// Navigation Observer
// ============================================================================

let lastLocation = '';
let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedCheck(): void {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(checkNavigation, 300);
}

async function checkNavigation(): Promise<void> {
    // Skip if disabled or loading
    if (!settings.autoStartTimer && !settings.autoStopTimer) return;
    if (exists(SELECTORS.LOADER)) return;

    const currentUrl = location.href;
    const urlType = getClickupUrlType(currentUrl);
    const previousUrlType = getClickupUrlType(lastLocation);

    console.log('[ClickUp Tracker] Check:', { currentUrl, urlType, previousUrlType, settings });

    // Auto-start logic
    if (settings.autoStartTimer && (urlType === 'task' || urlType === 'inbox')) {
        if (lastLocation !== currentUrl) {
            // Wait for task view to load
            await sleep(500);

            if (!isTimerRunning() && exists(SELECTORS.TIMER_NOT_RUNNING)) {
                console.log('[ClickUp Tracker] Auto-starting timer for:', urlType);
                startTimer();
            }
        }
    }

    // Auto-stop logic
    if (settings.autoStopTimer) {
        // If we navigated away from a task/inbox to somewhere else
        if ((previousUrlType === 'task' || previousUrlType === 'inbox') &&
            urlType !== 'task' && urlType !== 'inbox') {
            if (isTimerRunning()) {
                console.log('[ClickUp Tracker] Auto-stopping timer (left task view)');
                stopTimer();
            }
        }
    }

    lastLocation = currentUrl;
}

// ============================================================================
// Initialization
// ============================================================================

async function initTracker(): Promise<void> {
    console.log('[ClickUp Tracker] Initializing...');

    await loadSettings();
    console.log('[ClickUp Tracker] Settings loaded:', settings);

    // Watch for DOM changes (SPA navigation)
    const observer = new MutationObserver(debouncedCheck);
    observer.observe(document, { childList: true, subtree: true });

    // BUG FIX: Don't set lastLocation before initial check
    // This allows auto-start to work when opening a task directly via URL
    // lastLocation will be set by checkNavigation after it runs

    // Initial check after a delay to let the page load
    setTimeout(() => {
        console.log('[ClickUp Tracker] Running initial check for URL:', location.href);
        checkNavigation();
    }, 1000);

    console.log('[ClickUp Tracker] Initialized and watching');
}

// Start when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTracker);
} else {
    initTracker();
}

// Also listen for history navigation
window.addEventListener('popstate', debouncedCheck);
