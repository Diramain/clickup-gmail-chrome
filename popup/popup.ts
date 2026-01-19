/**
 * ClickUp Gmail Chrome - Popup Script
 * TypeScript version with Tab Modules
 */

// Tab Modules
import { tasksTab } from './tabs/tasks.tab';
import { trackingTab } from './tabs/tracking.tab';
import { configTab } from './tabs/config.tab';

// ============================================================================
// Types
// ============================================================================

interface ExtensionStatus {
    authenticated: boolean;
    configured: boolean;
    user?: {
        user?: ClickUpUser;
    } | ClickUpUser;
}

interface ClickUpUser {
    id?: number;
    username?: string;
    email?: string;
    profilePicture?: string | null;
}

interface ClickUpTeam {
    id: string;
    name: string;
}

interface ClickUpSpace {
    id: string;
    name: string;
}

interface ClickUpList {
    id: string;
    name: string;
}

interface TestResult {
    success: boolean;
    message?: string;
    error?: string;
}

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', init);

// ============================================================================
// Tab Navigation
// ============================================================================

function initTabNavigation(): void {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = (btn as HTMLElement).dataset.tab;
            if (!tabId) return;

            // Update button states
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update tab content
            tabContents.forEach(content => {
                if ((content as HTMLElement).id === `tab-${tabId}`) {
                    content.classList.remove('hidden');
                    content.classList.add('active');
                } else {
                    content.classList.add('hidden');
                    content.classList.remove('active');
                }
            });
        });
    });
}

async function init(): Promise<void> {
    const loading = document.getElementById('loading') as HTMLElement;
    const loginRequired = document.getElementById('login-required') as HTMLElement;
    const loggedIn = document.getElementById('logged-in') as HTMLElement;

    try {
        const status = await sendMessage<ExtensionStatus>({ action: 'getStatus' });

        loading.classList.add('hidden');

        if (status.authenticated) {
            showLoggedIn(status);
        } else {
            showLoginRequired(status.configured);
        }
    } catch (error: any) {
        console.error('Init error:', error);
        loading.innerHTML = `<p style="color: #ff5252;">Error: ${error.message}</p>`;
    }
}

// ============================================================================
// Login Required View
// ============================================================================

function showLoginRequired(configured: boolean): void {
    const loginRequired = document.getElementById('login-required') as HTMLElement;
    const signInBtn = document.getElementById('signIn') as HTMLButtonElement;
    const saveConfigBtn = document.getElementById('saveConfig') as HTMLButtonElement;
    const clientIdInput = document.getElementById('clientId') as HTMLInputElement;
    const clientSecretInput = document.getElementById('clientSecret') as HTMLInputElement;
    const redirectUrlInput = document.getElementById('redirectUrl') as HTMLInputElement;
    const copyUrlBtn = document.getElementById('copyUrl') as HTMLButtonElement;
    const openWindowBtn = document.getElementById('openWindow') as HTMLButtonElement;

    loginRequired.classList.remove('hidden');

    // Show the Redirect URL (Chrome identity API format)
    const redirectUrl = chrome.identity.getRedirectURL();
    redirectUrlInput.value = redirectUrl;

    // Restore previously entered values (auto-save feature)
    chrome.storage.local.get(['draftClientId', 'draftClientSecret'], (data) => {
        if (data.draftClientId) {
            clientIdInput.value = data.draftClientId;
        }
        if (data.draftClientSecret) {
            clientSecretInput.value = data.draftClientSecret;
        }
        if (data.draftClientId && data.draftClientSecret) {
            signInBtn.disabled = false;
        }
    });

    // Auto-save Client ID as user types
    clientIdInput.addEventListener('input', () => {
        chrome.storage.local.set({ draftClientId: clientIdInput.value });
        if (clientIdInput.value && clientSecretInput.value) {
            signInBtn.disabled = false;
        }
    });

    // Auto-save Client Secret as user types
    clientSecretInput.addEventListener('input', () => {
        chrome.storage.local.set({ draftClientSecret: clientSecretInput.value });
        if (clientIdInput.value && clientSecretInput.value) {
            signInBtn.disabled = false;
        }
    });

    // Copy URL to clipboard
    copyUrlBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(redirectUrl);
            copyUrlBtn.textContent = '✅';
            copyUrlBtn.style.background = 'rgba(0, 200, 83, 0.3)';
            setTimeout(() => {
                copyUrlBtn.textContent = '📋';
                copyUrlBtn.style.background = '';
            }, 2000);
        } catch (err) {
            redirectUrlInput.select();
            document.execCommand('copy');
            copyUrlBtn.textContent = '✅';
        }
    });

    // Open in separate window
    openWindowBtn.addEventListener('click', () => {
        chrome.windows.create({
            url: chrome.runtime.getURL('popup/popup.html'),
            type: 'popup',
            width: 400,
            height: 650,
            focused: true
        });
        window.close();
    });

    if (configured) {
        signInBtn.disabled = false;
    }

    // Save config handler
    saveConfigBtn.addEventListener('click', async () => {
        const clientId = clientIdInput.value.trim();
        const clientSecret = clientSecretInput.value.trim();

        if (!clientId || !clientSecret) {
            alert('Please enter both Client ID and Client Secret');
            return;
        }

        await sendMessage({
            action: 'saveOAuthConfig',
            data: { clientId, clientSecret }
        });

        signInBtn.disabled = false;
        saveConfigBtn.textContent = 'Configuration Saved ✓';
        saveConfigBtn.style.background = 'rgba(0, 200, 83, 0.2)';
        saveConfigBtn.style.borderColor = '#00c853';
    });

    // Sign in handler
    signInBtn.addEventListener('click', async () => {
        signInBtn.disabled = true;
        signInBtn.textContent = 'Signing in...';

        try {
            const result = await sendMessage<{ success: boolean; user?: any }>({ action: 'authenticate' });

            if (result.success) {
                loginRequired.classList.add('hidden');
                showLoggedIn({ authenticated: true, configured: true, user: result.user });
            }
        } catch (error: any) {
            signInBtn.disabled = false;
            signInBtn.textContent = 'Sign in with ClickUp';
            alert('Sign in failed: ' + error.message);
        }
    });
}

