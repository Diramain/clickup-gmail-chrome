/**
 * ClickUp Gmail Chrome - Popup Script
 * TypeScript version
 */

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

    // Load teams
    await loadTeams();

    // Load cache status (last sync time)
    await loadCacheStatus();

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
    const spaceSelect = document.getElementById('spaceSelect') as HTMLSelectElement;
    const listSelect = document.getElementById('listSelect') as HTMLSelectElement;

    try {
        console.log('[Popup] Loading teams...');
        const teams = await sendMessage<{ teams: ClickUpTeam[] }>({ action: 'getTeams' });
        console.log('[Popup] Teams loaded:', teams);

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

        // Check for saved default list and restore chain
        const savedConfig = await chrome.storage.local.get(['defaultList', 'defaultListConfig']);
        console.log('[Popup] Saved config:', savedConfig);

        const clearBtn = document.getElementById('clearDefaultList') as HTMLButtonElement;

        if (savedConfig.defaultListConfig) {
            const config = savedConfig.defaultListConfig;
            if (config.teamId) {
                teamSelect.value = config.teamId;
                await loadSpaces(config.teamId, config.spaceId, config.listId);
                clearBtn.classList.remove('hidden');
            }
        }

        // Clear default list handler
        clearBtn.addEventListener('click', async () => {
            await chrome.storage.local.remove(['defaultList', 'defaultListConfig']);
            teamSelect.value = '';
            spaceSelect.classList.add('hidden');
            spaceSelect.innerHTML = '<option value="">Select Space...</option>';
            listSelect.classList.add('hidden');
            listSelect.innerHTML = '<option value="">Select List...</option>';
            clearBtn.classList.add('hidden');
            showClearedIndicator();
        });

        teamSelect.addEventListener('change', async () => {
            const teamId = teamSelect.value;
            if (!teamId) return;
            await loadSpaces(teamId);
        });

        spaceSelect.addEventListener('change', async () => {
            const spaceId = spaceSelect.value;
            if (!spaceId) return;
            await loadLists(spaceId);
        });

        listSelect.addEventListener('change', async () => {
            const listId = listSelect.value;
            const listName = listSelect.options[listSelect.selectedIndex]?.text || '';
            if (!listId) return;

            // Save default list
            await chrome.storage.local.set({
                defaultList: listId,
                defaultListConfig: {
                    teamId: teamSelect.value,
                    spaceId: spaceSelect.value,
                    listId: listId,
                    listName: listName
                }
            });

            await sendMessage({ action: 'setDefaultList', data: { listId } });

            listSelect.style.borderColor = '#00c853';
            showSavedIndicator();
            setTimeout(() => {
                listSelect.style.borderColor = '';
            }, 2000);
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
    indicator.style.cssText = 'color:#00c853;font-size:12px;margin-top:5px;text-align:center;';

    const existing = document.querySelector('.saved-indicator');
    if (existing) existing.remove();

    document.getElementById('listSelect')?.parentElement?.appendChild(indicator);
    setTimeout(() => indicator.remove(), 3000);

    // Show clear button
    document.getElementById('clearDefaultList')?.classList.remove('hidden');
}

function showClearedIndicator(): void {
    const indicator = document.createElement('div');
    indicator.className = 'saved-indicator';
    indicator.textContent = '🗑️ Cleared';
    indicator.style.cssText = 'color:#ff9800;font-size:12px;margin-top:5px;text-align:center;';

    const existing = document.querySelector('.saved-indicator');
    if (existing) existing.remove();

    document.getElementById('teamSelect')?.parentElement?.appendChild(indicator);
    setTimeout(() => indicator.remove(), 3000);
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