// ============================================================================
// Logged In View
// ============================================================================

async function showLoggedIn(status: ExtensionStatus): Promise<void> {
    const loggedIn = document.getElementById('logged-in') as HTMLElement;
    const userAvatar = document.getElementById('userAvatar') as HTMLImageElement;
    const userName = document.getElementById('userName') as HTMLElement;
    const userEmail = document.getElementById('userEmail') as HTMLElement;

    loggedIn.classList.remove('hidden');

    // Set user info
    if (status.user) {
        const user = (status.user as any).user || status.user;
        userName.textContent = user.username || 'User';
        userEmail.textContent = user.email || '';
        if (user.profilePicture) {
            userAvatar.src = user.profilePicture;
        } else {
            userAvatar.style.display = 'none';
        }
    }

    // Initialize tab navigation
    initTabNavigation();

    // DBA-H1 & DM-H1: Initialize data management buttons
    initDataManagement();

    // ========== TASKS TAB HANDLERS ==========

    // Task Search
    const taskSearch = document.getElementById('taskSearch') as HTMLInputElement;
    const searchResults = document.getElementById('searchResults') as HTMLElement;
    let searchTimeout: ReturnType<typeof setTimeout>;

    taskSearch?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const query = taskSearch.value.trim();

        if (query.length < 2) {
            searchResults.innerHTML = '';
            return;
        }

        searchResults.innerHTML = '<p class="hint">Searching...</p>';
        searchTimeout = setTimeout(async () => {
            try {
                const result = await sendMessage<{ tasks: any[] }>({
                    action: 'searchTasks',
                    data: { query }
                });

                if (result?.tasks?.length > 0) {
                    searchResults.innerHTML = result.tasks.slice(0, 5).map(task => `
                        <div class="search-result-item" data-url="${task.url}">
                            <span class="task-name">${task.name}</span>
                            <span class="task-id">${task.id}</span>
                        </div>
                    `).join('');

                    searchResults.querySelectorAll('.search-result').forEach(el => {
                        el.addEventListener('click', () => {
                            window.open((el as HTMLElement).dataset.url, '_blank');
                        });
                    });
                } else {
                    searchResults.innerHTML = '<p class="hint">No tasks found</p>';
                }
            } catch (e) {
                searchResults.innerHTML = '<p class="hint">Search error</p>';
            }
        }, 300);
    });

    // Quick Create Button
    const quickCreateBtn = document.getElementById('quickCreateTask');
    const quickCreateForm = document.getElementById('quickCreateForm');
    const cancelQuickCreate = document.getElementById('cancelQuickCreate');

    quickCreateBtn?.addEventListener('click', () => {
        quickCreateForm?.classList.toggle('hidden');
    });

    cancelQuickCreate?.addEventListener('click', () => {
        quickCreateForm?.classList.add('hidden');
    });

    // List Search
    const listSearch = document.getElementById('listSearch') as HTMLInputElement;
    const listSearchResults = document.getElementById('listSearchResults') as HTMLElement;
    let listSearchTimeout: ReturnType<typeof setTimeout>;
    let selectedListId: string | null = null;

    listSearch?.addEventListener('input', () => {
        clearTimeout(listSearchTimeout);
        const query = listSearch.value.trim().toLowerCase();

        if (query.length < 1) {
            listSearchResults.innerHTML = '';
            return;
        }

        listSearchResults.innerHTML = '<p class="hint">Searching...</p>';
        listSearchTimeout = setTimeout(async () => {
            try {
                // Get cached lists from storage
                const storage = await chrome.storage.local.get(['hierarchyCache']);
                const lists = storage.hierarchyCache?.lists || [];

                const filtered = lists.filter((list: any) =>
                    list.name.toLowerCase().includes(query) ||
                    (list.path && list.path.toLowerCase().includes(query))
                ).slice(0, 10);

                if (filtered.length > 0) {
                    listSearchResults.innerHTML = filtered.map((list: any) => `
                        <div class="search-result-item" data-id="${list.id}" data-name="${list.name}">
                            <span class="task-name">${list.name}</span>
                            <span class="task-id" style="font-size: 10px; color: #888;">${list.path || list.spaceName}</span>
                        </div>
                    `).join('');

                    listSearchResults.querySelectorAll('.search-result-item').forEach(el => {
                        el.addEventListener('click', () => {
                            const listEl = el as HTMLElement;
                            selectedListId = listEl.dataset.id!;
                            listSearch.value = listEl.dataset.name!;
                            listSearchResults.innerHTML = '';

                            // Enable create button if name is also present
                            const nameInput = document.getElementById('newTaskName') as HTMLInputElement;
                            const createBtn = document.getElementById('createTask') as HTMLButtonElement;
                            if (nameInput.value.trim()) {
                                createBtn.disabled = false;
                            }
                        });
                    });
                } else {
                    listSearchResults.innerHTML = '<p class="hint">No lists found</p>';
                }
            } catch (e) {
                console.error('List search error:', e);
                listSearchResults.innerHTML = '<p class="hint">Search error</p>';
            }
        }, 300);
    });

    // Auto-refresh search when hierarchy is loaded in background
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.hierarchyCache) {
            console.log('[Popup] Hierarchy updated, refreshing search...');
            // If user has typed something, re-trigger search
            if (listSearch && listSearch.value.trim().length >= 1) {
                listSearch.dispatchEvent(new Event('input'));
            }
        }
    });

    // Create Task Handler
    const createTaskBtn = document.getElementById('createTask') as HTMLButtonElement;
    createTaskBtn?.addEventListener('click', async () => {
        const nameInput = document.getElementById('newTaskName') as HTMLInputElement;
        const descInput = document.getElementById('newTaskDescription') as HTMLTextAreaElement;

        if (!selectedListId) {
            alert('Please select a destination list');
            return;
        }

        createTaskBtn.disabled = true;
        createTaskBtn.textContent = 'Creating...';

        try {
            await sendMessage({
                action: 'createTaskSimple',
                data: {
                    listId: selectedListId,
                    name: nameInput.value,
                    description: descInput.value
                }
            });

            // Success feedback
            createTaskBtn.textContent = '✅ Created!';
            setTimeout(() => {
                quickCreateForm?.classList.add('hidden');
                nameInput.value = '';
                descInput.value = '';
                listSearch.value = '';
                selectedListId = null;
                createTaskBtn.textContent = 'Create Task';
            }, 1000);

        } catch (e: any) {
            alert('Error creating task: ' + e.message);
            createTaskBtn.disabled = false;
            createTaskBtn.textContent = 'Create Task';
        }
    });

    // Enable/disable create button based on input
    const newTaskName = document.getElementById('newTaskName') as HTMLInputElement;
    newTaskName?.addEventListener('input', () => {
        if (newTaskName.value.trim()) {
            createTaskBtn.disabled = false;
        } else {
            createTaskBtn.disabled = true;
        }
    });

    // Full Form Button - open modal (sends message to content script OR opens standalone)
    const openModalBtn = document.getElementById('openTaskModal');
    openModalBtn?.addEventListener('click', async () => {
        // 1. Try to open modal in active Gmail tab
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

            // Function to open standalone modal
            const openStandalone = () => {
                chrome.windows.create({
                    url: 'task-modal.html',
                    type: 'popup',
                    width: 600,
                    height: 700
                });
            };

            if (tabs[0]?.id && tabs[0].url?.includes('mail.google.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'openTaskModal' }, (response) => {
                    if (chrome.runtime.lastError || !response) {
                        console.log('Failed to open in Gmail, opening standalone window');
                        openStandalone();
                    } else {
                        setTimeout(() => window.close(), 100);
                    }
                });
            } else {
                openStandalone();
            }
        } catch (e) {
            console.error('Error opening modal:', e);
            // Fallback
            chrome.windows.create({
                url: 'task-modal.html',
                type: 'popup',
                width: 600,
                height: 700
            });
        }
    });

    // ========== TRACKING TAB HANDLERS ==========

    // Track Task Search
    const trackSearch = document.getElementById('trackTaskSearch') as HTMLInputElement;
    const trackResults = document.getElementById('trackSearchResults') as HTMLElement;
    const startTimerBtn = document.getElementById('startTimerBtn') as HTMLButtonElement;
    let selectedTrackTask: { id: string; name: string } | null = null;
    let trackSearchTimeout: ReturnType<typeof setTimeout>;

    trackSearch?.addEventListener('input', () => {
        clearTimeout(trackSearchTimeout);
        const query = trackSearch.value.trim();

        if (query.length < 2) {
            trackResults.innerHTML = '';
            return;
        }

        trackResults.innerHTML = '<p class="hint">Searching...</p>';
        trackSearchTimeout = setTimeout(async () => {
            try {
                const result = await sendMessage<{ tasks: any[] }>({
                    action: 'searchTasks',
                    data: { query }
                });

                if (result?.tasks?.length > 0) {
                    trackResults.innerHTML = result.tasks.slice(0, 5).map(task => `
                        <div class="search-result-item" data-id="${task.id}" data-name="${task.name}">
                            <span class="task-name">${task.name}</span>
                        </div>
                    `).join('');

                    trackResults.querySelectorAll('.search-result-item').forEach(el => {
                        el.addEventListener('click', () => {
                            const taskEl = el as HTMLElement;
                            selectedTrackTask = {
                                id: taskEl.dataset.id!,
                                name: taskEl.dataset.name!
                            };
                            trackSearch.value = selectedTrackTask.name;
                            trackResults.innerHTML = '';
                            startTimerBtn.disabled = false;
                        });
                    });
                } else {
                    trackResults.innerHTML = '<p class="hint">No tasks found</p>';
                }
            } catch (e) {
                trackResults.innerHTML = '<p class="hint">Search error</p>';
            }
        }, 300);
    });

    // Start Timer Button
    startTimerBtn?.addEventListener('click', async () => {
        if (!selectedTrackTask) return;

        try {
            const teamId = await getTeamId();
            if (!teamId) {
                alert('No workspace selected. Please check Config.');
                return;
            }

            startTimerBtn.disabled = true;
            startTimerBtn.textContent = '⏳ Starting...';

            await sendMessage({
                action: 'startTimer',
                data: {
                    taskId: selectedTrackTask.id,
                    teamId
                }
            });

            startTimerBtn.textContent = '✅ Started!';
            setTimeout(() => {
                startTimerBtn.textContent = '▶️ Start Timer';
                selectedTrackTask = null;
                trackSearch.value = '';
            }, 2000);
        } catch (e) {
            startTimerBtn.textContent = '❌ Error';
            startTimerBtn.disabled = false;
        } finally {
            // Refresh timer display to show running timer
            await loadRunningTimer();
        }
    });

    // Stop Timer Button
    const stopTimerBtn = document.getElementById('stopTimer');
    stopTimerBtn?.addEventListener('click', async () => {
        try {
            const teamId = await getTeamId();
            if (teamId) {
                await sendMessage({ action: 'stopTimer', data: { teamId } });
                await loadRunningTimer();
            }
        } catch (e) {
            console.error('Stop timer error:', e);
        }
    });

    // ========== AUTO-TRACKING TOGGLES ==========
    const autoStartToggle = document.getElementById('autoStartToggle') as HTMLInputElement;
    const autoStopToggle = document.getElementById('autoStopToggle') as HTMLInputElement;

    // Load saved settings
    chrome.storage.local.get(['autoStartTimer', 'autoStopTimer'], (result) => {
        if (autoStartToggle) autoStartToggle.checked = result.autoStartTimer || false;
        if (autoStopToggle) autoStopToggle.checked = result.autoStopTimer || false;
    });

    autoStartToggle?.addEventListener('change', () => {
        chrome.storage.local.set({ autoStartTimer: autoStartToggle.checked });
    });

    autoStopToggle?.addEventListener('change', () => {
        chrome.storage.local.set({ autoStopTimer: autoStopToggle.checked });
    });

    // ========== MANUAL TIME ENTRY ==========
    const manualSearch = document.getElementById('manualTaskSearch') as HTMLInputElement;
    const manualResults = document.getElementById('manualSearchResults') as HTMLElement;
    const durationInput = document.getElementById('durationInput') as HTMLInputElement;
    const addManualTimeBtn = document.getElementById('addManualTime') as HTMLButtonElement;
    let selectedManualTask: { id: string; name: string } | null = null;
    let manualSearchTimeout: ReturnType<typeof setTimeout>;

    manualSearch?.addEventListener('input', () => {
        clearTimeout(manualSearchTimeout);
        const query = manualSearch.value.trim();

        if (query.length < 2) {
            manualResults.innerHTML = '';
            return;
        }

        manualResults.innerHTML = '<p class="hint">Searching...</p>';
        manualSearchTimeout = setTimeout(async () => {
            try {
                const result = await sendMessage<{ tasks: any[] }>({
                    action: 'searchTasks',
                    data: { query }
                });

                if (result?.tasks?.length > 0) {
                    manualResults.innerHTML = result.tasks.slice(0, 5).map(task => `
                        <div class="search-result-item" data-id="${task.id}" data-name="${task.name}">
                            <span class="task-name">${task.name}</span>
                        </div>
                    `).join('');

                    manualResults.querySelectorAll('.search-result-item').forEach(el => {
                        el.addEventListener('click', () => {
                            const taskEl = el as HTMLElement;
                            selectedManualTask = {
                                id: taskEl.dataset.id!,
                                name: taskEl.dataset.name!
                            };
                            manualSearch.value = selectedManualTask.name;
                            manualResults.innerHTML = '';
                            checkManualEntryEnabled();
                        });
                    });
                } else {
                    manualResults.innerHTML = '<p class="hint">No tasks found</p>';
                }
            } catch (e) {
                manualResults.innerHTML = '<p class="hint">Search error</p>';
            }
        }, 300);
    });

    durationInput?.addEventListener('input', () => checkManualEntryEnabled());

    function checkManualEntryEnabled() {
        if (addManualTimeBtn) {
            addManualTimeBtn.disabled = !(selectedManualTask && durationInput?.value.trim());
        }
    }

    addManualTimeBtn?.addEventListener('click', async () => {
        if (!selectedManualTask || !durationInput?.value.trim()) return;

        const duration = parseDuration(durationInput.value);
        if (duration <= 0) {
            alert('Invalid duration format. Use: 1h, 30m, 1h30m, or 1:30');
            return;
        }

        try {
            const teamId = await getTeamId();
            if (!teamId) throw new Error('No team ID');

            addManualTimeBtn.disabled = true;
            addManualTimeBtn.textContent = '⏳ Adding...';

            await sendMessage({
                action: 'addTimeEntry',
                data: {
                    taskId: selectedManualTask.id,
                    duration,
                    teamId
                }
            });

            addManualTimeBtn.textContent = '✅ Added!';
            setTimeout(() => {
                addManualTimeBtn.textContent = 'Add Time Entry';
                selectedManualTask = null;
                manualSearch.value = '';
                durationInput.value = '';
                loadTimeHistory();
            }, 2000);
        } catch (e) {
            addManualTimeBtn.textContent = '❌ Error';
            addManualTimeBtn.disabled = false;
        }
    });


    // ========== RECENT ENTRIES ==========
    async function loadTimeHistory() {
        const container = document.getElementById('timeHistory');
        if (!container) return;

        try {
            const teamId = await getTeamId();

            if (!teamId) {
                const storage = await chrome.storage.local.get(null); // Get everything for debug
                console.warn('[Popup] No teamId found. Full storage:', storage);
                // Force JSON stringify for user copy-paste
                const storageStr = JSON.stringify(storage, null, 2);
                container.innerHTML = `<p class="hint">Select a workspace in Config first.<br><small style="opacity:0.7">Debug: ${storageStr.slice(0, 100)}...</small></p>`;
                console.log('[Popup] FULL STORAGE JSON:', storageStr);
                return;
            }

            // BUG FIX: Request entries from last 7 days to get fresh data
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const result = await sendMessage<any[]>({
                action: 'getTimeEntries',
                data: { teamId, start_date: sevenDaysAgo }
            });

            if (result?.length > 0) {
                container.innerHTML = result.slice(0, 10).map(entry => `
                    <div class="time-entry-item">
                        <span class="entry-task">${entry.task?.name || 'Unknown Task'}</span>
                        <span class="entry-duration">${formatDuration(entry.duration)}</span>
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p class="hint">No recent entries</p>';
            }
        } catch (e) {
            console.error('[Popup] Error loading history:', e);
            container.innerHTML = '<p class="hint">Could not load entries</p>';
        }
    }

    function parseDuration(input: string): number {
        const trimmed = input.trim().toLowerCase();
        let totalMs = 0;

        const hourMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*h/);
        const minMatch = trimmed.match(/(\d+)\s*m/);
        const colonMatch = trimmed.match(/^(\d+):(\d+)$/);

        if (colonMatch) {
            totalMs = (parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2])) * 60 * 1000;
        } else {
            if (hourMatch) totalMs += parseFloat(hourMatch[1]) * 60 * 60 * 1000;
            if (minMatch) totalMs += parseInt(minMatch[1]) * 60 * 1000;
        }

        return totalMs;
    }

    function formatDuration(ms: number): string {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    // Load time history on init - MOVED below loadTeams()
    // loadTimeHistory();

    // ========== LOAD RUNNING TIMER ==========
    async function loadRunningTimer() {
        console.log('[Timer] loadRunningTimer called at', new Date().toISOString());
        // console.trace('[Timer] Caller Trace');

        const runningTimerEl = document.getElementById('runningTimer');
        const noTimerEl = document.getElementById('noTimer');
        const timerTaskName = document.getElementById('timerTaskName');
        const timerDisplay = document.getElementById('timerDisplay');

        console.log('[Timer] Checking elements...', { runningTimerEl: !!runningTimerEl, noTimerEl: !!noTimerEl });

        if (!runningTimerEl || !noTimerEl) return;

        try {
            const teamId = await getTeamId();

            if (!teamId) {
                console.log('[Timer] No teamId available (loadRunningTimer)');
                return;
            }

            console.log('[Timer] Fetching running timer for team:', teamId);

            // API returns TimeEntry or null directly
            const timer = await sendMessage<any>({
                action: 'getRunningTimer',
                data: { teamId }
            });

            console.log('[Timer] API result:', JSON.stringify(timer));

            // Check for timer with start timestamp (could be 'start' or 'at' field)
            const startTime = timer?.start || timer?.at;
            if (timer && startTime) {
                noTimerEl.classList.add('hidden');
                runningTimerEl.classList.remove('hidden');

                if (timerTaskName) {
                    timerTaskName.textContent = timer.task?.name || 'Running...';
                }

                // Start updating display - startTime is a timestamp string
                updateTimerDisplay(parseInt(startTime));
            } else {
                runningTimerEl.classList.add('hidden');
                noTimerEl.classList.remove('hidden');
            }
        } catch (e) {
            console.error('[Timer] Error loading running timer:', e);
        }
    }

    let timerInterval: ReturnType<typeof setInterval>;
    function updateTimerDisplay(startTime: number) {
        const timerDisplay = document.getElementById('timerDisplay');
        if (!timerDisplay) return;

        if (timerInterval) clearInterval(timerInterval);

        const update = () => {
            const elapsed = Date.now() - startTime;
            const hours = Math.floor(elapsed / (1000 * 60 * 60));
            const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);

            timerDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        update();
        timerInterval = setInterval(update, 1000);
    }

    // Load teams FIRST to ensure teamId is available
    console.log('[Popup] Calling loadTeams... at', new Date().toISOString());
    await loadTeams();
    console.log('[Popup] loadTeams finished at', new Date().toISOString());

    // THEN load timer and history
    loadRunningTimer();
    loadTimeHistory();

    // Load cache status (last sync time)
    await loadCacheStatus();

    // Custom Field Config
    const customFieldNameInput = document.getElementById('customFieldName') as HTMLInputElement;
    const saveCustomFieldBtn = document.getElementById('saveCustomFieldConfig') as HTMLButtonElement;
    const customFieldToggle = document.getElementById('useCustomFieldToggle') as HTMLInputElement;

    // Load saved settings
    chrome.storage.local.get(['threadIdField', 'useCustomFieldForThreadId'], (data) => {
        // 1. Load Field Name
        if (data.threadIdField) {
            customFieldNameInput.value = data.threadIdField;
        } else {
            customFieldNameInput.value = 'Gmail Thread ID';
        }

        // 2. Load Toggle State (Default: true)
        const useField = data.useCustomFieldForThreadId !== false; // Default true if undefined
        customFieldToggle.checked = useField;

        // Update UI State
        customFieldNameInput.disabled = !useField;
        saveCustomFieldBtn.disabled = !useField;
    });

    // Toggle Handler
    customFieldToggle.addEventListener('change', () => {
        const isChecked = customFieldToggle.checked;
        chrome.storage.local.set({ useCustomFieldForThreadId: isChecked }, () => {
            // Show saved confirmation
            const toggleLabel = customFieldToggle.closest('.toggle-row')?.querySelector('.toggle-label');
            if (toggleLabel) {
                const originalText = toggleLabel.textContent || '';
                toggleLabel.innerHTML = `${originalText} <span style="color: #00c853; font-weight: bold;">✓ Saved</span>`;
                setTimeout(() => {
                    toggleLabel.textContent = originalText;
                }, 2000);
            }
        });

        // Update UI State
        customFieldNameInput.disabled = !isChecked;
        saveCustomFieldBtn.disabled = !isChecked;
    });

    saveCustomFieldBtn.addEventListener('click', () => {
        const name = customFieldNameInput.value.trim();
        if (name) {
            chrome.storage.local.set({ threadIdField: name }, () => {
                saveCustomFieldBtn.textContent = 'Saved ✓';
                setTimeout(() => {
                    saveCustomFieldBtn.textContent = 'Save Field Name';
                }, 2000);
            });
        }
    });

    // Sign out handler
    document.getElementById('signOut')!.addEventListener('click', async () => {
        await sendMessage({ action: 'logout' });
        location.reload();
    });

    // Token refresh test handler
    document.getElementById('testTokenRefresh')!.addEventListener('click', async () => {
        const btn = document.getElementById('testTokenRefresh') as HTMLButtonElement;
        const result = document.getElementById('testResult') as HTMLElement;

        btn.disabled = true;
        btn.textContent = '⏳ Testing...';
        result.textContent = 'Corrupting token and testing refresh...';
        result.style.color = '#666';

        try {
            const testResult = await sendMessage<TestResult>({ action: 'testTokenRefresh' });

            if (testResult.success) {
                result.textContent = '✅ ' + testResult.message;
                result.style.color = '#00c853';
            } else {
                result.textContent = '❌ ' + (testResult.error || 'Test failed');
                result.style.color = '#ff5252';
            }
        } catch (error: any) {
            result.textContent = '❌ Error: ' + error.message;
            result.style.color = '#ff5252';
        }

        btn.disabled = false;
        btn.textContent = '🧪 Test Token Refresh';
    });

    // Sync Lists button handler
    document.getElementById('syncLists')?.addEventListener('click', async () => {
        const btn = document.getElementById('syncLists') as HTMLButtonElement;
        const status = document.getElementById('syncStatus') as HTMLElement;
        const btnText = btn.querySelector('.btn-text') as HTMLElement;
        const spinner = btn.querySelector('.spinner') as HTMLElement;

        btn.disabled = true;
        btnText.textContent = 'Syncing...';
        spinner?.classList.remove('hidden');
        status.textContent = 'Loading all spaces and lists...';
        status.style.color = '#666';

        try {
            const startTime = Date.now();
            const result = await sendMessage<{ success: boolean; listCount: number }>({
                action: 'preloadFullHierarchy'
            });
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            if (result.success) {
                status.textContent = `✅ Synced ${result.listCount} lists in ${elapsed}s`;
                status.style.color = '#00c853';
            } else {
                status.textContent = '❌ Sync failed';
                status.style.color = '#ff5252';
            }
        } catch (error: any) {
            status.textContent = '❌ Error: ' + error.message;
            status.style.color = '#ff5252';
        }

        btn.disabled = false;
        btnText.textContent = '🔄 Sync Lists';
        spinner?.classList.add('hidden');
    });

    // Load email tasks sync status
    await loadEmailTasksSyncStatus();

    // Sync Email Tasks button handler
    document.getElementById('syncEmailTasks')?.addEventListener('click', async () => {
        const btn = document.getElementById('syncEmailTasks') as HTMLButtonElement;
        const status = document.getElementById('emailSyncStatus') as HTMLElement;
        const daysSelect = document.getElementById('emailSyncDays') as HTMLSelectElement;
        const btnText = btn.querySelector('.btn-text') as HTMLElement;
        const spinner = btn.querySelector('.spinner') as HTMLElement;

        const days = parseInt(daysSelect.value);

        btn.disabled = true;
        btnText.textContent = 'Syncing...';
        spinner?.classList.remove('hidden');
        status.textContent = `Scanning tasks from last ${days} days...`;
        status.style.color = '#666';

        try {
            const startTime = Date.now();
            const result = await sendMessage<{ success: boolean; foundCount: number }>({
                action: 'syncEmailTasks',
                data: { days }
            });
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            if (result.success) {
                status.textContent = `✅ Found ${result.foundCount} linked tasks in ${elapsed}s`;
                status.style.color = '#00c853';
            } else {
                status.textContent = '❌ Sync failed';
                status.style.color = '#ff5252';
            }
        } catch (error: any) {
            status.textContent = '❌ Error: ' + error.message;
            status.style.color = '#ff5252';
        }

        btn.disabled = false;
        btnText.textContent = '🔄 Sync';
        spinner?.classList.add('hidden');
    });
}


// ============================================================================
// Team Loading
// ============================================================================

async function loadTeams(): Promise<void> {
    const teamSelect = document.getElementById('teamSelect') as HTMLSelectElement;

    try {
        console.log('[Popup] Loading teams...');
        const teams = await sendMessage<{ teams: ClickUpTeam[] }>({ action: 'getTeams' });
        console.log('[Popup] Teams loaded:', teams);

        // Cache teams to storage to ensure getTeamId can find them later
        if (teams && teams.teams && teams.teams.length > 0) {
            await chrome.storage.local.set({ cachedTeams: teams });
        }

        if (!teams || !teams.teams || teams.teams.length === 0) {
            console.error('[Popup] No teams found');
            teamSelect.innerHTML = '<option value="">No workspaces found</option>';
            return;
        }

        teams.teams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            teamSelect.appendChild(option);
        });

        // Preferred Workspace Handling
        const { teamId: savedTeamId } = await sendMessage<{ teamId: string }>({ action: 'getPreferredTeam' });

        let initialTeamId = savedTeamId;

        // Auto-select if only one team exists and no preference saved (or preference matches)
        if (teams.teams.length === 1 && !initialTeamId) {
            initialTeamId = teams.teams[0].id;
            console.log('[Popup] Single workspace detected, auto-selecting:', initialTeamId);
            await sendMessage({ action: 'savePreferredTeam', data: { teamId: initialTeamId } });
        }

        if (initialTeamId) {
            teamSelect.value = initialTeamId;
        }

        // Trigger preload if team is selected (from invalid state or fresh load)
        if (teamSelect.value) {
            sendMessage({ action: 'preloadFullHierarchy', data: { teamId: teamSelect.value } }).catch(console.error);
        }

        // Listener for changes
        teamSelect.addEventListener('change', async () => {
            const teamId = teamSelect.value;
            if (!teamId) return;

            // Save preference
            await sendMessage({ action: 'savePreferredTeam', data: { teamId } });

            showSavedIndicator(); // Reusing existing indicator logic (assumed global or create it)

            // Trigger Sync
            console.log('[Popup] Workspace changed, preloading hierarchy...');
            sendMessage({ action: 'preloadFullHierarchy', data: { teamId } }).catch(console.error);
        });

    } catch (error) {
        console.error('[Popup] Load teams error:', error);
        teamSelect.innerHTML = '<option value="">Error loading workspaces</option>';
    }
}

async function loadSpaces(teamId: string, selectSpaceId?: string, selectListId?: string): Promise<void> {
    const spaceSelect = document.getElementById('spaceSelect') as HTMLSelectElement;
    const listSelect = document.getElementById('listSelect') as HTMLSelectElement;

    spaceSelect.innerHTML = '<option value="">Loading...</option>';
    spaceSelect.classList.remove('hidden');
    listSelect.classList.add('hidden');

    try {
        const spaces = await sendMessage<{ spaces: ClickUpSpace[] }>({
            action: 'getSpaces',
            data: { teamId }
        });

        spaceSelect.innerHTML = '<option value="">Select Space...</option>';
        spaces.spaces.forEach(space => {
            const option = document.createElement('option');
            option.value = space.id;
            option.textContent = space.name;
            spaceSelect.appendChild(option);
        });

        if (selectSpaceId) {
            spaceSelect.value = selectSpaceId;
            await loadLists(selectSpaceId, selectListId);
        }
    } catch (error) {
        console.error('[Popup] Load spaces error:', error);
        spaceSelect.innerHTML = '<option value="">Error loading spaces</option>';
    }
}

async function loadLists(spaceId: string, selectListId?: string): Promise<void> {
    const listSelect = document.getElementById('listSelect') as HTMLSelectElement;

    listSelect.innerHTML = '<option value="">Loading...</option>';
    listSelect.classList.remove('hidden');

    try {
        const lists = await sendMessage<{ lists: ClickUpList[] }>({
            action: 'getLists',
            data: { spaceId }
        });

        listSelect.innerHTML = '<option value="">Select List...</option>';
        lists.lists.forEach(list => {
            const option = document.createElement('option');
            option.value = list.id;
            option.textContent = list.name;
            listSelect.appendChild(option);
        });

        if (selectListId) {
            listSelect.value = selectListId;
            listSelect.style.borderColor = '#00c853';
        }
    } catch (error) {
        console.error('[Popup] Load lists error:', error);
        listSelect.innerHTML = '<option value="">Error loading lists</option>';
    }
}

function showSavedIndicator(): void {
    const indicator = document.createElement('div');
    indicator.className = 'saved-indicator';
    indicator.textContent = '✓ Saved';
    indicator.style.cssText = 'color:#00c853;font-size:12px;margin-top:5px;text-align:center;font-weight:bold;display:block;';

    const existing = document.querySelector('.saved-indicator');
    if (existing) existing.remove();

    // Append to the active section or card
    const teamSelect = document.getElementById('teamSelect');
    teamSelect?.parentElement?.appendChild(indicator);
    setTimeout(() => indicator.remove(), 3000);
}

// ============================================================================
// Global Helpers
// ============================================================================

async function getTeamId(): Promise<string | null> {
    try {
        // 1. Check Preferred Team in Storage
        const store = await chrome.storage.local.get(['preferredTeamId', 'cachedTeams']);
        if (store.preferredTeamId) return store.preferredTeamId;

        // 2. Fallback to cached teams (single)
        if (store.cachedTeams?.teams?.length > 0) {
            return store.cachedTeams.teams[0].id;
        }

        // 3. Fallback: Check Active DOM Element (if applicable)
        const teamSelect = document.getElementById('teamSelect') as HTMLSelectElement;
        if (teamSelect && teamSelect.value) {
            return teamSelect.value;
        }

        return null;
    } catch (e) {
        console.error('[Popup] Error getting teamId:', e);
        return null;
    }
}


// ============================================================================
// Cache Status
// ============================================================================

async function loadCacheStatus(): Promise<void> {
    const status = document.getElementById('syncStatus') as HTMLElement;

    try {
        const cache = await sendMessage<{ timestamp?: number; lists?: any[] } | null>({
            action: 'getHierarchyCache'
        });

        if (cache && cache.timestamp) {
            const elapsed = Date.now() - cache.timestamp;
            const minutes = Math.floor(elapsed / 60000);
            const hours = Math.floor(minutes / 60);

            let timeAgo = '';
            if (hours > 24) {
                const days = Math.floor(hours / 24);
                timeAgo = `${days} day${days > 1 ? 's' : ''} ago`;
            } else if (hours > 0) {
                timeAgo = `${hours} hour${hours > 1 ? 's' : ''} ago`;
            } else if (minutes > 0) {
                timeAgo = `${minutes} min${minutes > 1 ? 's' : ''} ago`;
            } else {
                timeAgo = 'just now';
            }

            const listCount = cache.lists?.length || 0;
            status.textContent = `✅ ${listCount} lists synced ${timeAgo}`;
            status.style.color = '#00c853';
        } else {
            status.textContent = '⚠️ Not synced yet - click to sync';
            status.style.color = '#ff9800';
        }
    } catch (e) {
        status.textContent = 'Pre-load lists for faster task creation';
    }
}

async function loadEmailTasksSyncStatus(): Promise<void> {
    const status = document.getElementById('emailSyncStatus') as HTMLElement;

    try {
        const syncData = await sendMessage<{ lastSync?: number; foundCount?: number; days?: number } | null>({
            action: 'getEmailTasksSyncStatus'
        });

        if (syncData && syncData.lastSync) {
            const elapsed = Date.now() - syncData.lastSync;
            const minutes = Math.floor(elapsed / 60000);
            const hours = Math.floor(minutes / 60);

            let timeAgo = '';
            if (hours > 24) {
                const days = Math.floor(hours / 24);
                timeAgo = `${days} day${days > 1 ? 's' : ''} ago`;
            } else if (hours > 0) {
                timeAgo = `${hours} hour${hours > 1 ? 's' : ''} ago`;
            } else if (minutes > 0) {
                timeAgo = `${minutes} min${minutes > 1 ? 's' : ''} ago`;
            } else {
                timeAgo = 'just now';
            }

            status.textContent = `✅ ${syncData.foundCount || 0} links found ${timeAgo}`;
            status.style.color = '#00c853';
        } else {
            status.textContent = '⚠️ Not synced - for migrating to new PC';
            status.style.color = '#ff9800';
        }
    } catch (e) {
        status.textContent = 'Sync tasks linked to emails';
    }
}

// ============================================================================
// DBA-H1 & DM-H1: Data Management Functions
// ============================================================================

function initDataManagement(): void {
    const exportBtn = document.getElementById('exportData');
    const clearBtn = document.getElementById('clearData');
    const dataStatus = document.getElementById('dataStatus');

    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            try {
                // Get all stored data
                const data = await chrome.storage.local.get(null);

                // Filter out sensitive data
                const exportData = {
                    emailTaskMappings: data.emailTaskMappings || {},
                    hierarchyCache: data.hierarchyCache || {},
                    preferredTeamId: data.preferredTeamId,
                    exportDate: new Date().toISOString(),
                    version: '1.0'
                };

                // Create download
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `clickup-gmail-backup-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);

                if (dataStatus) {
                    dataStatus.textContent = '✅ Data exported successfully';
                    dataStatus.style.color = '#00c853';
                }
            } catch (e) {
                if (dataStatus) {
                    dataStatus.textContent = '❌ Export failed: ' + (e instanceof Error ? e.message : String(e));
                    dataStatus.style.color = '#ff5252';
                }
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            const confirmed = confirm('⚠️ This will delete all email-task mappings and cached data.\n\nYour OAuth credentials will NOT be deleted.\n\nContinue?');

            if (confirmed) {
                try {
                    // Only remove non-auth data
                    await chrome.storage.local.remove([
                        'emailTaskMappings',
                        'hierarchyCache',
                        'cachedTeams',
                        'cachedUser'
                    ]);

                    if (dataStatus) {
                        dataStatus.textContent = '✅ Data cleared successfully';
                        dataStatus.style.color = '#00c853';
                    }
                } catch (e) {
                    if (dataStatus) {
                        dataStatus.textContent = '❌ Clear failed: ' + (e instanceof Error ? e.message : String(e));
                        dataStatus.style.color = '#ff5252';
                    }
                }
            }
        });
    }
}

// ============================================================================
// Message Helper
// ============================================================================

function sendMessage<T = any>(message: { action: string; data?: any }): Promise<T> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response?.error) {
                reject(new Error(response.error));
            } else {
                resolve(response as T);
            }
        });
    });
}
