/**
 * TaskBridge for ClickUp - Popup Script
 * TypeScript version with Tab Modules
 */

import { escapeHTML, safeAvatarUrl, safeClickUpUrl } from '../src/utils/sanitize.utils';
import { LAST_SAFE_BACKUP_KEY, canClearLocalData, createSafeExportPayload } from '../src/data-management';
import { flattenHierarchySpaces, getTeamHierarchyCache } from '../src/hierarchy-utils';
import { filterDestinationLists } from '../src/destination-config';
import { evaluateOAuthConfigState, resolveInitialOAuthDraft, shouldApplyInitialOAuthDraft, type OAuthConfigState } from '../src/oauth-config-state';
import { isSetupStandalone, openOrFocusSetupWindow, shouldLaunchDurableSetup } from '../src/setup-window';
import { openOrFocusAppTab } from '../src/app-tab';
import { formatSyncProgress, isSyncProgressMessage, type SyncProgressMessage } from '../src/sync-progress';
import { selectAuthorizedTeamId } from '../src/team-selection';
import { isTaskSearchFailure } from '../src/task-search-view';
import { initMeetingLinkSectionFailClosed, type MeetingLinkUiState } from '../src/meeting-link/meeting-link-popup-ui';
import { initGoogleOAuthConnectionPreview } from '../src/google/google-oauth-popup-ui';
import { normalizePersonalToken, type ClickUpAuthMethod } from '../src/clickup-auth';
import { triggerUserDownload } from '../src/user-download';
import {
    getTimeEntryDurationMs,
    getTimeEntryTaskUrl,
    isCurrentTimeEntry,
    prepareRecentTimeEntries,
    toTimeEntryTimestamp,
} from '../src/time-entry-history';
import type { TimeEntry } from '../src/types/clickup';
import {
    MeetMappingTaskCache,
    normalizeMeetMappingTaskDetail,
    type MeetMappingTaskDetail,
} from '../src/meet/meet-mapping-view';

// ============================================================================
// Types
// ============================================================================

interface ExtensionStatus {
    authenticated: boolean;
    configured: boolean;
    authMethod?: ClickUpAuthMethod;
    requiresReauth?: boolean;
    authUnavailable?: boolean;
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

interface MeetPriorityStatus {
    enabled: boolean;
    status: 'idle' | 'awaiting-task' | 'tracking' | 'paused' | 'ignored';
    conflict?: boolean;
    taskId?: string;
    teamId?: string;
    startedAt?: number;
    joinedAt?: number;
    previousTaskId?: string;
    previousTeamId?: string;
}

interface MeetTaskMappingV1 {
    roomKey: string;
    taskId: string;
    teamId: string;
    createdAt: number;
    lastUsedAt: number;
    enabled: boolean;
}

interface SafeDiagnosticStatus {
    enabled: boolean;
    eventCount: number;
    droppedCount: number;
    maxEvents: number;
}

interface LastTrackedTask {
    id: string;
    name: string;
    teamId: string;
}

function sanitizeLastTrackedTask(value: unknown): LastTrackedTask | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const teamId = typeof candidate.teamId === 'string' ? candidate.teamId.trim() : '';
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !/^[A-Za-z0-9_-]{1,100}$/.test(teamId) || !name || name.length > 500) return null;
    return { id, name, teamId };
}

const IS_FULL_APP_SURFACE = window.location.pathname.endsWith('/app/app.html');
if (IS_FULL_APP_SURFACE) document.body.classList.add('full-app-surface');

function handleSyncProgressMessage(message: unknown, sender: chrome.runtime.MessageSender): void {
    if (sender.id !== chrome.runtime.id || !isSyncProgressMessage(message)) return;

    const text = formatSyncProgress(message);
    console.log(`[Sincronización] ${text}`);

    const statusId = message.scope === 'hierarchy' ? 'syncStatus' : 'emailSyncStatus';
    const status = document.getElementById(statusId);
    if (!status) return;

    status.textContent = text;
    status.style.color = message.phase === 'error'
        ? '#ff5252'
        : message.phase === 'complete'
            ? '#00c853'
            : '#666';

    const progressId = message.scope === 'hierarchy' ? 'hierarchyProgress' : 'emailProgress';
    const logId = message.scope === 'hierarchy' ? 'hierarchySyncLog' : 'emailSyncLog';
    const progress = document.getElementById(progressId) as HTMLProgressElement | null;
    const log = document.getElementById(logId);
    if (progress) progress.value = syncProgressPercent(message);
    if (log) {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const previous = log.textContent === 'Esperando sincronización…' ? '' : `${log.textContent}\n`;
        log.textContent = `${previous}[${timestamp}] ${text}`.split('\n').slice(-40).join('\n');
        log.scrollTop = log.scrollHeight;
    }
}

function syncProgressPercent(message: SyncProgressMessage): number {
    if (message.phase === 'complete') return 100;
    if (message.phase === 'error') return 0;
    if (message.phase === 'starting') return 4;
    if (message.current !== undefined && message.total) {
        return Math.min(96, Math.max(8, Math.round((message.current / message.total) * 92)));
    }
    if (message.phase === 'fetching') return 12;
    return 8;
}

chrome.runtime.onMessage.addListener((message, sender) => {
    handleSyncProgressMessage(message, sender);
});

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

    if (IS_FULL_APP_SURFACE) {
        tabButtons.forEach((button) => button.classList.add('hidden'));
        tabContents.forEach((content) => {
            content.classList.remove('hidden');
            content.classList.add('active');
        });
        return;
    }

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = (btn as HTMLElement).dataset.tab;
            if (!tabId) return;

            // Update button states
            tabButtons.forEach(b => b.classList.remove('active'));
            tabButtons.forEach(b => b.setAttribute('aria-selected', 'false'));
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');

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
    const standaloneSetup = isSetupStandalone() || IS_FULL_APP_SURFACE;

    await chrome.storage.local.remove('draftClientSecret');
    initAppTabLauncher();
    initGoogleOAuthConnectionPreview([
        {
            button: document.getElementById('connectGoogleCalendarSetup') as HTMLButtonElement | null,
            status: document.getElementById('googleOAuthSetupStatus'),
        },
        {
            button: document.getElementById('connectGoogleCalendarConfig') as HTMLButtonElement | null,
            status: document.getElementById('googleOAuthConfigStatus'),
        },
    ]);

    try {
        const status = await sendMessage<ExtensionStatus>({ action: 'getStatus' });
        void initSafeDiagnostics();

        if (shouldLaunchDurableSetup(status, standaloneSetup)) {
            try {
                if (await openOrFocusSetupWindow()) {
                    window.close();
                    return;
                }
            } catch (_error) {
                // Fall through to inline setup if the browser cannot create/focus the durable window.
            }
        }

        loading.classList.add('hidden');

        if (status.authenticated) {
            showLoggedIn(status);
        } else {
            showLoginRequired(
                status.configured,
                standaloneSetup,
                status.requiresReauth === true,
                status.authUnavailable === true,
                status.authMethod,
            );
        }
    } catch (error: any) {
        void initSafeDiagnostics();
        console.error('INIT_ERROR');
        loading.innerHTML = '<p style="color: #ff5252;">No se pudo cargar la extensión</p>';
    }
}


function initAppTabLauncher(): void {
    const button = document.getElementById('openAppTab') as HTMLButtonElement | null;
    if (!button) return;
    button.addEventListener('click', async () => {
        const originalLabel = button.textContent || 'Abrir app';
        button.disabled = true;
        button.textContent = 'Abriendo…';
        try {
            await openOrFocusAppTab();
            window.close();
        } catch {
            button.textContent = 'No se pudo abrir';
            button.disabled = false;
            window.setTimeout(() => {
                button.textContent = originalLabel;
            }, 1_800);
        }
    });
}

async function initSafeDiagnostics(): Promise<void> {
    const container = document.getElementById('safeDiagnostics') as HTMLElement | null;
    const toggle = document.getElementById('diagnosticToggle') as HTMLInputElement | null;
    const exportButton = document.getElementById('exportDiagnostics') as HTMLButtonElement | null;
    const clearButton = document.getElementById('clearDiagnostics') as HTMLButtonElement | null;
    const status = document.getElementById('diagnosticStatus') as HTMLElement | null;
    if (!container || !toggle || !exportButton || !clearButton || !status) return;

    container.classList.remove('hidden');

    const render = (state: SafeDiagnosticStatus, message = ''): void => {
        toggle.checked = state.enabled;
        exportButton.disabled = state.eventCount === 0;
        clearButton.disabled = state.eventCount === 0 && state.droppedCount === 0;
        const dropped = state.droppedCount > 0 ? ` · ${state.droppedCount} descartados por límite` : '';
        status.textContent = message || `${state.enabled ? 'Diagnóstico activo' : 'Diagnóstico desactivado'} · ${state.eventCount}/${state.maxEvents} eventos${dropped}`;
        status.style.color = state.enabled ? '#49CCF9' : '';
    };

    try {
        render(await sendMessage<SafeDiagnosticStatus>({ action: 'getDiagnosticStatus' }));
    } catch {
        toggle.disabled = true;
        exportButton.disabled = true;
        clearButton.disabled = true;
        status.textContent = 'No se pudo consultar el diagnóstico seguro.';
        status.style.color = '#ff5252';
        return;
    }

    toggle.addEventListener('change', async () => {
        const requested = toggle.checked;
        toggle.disabled = true;
        try {
            const state = await sendMessage<SafeDiagnosticStatus>({
                action: 'setDiagnosticEnabled',
                data: { enabled: requested },
            });
            render(state);
        } catch {
            toggle.checked = !requested;
            status.textContent = 'No se pudo cambiar el diagnóstico; el estado anterior se conserva.';
            status.style.color = '#ff5252';
        } finally {
            toggle.disabled = false;
        }
    });

    exportButton.addEventListener('click', async () => {
        exportButton.disabled = true;
        try {
            const payload = await sendMessage<Record<string, unknown>>({ action: 'exportDiagnostics' });
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            triggerUserDownload(
                blob,
                `taskbridge-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
            );
            const state = await sendMessage<SafeDiagnosticStatus>({ action: 'getDiagnosticStatus' });
            render(state, `JSON seguro exportado · ${state.eventCount}/${state.maxEvents} eventos`);
        } catch {
            status.textContent = 'No se pudo exportar el diagnóstico.';
            status.style.color = '#ff5252';
        } finally {
            const state = await sendMessage<SafeDiagnosticStatus>({ action: 'getDiagnosticStatus' }).catch(() => null);
            exportButton.disabled = !state || state.eventCount === 0;
        }
    });

    clearButton.addEventListener('click', async () => {
        clearButton.disabled = true;
        try {
            const state = await sendMessage<SafeDiagnosticStatus>({ action: 'clearDiagnostics' });
            render(state, `${state.enabled ? 'Diagnóstico activo' : 'Diagnóstico desactivado'} · registro borrado`);
        } catch {
            status.textContent = 'No se pudo borrar el diagnóstico.';
            status.style.color = '#ff5252';
            clearButton.disabled = false;
        }
    });

}

// ============================================================================
// Login Required View
// ============================================================================

function showLoginRequired(
    configured: boolean,
    standaloneSetup = isSetupStandalone(),
    requiresReauth = false,
    authUnavailable = false,
    authMethod?: ClickUpAuthMethod,
): void {
    const loginRequired = document.getElementById('login-required') as HTMLElement;
    const personalTokenInput = document.getElementById('personalToken') as HTMLInputElement;
    const connectPersonalTokenBtn = document.getElementById('connectPersonalToken') as HTMLButtonElement;
    const personalTokenStatus = document.getElementById('personalTokenStatus') as HTMLElement;
    const signInBtn = document.getElementById('signIn') as HTMLButtonElement;
    const saveConfigBtn = document.getElementById('saveConfig') as HTMLButtonElement;
    const clientIdInput = document.getElementById('clientId') as HTMLInputElement;
    const clientSecretInput = document.getElementById('clientSecret') as HTMLInputElement;
    const redirectUrlInput = document.getElementById('redirectUrl') as HTMLInputElement;
    const copyUrlBtn = document.getElementById('copyUrl') as HTMLButtonElement;
    const openWindowBtn = document.getElementById('openWindow') as HTMLButtonElement;
    const discardChangesBtn = document.getElementById('discardOAuthChanges') as HTMLButtonElement;
    const configStatus = document.getElementById('oauthConfigStatus') as HTMLElement | null;
    const advancedOAuth = document.querySelector('.auth-advanced-card') as HTMLDetailsElement | null;

    let hasStoredConfig = configured;
    let isDirty = false;

    const currentState = (): OAuthConfigState => evaluateOAuthConfigState({
        hasStoredConfig,
        isDirty,
        clientId: clientIdInput.value,
        clientSecret: clientSecretInput.value,
    });

    const setConfigStatus = (message: string, color = ''): void => {
        if (!configStatus) return;
        configStatus.textContent = message;
        configStatus.style.color = color;
    };

    const setPersonalTokenStatus = (message: string, color = ''): void => {
        personalTokenStatus.textContent = message;
        personalTokenStatus.style.color = color;
    };

    const updatePersonalTokenButton = (): void => {
        connectPersonalTokenBtn.disabled = authUnavailable || normalizePersonalToken(personalTokenInput.value) === null;
    };

    const updateOAuthButtons = (): OAuthConfigState => {
        const state = currentState();
        signInBtn.disabled = authUnavailable || !state.canSignIn;
        saveConfigBtn.disabled = !state.canSave;
        return state;
    };

    const markDirty = (): void => {
        isDirty = true;
        setConfigStatus('Hay cambios OAuth pendientes. Completá ambos campos para guardarlos de forma segura.', '#ff9800');
        updateOAuthButtons();
    };

    const saveCurrentOAuthConfig = async (): Promise<void> => {
        const state = currentState();
        if (!state.canSave) {
            throw new Error('OAUTH_CONFIG_INCOMPLETE');
        }

        const originalSaveLabel = saveConfigBtn.textContent || 'Guardar configuración';
        saveConfigBtn.disabled = true;
        saveConfigBtn.textContent = 'Guardando…';

        try {
            const result = await sendMessage<{ success?: boolean }>({
                action: 'saveOAuthConfig',
                data: {
                    clientId: clientIdInput.value.trim(),
                    clientSecret: clientSecretInput.value.trim(),
                }
            });

            if (result?.success !== true) {
                throw new Error('OAUTH_CONFIG_SAVE_FAILED');
            }

            hasStoredConfig = true;
            isDirty = false;
            clientSecretInput.value = '';
            await chrome.storage.local.remove(['draftClientId', 'draftClientSecret']);
            saveConfigBtn.textContent = 'Configuración guardada ✓';
            saveConfigBtn.style.background = 'rgba(0, 200, 83, 0.2)';
            saveConfigBtn.style.borderColor = '#00c853';
            setConfigStatus('Configuración guardada de forma segura. El secreto se borró del campo intencionalmente.', '#00c853');
            updateOAuthButtons();
        } catch (error) {
            saveConfigBtn.textContent = originalSaveLabel;
            setConfigStatus('No se pudo guardar la configuración. Revisá ambos campos e intentá de nuevo.', '#ff5252');
            updateOAuthButtons();
            throw error;
        }
    };

    loginRequired.classList.remove('hidden');
    if (standaloneSetup) {
        openWindowBtn.classList.add('hidden');
    }

    if (configured && requiresReauth) {
        signInBtn.textContent = 'Reconectar con ClickUp';
        setConfigStatus('La sesión de ClickUp dejó de ser válida. Reconectá para reanudar el seguimiento automático.', '#ff9800');
    } else if (authUnavailable) {
        setConfigStatus('No se pudo validar la sesión ahora. No cambies la configuración; reintentá cuando ClickUp esté disponible.', '#ff9800');
    } else if (configured) {
        setConfigStatus('Configuración guardada de forma segura. El secreto se borró del campo intencionalmente.', '#00c853');
    }

    if (authMethod === 'personal-token' && requiresReauth) {
        setPersonalTokenStatus('El token dejó de ser válido. Pegá un token personal nuevo para reconectar.', '#ff9800');
    } else if (authUnavailable) {
        setPersonalTokenStatus('ClickUp no está disponible para validar el token. Reintentá más tarde.', '#ff9800');
    }
    if (advancedOAuth && authMethod === 'oauth' && (configured || requiresReauth)) advancedOAuth.open = true;

    // Show the redirect URL provided by the browser identity API.
    const redirectUrl = chrome.identity.getRedirectURL();
    redirectUrlInput.value = redirectUrl;

    // Restore previously entered values (auto-save feature)
    void chrome.storage.local.get(['draftClientId']).then((draftData) => {
        if (!shouldApplyInitialOAuthDraft({
            isDirty,
            clientId: clientIdInput.value,
            clientSecret: clientSecretInput.value,
        })) {
            isDirty = true;
            updateOAuthButtons();
            return;
        }

        const draftResolution = resolveInitialOAuthDraft({
            hasStoredConfig,
            draftClientId: draftData.draftClientId,
        });

        if (draftResolution.shouldClearDraftClientId) {
            void chrome.storage.local.remove('draftClientId');
        }

        if (draftResolution.clientId) {
            clientIdInput.value = draftResolution.clientId;
        }

        isDirty = draftResolution.isDirty;
        updateOAuthButtons();
    }).catch(() => undefined);

    // Auto-save Client ID as user types
    clientIdInput.addEventListener('input', () => {
        chrome.storage.local.set({ draftClientId: clientIdInput.value });
        markDirty();
    });

    // Auto-save Client Secret as user types
    clientSecretInput.addEventListener('input', async () => {
        try {
            await chrome.storage.local.remove('draftClientSecret');
            markDirty();
        } catch {
            signInBtn.disabled = true;
            saveConfigBtn.disabled = true;
            setConfigStatus('No se pudo borrar el secreto temporal anterior. Recargá la extensión antes de continuar.', '#ff5252');
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
    openWindowBtn.addEventListener('click', async () => {
        openWindowBtn.disabled = true;
        try {
            if (await openOrFocusSetupWindow()) {
                window.close();
                return;
            }
            setConfigStatus('No se pudo abrir la ventana de configuración. Continuá el setup acá.', '#ff9800');
        } catch (_error) {
            setConfigStatus('No se pudo abrir la ventana de configuración. Continuá el setup acá.', '#ff9800');
        } finally {
            openWindowBtn.disabled = false;
        }
    });

    updateOAuthButtons();
    updatePersonalTokenButton();

    personalTokenInput.addEventListener('input', () => {
        setPersonalTokenStatus('');
        updatePersonalTokenButton();
    });

    connectPersonalTokenBtn.addEventListener('click', async () => {
        const token = normalizePersonalToken(personalTokenInput.value);
        if (!token) {
            setPersonalTokenStatus('Pegá un token personal válido que empiece con pk_.', '#ff9800');
            updatePersonalTokenButton();
            return;
        }

        const originalLabel = connectPersonalTokenBtn.textContent || 'Conectar con token personal';
        connectPersonalTokenBtn.disabled = true;
        connectPersonalTokenBtn.textContent = 'Validando…';
        setPersonalTokenStatus('Validando el token con ClickUp…');
        try {
            const result = await sendMessage<{ success: boolean; user?: ClickUpUser; authMethod?: ClickUpAuthMethod }>({
                action: 'authenticatePersonalToken',
                data: { token },
            });
            if (result.success !== true) throw new Error('auth_error');
            personalTokenInput.value = '';
            loginRequired.classList.add('hidden');
            showLoggedIn({
                authenticated: true,
                configured: true,
                authMethod: result.authMethod || 'personal-token',
                user: result.user,
            });
            document.dispatchEvent(new CustomEvent('clickup-auth-changed'));
        } catch (error) {
            personalTokenInput.value = '';
            connectPersonalTokenBtn.textContent = originalLabel;
            setPersonalTokenStatus(
                error instanceof Error && error.message === 'network_error'
                    ? 'No se pudo validar el token porque ClickUp no está disponible. No se guardó ningún cambio.'
                    : 'ClickUp rechazó el token. Generá uno nuevo y volvé a intentarlo.',
                '#ff5252',
            );
            updatePersonalTokenButton();
        }
    });

    discardChangesBtn?.addEventListener('click', async () => {
        clientIdInput.value = '';
        clientSecretInput.value = '';
        isDirty = false;
        await chrome.storage.local.remove(['draftClientId', 'draftClientSecret']);
        setConfigStatus(hasStoredConfig
            ? 'Cambios descartados. Podés usar la configuración guardada.'
            : 'Cambios descartados. Ingresá ambos campos para guardar una configuración nueva.', '#00c853');
        updateOAuthButtons();
    });

    // Save config handler
    saveConfigBtn.addEventListener('click', async () => {
        try {
            await saveCurrentOAuthConfig();
        } catch (error) {
            setConfigStatus('Ingresá el ID de cliente (Client ID) y el Secreto de cliente (Client Secret).', '#ff9800');
        }
    });

    // Sign in handler
    signInBtn.addEventListener('click', async () => {
        const state = currentState();
        if (state.isBlockedByIncompleteChanges) {
            setConfigStatus('Completá ambos campos OAuth o descartá los cambios antes de iniciar sesión.', '#ff9800');
            updateOAuthButtons();
            return;
        }

        const originalSignInLabel = signInBtn.textContent || 'Iniciar sesión con ClickUp';
        signInBtn.disabled = true;
        signInBtn.textContent = 'Iniciando sesión…';

        try {
            if (state.shouldSaveBeforeSignIn) {
                await saveCurrentOAuthConfig();
                signInBtn.disabled = true;
                signInBtn.textContent = 'Iniciando sesión…';
            }

            const result = await sendMessage<{ success: boolean; user?: ClickUpUser; authMethod?: ClickUpAuthMethod }>({ action: 'authenticate' });

            if (result.success) {
                loginRequired.classList.add('hidden');
                showLoggedIn({ authenticated: true, configured: true, authMethod: result.authMethod || 'oauth', user: result.user });
                document.dispatchEvent(new CustomEvent('clickup-auth-changed'));
            } else {
                throw new Error('AUTHENTICATION_FAILED');
            }
        } catch (error: any) {
            signInBtn.textContent = originalSignInLabel;
            updateOAuthButtons();
            setConfigStatus('No se pudo iniciar sesión. Intentá de nuevo.', '#ff5252');
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
    const connectionMethod = document.getElementById('clickUpConnectionMethod');

    loggedIn.classList.remove('hidden');
    if (connectionMethod) {
        connectionMethod.textContent = status.authMethod === 'personal-token'
            ? 'Conectado con token personal cifrado localmente'
            : status.authMethod === 'oauth'
                ? 'Conectado mediante OAuth administrado'
                : 'Conectado con una credencial local existente';
    }

    // Set user info
    if (status.user) {
        const user = (status.user as any).user || status.user;
        userName.textContent = user.username || 'Usuario';
        userEmail.textContent = user.email || '';
        const avatarUrl = safeAvatarUrl(user.profilePicture);
        if (avatarUrl) {
            userAvatar.src = avatarUrl;
        } else {
            userAvatar.style.display = 'none';
        }
    }

    // Initialize tab navigation
    initTabNavigation();

    // DBA-H1 & DM-H1: Initialize data management buttons
    initDataManagement();
    void initMeetingLinkSection();

    let timeTrackingRefreshInFlight: Promise<void> | null = null;
    let recentRunningStart: number | null = null;
    let stopMeetPriorityUi: (() => void) | null = null;
    const lastTrackedStore = await chrome.storage.local.get('lastTrackedTaskV1');
    let lastTrackedTask = sanitizeLastTrackedTask(lastTrackedStore.lastTrackedTaskV1);

    const renderPrimaryTimerControls = (running: boolean): void => {
        const resume = document.getElementById('resumeLastTimer') as HTMLButtonElement | null;
        const stop = document.getElementById('stopTimer') as HTMLButtonElement | null;
        const label = document.getElementById('resumeLastTimerLabel');
        if (resume) resume.disabled = running || !lastTrackedTask;
        if (stop) stop.disabled = !running;
        if (label) label.textContent = lastTrackedTask
            ? `Última tarea: ${lastTrackedTask.name}`
            : 'Todavía no hay una tarea anterior para retomar.';
    };
    renderPrimaryTimerControls(false);

    // ========== TASKS TAB HANDLERS ==========

    // Task Search
    const taskSearch = document.getElementById('taskSearch') as HTMLInputElement;
    const searchResults = document.getElementById('searchResults') as HTMLElement;
    let searchTimeout: ReturnType<typeof setTimeout>;
    let taskSearchSequence = 0;

    const executeTaskSearch = async (query: string): Promise<void> => {
        const sequence = ++taskSearchSequence;
        searchResults.innerHTML = '<p class="hint">Buscando…</p>';
        try {
                let result: { tasks: any[]; hasMore?: boolean; indexedCount?: number } = { tasks: [], hasMore: true, indexedCount: 0 };
                for (let batch = 0; batch < 10; batch += 1) {
                    result = await sendMessage<{ tasks: any[]; hasMore?: boolean; indexedCount?: number }>({
                    action: 'searchTasks',
                    data: { query }
                    });
                    if (sequence !== taskSearchSequence) return;
                    if (isTaskSearchFailure(result)) throw new Error('TASK_SEARCH_FAILED');
                    if (result.tasks.length >= 10 || !result.hasMore) break;
                    searchResults.innerHTML = `<p class="hint">Buscando más coincidencias… ${Number(result.indexedCount) || 0} tareas revisadas.</p>`;
                }

                if (result?.tasks?.length > 0) {
                    searchResults.innerHTML = result.tasks.map(task => `
                        <div class="search-result-item" data-url="${escapeHTML(safeClickUpUrl(task.url || ''))}">
                            <span class="task-name">${escapeHTML(task.name || '')}</span>
                            <span class="task-id">${escapeHTML(task.id || '')}</span>
                        </div>
                    `).join('') + (result.hasMore
                        ? `<button type="button" class="btn task-search-more">Buscar más tareas</button><p class="hint">Índice parcial: ${Number(result.indexedCount) || 0} tareas revisadas.</p>`
                        : result.tasks.length < 10
                            ? `<p class="hint">Se encontraron ${result.tasks.length} coincidencia${result.tasks.length === 1 ? '' : 's'} reales en todo el índice.</p>`
                            : '');

                    searchResults.querySelectorAll('.search-result-item').forEach(el => {
                        el.addEventListener('click', () => {
                            window.open(safeClickUpUrl((el as HTMLElement).dataset.url || ''), '_blank', 'noopener,noreferrer');
                        });
                    });
                    searchResults.querySelector<HTMLButtonElement>('.task-search-more')?.addEventListener('click', () => {
                        void executeTaskSearch(query);
                    });
                } else {
                    searchResults.innerHTML = result.hasMore
                        ? '<p class="hint">Todavía no hay coincidencias en el tramo revisado.</p><button type="button" class="btn task-search-more">Buscar en más tareas</button>'
                        : '<p class="hint">No se encontraron tareas</p>';
                    searchResults.querySelector<HTMLButtonElement>('.task-search-more')?.addEventListener('click', () => {
                        void executeTaskSearch(query);
                    });
                }
            } catch (e) {
                if (sequence !== taskSearchSequence) return;
                searchResults.innerHTML = '<p class="hint">No se pudo buscar</p>';
            }
    };

    taskSearch?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const query = taskSearch.value.trim();
        if (query.length < 2) {
            taskSearchSequence++;
            searchResults.innerHTML = '';
            return;
        }
        searchTimeout = setTimeout(() => { void executeTaskSearch(query); }, 300);
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

        listSearchResults.innerHTML = '<p class="hint">Buscando…</p>';
        listSearchTimeout = setTimeout(async () => {
            try {
                const storage = await chrome.storage.local.get(['hierarchyCache', 'preferredTeamId']);
                const teamId = storage.preferredTeamId || await getTeamId();
                const teamCache = getTeamHierarchyCache(storage.hierarchyCache, teamId);
                const lists = flattenHierarchySpaces(teamCache?.data?.spaces);

                const filtered = filterDestinationLists(lists, query).slice(0, 20);

                if (filtered.length > 0) {
                    listSearchResults.innerHTML = filtered.map((list: any) => `
                        <div class="search-result-item" data-id="${escapeHTML(list.id || '')}" data-name="${escapeHTML(list.name || '')}">
                            <span class="task-name">${escapeHTML(list.name || '')}</span>
                            <span class="task-id" style="font-size: 10px; color: #888;">${escapeHTML(list.path || list.spaceName || '')}</span>
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
                    listSearchResults.innerHTML = '<p class="hint">No se encontraron listas</p>';
                }
            } catch (e) {
                console.error('LIST_SEARCH_ERROR');
                listSearchResults.innerHTML = '<p class="hint">No se pudo buscar</p>';
            }
        }, 300);
    });

    // Auto-refresh search when hierarchy is loaded in background
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.hierarchyCache) {
            console.log('[Popup] HIERARCHY_UPDATED');
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
            createTaskBtn.textContent = 'Seleccioná una lista';
            setTimeout(() => { createTaskBtn.textContent = 'Crear tarea'; }, 1600);
            return;
        }

        createTaskBtn.disabled = true;
        createTaskBtn.textContent = 'Creando…';

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
            createTaskBtn.textContent = '✅ Creada';
            setTimeout(() => {
                quickCreateForm?.classList.add('hidden');
                nameInput.value = '';
                descInput.value = '';
                listSearch.value = '';
                selectedListId = null;
                createTaskBtn.textContent = 'Crear tarea';
            }, 1000);

        } catch (e: any) {
            console.error('QUICK_CREATE_TASK_ERROR');
            createTaskBtn.disabled = false;
            createTaskBtn.textContent = 'No se pudo crear';
            setTimeout(() => { createTaskBtn.textContent = 'Crear tarea'; }, 1800);
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
                    url: chrome.runtime.getURL('task-modal.html'),
                    type: 'popup',
                    width: 600,
                    height: 700
                });
            };

            if (tabs[0]?.id && tabs[0].url?.includes('mail.google.com')) {
                try {
                    const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'openTaskModal' });
                    if (!response) throw new Error('No content-script response');
                    setTimeout(() => window.close(), 100);
                } catch {
                    console.log('OPEN_MODAL_FALLBACK');
                    openStandalone();
                }
            } else {
                openStandalone();
            }
        } catch (e) {
            console.error('OPEN_MODAL_ERROR');
            // Fallback
            chrome.windows.create({
                url: chrome.runtime.getURL('task-modal.html'),
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

        trackResults.innerHTML = '<p class="hint">Buscando…</p>';
        trackSearchTimeout = setTimeout(async () => {
            try {
                const result = await sendMessage<{ tasks: any[] }>({
                    action: 'searchTasks',
                    data: { query }
                });

                if (result?.tasks?.length > 0) {
                    trackResults.innerHTML = result.tasks.slice(0, 5).map(task => `
                        <div class="search-result-item" data-id="${escapeHTML(task.id || '')}" data-name="${escapeHTML(task.name || '')}">
                            <span class="task-name">${escapeHTML(task.name || '')}</span>
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
                    trackResults.innerHTML = '<p class="hint">No se encontraron tareas</p>';
                }
            } catch (e) {
                trackResults.innerHTML = '<p class="hint">No se pudo buscar</p>';
            }
        }, 300);
    });

    // Start Timer Button
    startTimerBtn?.addEventListener('click', async () => {
        if (!selectedTrackTask) return;

        try {
            const teamId = await getTeamId();
            if (!teamId) {
                startTimerBtn.textContent = 'Elegí un espacio en Configuración';
                setTimeout(() => { startTimerBtn.textContent = '▶️ Iniciar temporizador'; }, 1800);
                return;
            }

            startTimerBtn.disabled = true;
            startTimerBtn.textContent = '⏳ Iniciando…';

            await sendMessage({
                action: 'startTimer',
                data: {
                    taskId: selectedTrackTask.id,
                    teamId
                }
            });

            startTimerBtn.textContent = '✅ Iniciado';
            setTimeout(() => {
                startTimerBtn.textContent = '▶️ Iniciar temporizador';
                selectedTrackTask = null;
                trackSearch.value = '';
            }, 2000);
        } catch (e) {
            startTimerBtn.textContent = '❌ Error';
            startTimerBtn.disabled = false;
        } finally {
            // Refresh timer display to show running timer
            await refreshTimeTracking();
        }
    });

    // Stop Timer Button
    const stopTimerBtn = document.getElementById('stopTimer');
    stopTimerBtn?.addEventListener('click', async () => {
        try {
            const teamId = await getTeamId();
            if (teamId) {
                await sendMessage({ action: 'stopTimer', data: { teamId } });
                await refreshTimeTracking();
            }
        } catch (e) {
            console.error('STOP_TIMER_ERROR');
        }
    });

    const resumeLastTimer = document.getElementById('resumeLastTimer') as HTMLButtonElement | null;
    resumeLastTimer?.addEventListener('click', async () => {
        if (!lastTrackedTask) return;
        resumeLastTimer.disabled = true;
        try {
            await sendMessage({ action: 'startTimer', data: { teamId: lastTrackedTask.teamId, taskId: lastTrackedTask.id } });
            await refreshTimeTracking();
        } catch {
            resumeLastTimer.disabled = false;
        }
    });

    // ========== AUTO-TRACKING TOGGLES ==========
    const autoStartToggle = document.getElementById('autoStartToggle') as HTMLInputElement;
    const autoStopToggle = document.getElementById('autoStopToggle') as HTMLInputElement;

    // Load saved settings
    try {
        const autoTracking = await chrome.storage.local.get(['autoStartTimer', 'autoStopTimer']);
        if (autoStartToggle) autoStartToggle.checked = autoTracking.autoStartTimer || false;
        if (autoStopToggle) autoStopToggle.checked = autoTracking.autoStopTimer || false;
    } catch {
        if (autoStartToggle) autoStartToggle.checked = false;
        if (autoStopToggle) autoStopToggle.checked = false;
    }

    autoStartToggle?.addEventListener('change', async () => {
        const requested = autoStartToggle.checked;
        try {
            await chrome.storage.local.set({ autoStartTimer: requested });
        } catch {
            autoStartToggle.checked = !requested;
        }
    });

    autoStopToggle?.addEventListener('change', async () => {
        const requested = autoStopToggle.checked;
        try {
            await chrome.storage.local.set({ autoStopTimer: requested });
        } catch {
            autoStopToggle.checked = !requested;
        }
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

        manualResults.innerHTML = '<p class="hint">Buscando…</p>';
        manualSearchTimeout = setTimeout(async () => {
            try {
                const result = await sendMessage<{ tasks: any[] }>({
                    action: 'searchTasks',
                    data: { query }
                });

                if (result?.tasks?.length > 0) {
                    manualResults.innerHTML = result.tasks.slice(0, 5).map(task => `
                        <div class="search-result-item" data-id="${escapeHTML(task.id || '')}" data-name="${escapeHTML(task.name || '')}">
                            <span class="task-name">${escapeHTML(task.name || '')}</span>
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
                    manualResults.innerHTML = '<p class="hint">No se encontraron tareas</p>';
                }
            } catch (e) {
                manualResults.innerHTML = '<p class="hint">No se pudo buscar</p>';
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
            addManualTimeBtn.textContent = 'Formato inválido';
            setTimeout(() => { addManualTimeBtn.textContent = 'Agregar tiempo'; }, 1800);
            return;
        }

        try {
            const teamId = await getTeamId();
            if (!teamId) throw new Error('NO_TEAM_ID');

            addManualTimeBtn.disabled = true;
            addManualTimeBtn.textContent = '⏳ Agregando…';

            await sendMessage({
                action: 'addTimeEntry',
                data: {
                    taskId: selectedManualTask.id,
                    duration,
                    teamId
                }
            });

            await refreshTimeTracking();

            addManualTimeBtn.textContent = '✅ Agregado';
            setTimeout(() => {
                addManualTimeBtn.textContent = 'Agregar tiempo';
                selectedManualTask = null;
                manualSearch.value = '';
                durationInput.value = '';
            }, 2000);
        } catch (e) {
            addManualTimeBtn.textContent = '❌ Error';
            addManualTimeBtn.disabled = false;
        }
    });


    // ========== RECENT ENTRIES ==========
    async function loadTimeHistory(runningTimer: TimeEntry | null): Promise<void> {
        const container = document.getElementById('timeHistory');
        if (!container) return;

        try {
            const teamId = await getTeamId();

            if (!teamId) {
                console.warn('[Popup] NO_TEAM_ID');
                container.innerHTML = '<p class="hint">Seleccioná primero un espacio de trabajo en Configuración.</p>';
                return;
            }

            const result = await sendMessage<TimeEntry[]>({
                action: 'getTimeEntries',
                data: { teamId }
            });
            const entries = prepareRecentTimeEntries(result || [], runningTimer, 10);
            recentRunningStart = runningTimer ? toTimeEntryTimestamp(runningTimer.start) : null;

            if (entries.length > 0) {
                container.innerHTML = entries.map(entry => {
                    const isRunning = isCurrentTimeEntry(entry, runningTimer);
                    const duration = getTimeEntryDurationMs(entry, runningTimer);
                    const taskUrl = getTimeEntryTaskUrl(entry);
                    const taskName = escapeHTML(entry.task?.name || 'Tarea sin nombre');
                    const taskLabel = taskUrl
                        ? `<a class="entry-task-link" href="${escapeHTML(taskUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir tarea en ClickUp">${taskName}</a>`
                        : taskName;
                    return `
                    <div class="time-entry-item${isRunning ? ' time-entry-running' : ''}">
                        <span class="entry-task">${taskLabel}</span>
                        <span class="entry-state${isRunning ? ' is-running' : ''}">${isRunning ? 'En curso' : 'Finalizada'}</span>
                        <span class="entry-duration"${isRunning ? ' id="recentRunningDuration"' : ''}>${formatDuration(duration)}</span>
                    </div>
                `;
                }).join('');

                container.querySelectorAll<HTMLAnchorElement>('.entry-task-link').forEach(link => {
                    link.addEventListener('click', (event) => {
                        event.preventDefault();
                        window.open(safeClickUpUrl(link.href), '_blank', 'noopener,noreferrer');
                    });
                });
            } else {
                container.innerHTML = '<p class="hint">No hay entradas recientes</p>';
            }
        } catch (e) {
            console.error('[Popup] LOAD_HISTORY_ERROR');
            container.innerHTML = '<p class="hint">No se pudieron cargar las entradas</p>';
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
    function renderDashboardTimer(timer: TimeEntry | null): void {
        const state = document.getElementById('dashboardTimerState');
        const stateText = document.getElementById('dashboardTimerStateText');
        const task = document.getElementById('dashboardTimerTask');
        const value = document.getElementById('dashboardTimerValue') as HTMLTimeElement | null;
        if (!state || !stateText || !task || !value) return;

        if (timer) {
            state.classList.remove('blocked');
            stateText.textContent = 'En curso';
            task.textContent = timer.task?.name || 'Tarea en curso';
            return;
        }

        state.classList.add('blocked');
        stateText.textContent = 'Sin temporizador';
        task.textContent = 'No hay una tarea en curso';
        value.textContent = '00:00:00';
        value.dateTime = 'PT0S';
    }

    async function loadRunningTimer(): Promise<TimeEntry | null> {
        console.log('[Timer] LOAD_RUNNING_TIMER');
        // console.trace('[Timer] Caller Trace');

        const runningTimerEl = document.getElementById('runningTimer');
        const noTimerEl = document.getElementById('noTimer');
        const timerTaskName = document.getElementById('timerTaskName');
        const timerDisplay = document.getElementById('timerDisplay');

        console.log('[Timer] CHECK_ELEMENTS');

        if (!runningTimerEl || !noTimerEl) return null;

        try {
            const teamId = await getTeamId();

            if (!teamId) {
                console.log('[Timer] NO_TEAM_ID');
                renderDashboardTimer(null);
                return null;
            }

            console.log('[Timer] FETCH_RUNNING_TIMER');

            // API returns TimeEntry or null directly
            const timer = await sendMessage<TimeEntry | null>({
                action: 'getRunningTimer',
                data: { teamId }
            });

            console.log('[Timer] API_RESULT_RECEIVED');

            // Check for timer with start timestamp (could be 'start' or 'at' field)
            const startTime = timer?.start || (timer as any)?.at;
            if (timer && startTime) {
                const normalizedTimer = { ...timer, start: startTime } as TimeEntry;
                noTimerEl.classList.add('hidden');
                runningTimerEl.classList.remove('hidden');

                if (timerTaskName) {
                    timerTaskName.textContent = timer.task?.name || 'En curso…';
                }

                const taskId = String(timer.task?.id || '').trim();
                if (taskId && teamId) {
                    lastTrackedTask = { id: taskId, name: timer.task?.name || taskId, teamId };
                    await chrome.storage.local.set({ lastTrackedTaskV1: lastTrackedTask });
                }

                updateTimerDisplay(toTimeEntryTimestamp(startTime));
                renderDashboardTimer(normalizedTimer);
                renderPrimaryTimerControls(true);
                return normalizedTimer;
            } else {
                runningTimerEl.classList.add('hidden');
                noTimerEl.classList.remove('hidden');
                recentRunningStart = null;
                if (timerInterval) clearInterval(timerInterval);
                if (timerDisplay) timerDisplay.textContent = '00:00:00:00';
                renderDashboardTimer(null);
                renderPrimaryTimerControls(false);
                return null;
            }
        } catch (e) {
            console.error('[Timer] LOAD_RUNNING_TIMER_ERROR');
            renderDashboardTimer(null);
            return null;
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
            const centiseconds = Math.floor((elapsed % 1000) / 10);

            timerDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${centiseconds.toString().padStart(2, '0')}`;
            const dashboardTimer = document.getElementById('dashboardTimerValue') as HTMLTimeElement | null;
            if (dashboardTimer) {
                dashboardTimer.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                dashboardTimer.dateTime = `PT${hours}H${minutes}M${seconds}S`;
            }
            const recentDuration = document.getElementById('recentRunningDuration');
            if (recentDuration && recentRunningStart) {
                recentDuration.textContent = formatDuration(Date.now() - recentRunningStart);
            }
        };

        update();
        timerInterval = setInterval(update, 50);
    }

    async function refreshTimeTracking(): Promise<void> {
        if (timeTrackingRefreshInFlight) return timeTrackingRefreshInFlight;

        const refresh = (async () => {
            const runningTimer = await loadRunningTimer();
            await loadTimeHistory(runningTimer);
        })();
        timeTrackingRefreshInFlight = refresh;

        try {
            await refresh;
        } finally {
            if (timeTrackingRefreshInFlight === refresh) timeTrackingRefreshInFlight = null;
        }
    }

    // Load teams FIRST to ensure teamId is available
    console.log('[Popup] LOAD_TEAMS_INIT');
    await loadTeams();
    console.log('[Popup] LOAD_TEAMS_DONE');

    // THEN load timer and history as one coherent snapshot.
    await refreshTimeTracking();
    stopMeetPriorityUi = await initMeetPriority(refreshTimeTracking);

    const timeTrackingPoll = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refreshTimeTracking();
    }, 30_000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void refreshTimeTracking();
    });

    window.addEventListener('pagehide', () => {
        clearInterval(timeTrackingPoll);
        if (timerInterval) clearInterval(timerInterval);
        stopMeetPriorityUi?.();
    }, { once: true });

    // Load cache status (last sync time)
    await loadCacheStatus();

    // Custom Field Config
    const customFieldNameInput = document.getElementById('customFieldName') as HTMLInputElement;
    const saveCustomFieldBtn = document.getElementById('saveCustomFieldConfig') as HTMLButtonElement;
    const customFieldToggle = document.getElementById('useCustomFieldToggle') as HTMLInputElement;

    // Load saved settings
    const customFieldData: Record<string, unknown> = await chrome.storage.local
        .get(['threadIdField', 'useCustomFieldForThreadId'])
        .catch(() => ({}));
    customFieldNameInput.value = typeof customFieldData.threadIdField === 'string'
        ? customFieldData.threadIdField
        : 'Gmail Thread ID';
    const useField = customFieldData.useCustomFieldForThreadId !== false;
    customFieldToggle.checked = useField;
    customFieldNameInput.disabled = !useField;
    saveCustomFieldBtn.disabled = !useField;

    // Toggle Handler
    customFieldToggle.addEventListener('change', async () => {
        const isChecked = customFieldToggle.checked;
        try {
            await chrome.storage.local.set({ useCustomFieldForThreadId: isChecked });
        } catch {
            customFieldToggle.checked = !isChecked;
            return;
        }
        const toggleLabel = customFieldToggle.closest('.toggle-row')?.querySelector('.toggle-label');
        if (toggleLabel) {
            const originalText = toggleLabel.textContent || '';
            toggleLabel.innerHTML = `${originalText} <span style="color: #00c853; font-weight: bold;">✓ Guardado</span>`;
            setTimeout(() => {
                toggleLabel.textContent = originalText;
            }, 2000);
        }

        // Update UI State
        customFieldNameInput.disabled = !isChecked;
        saveCustomFieldBtn.disabled = !isChecked;
    });

    saveCustomFieldBtn.addEventListener('click', async () => {
        const name = customFieldNameInput.value.trim();
        if (name) {
            try {
                await chrome.storage.local.set({ threadIdField: name });
            } catch {
                return;
            }
            saveCustomFieldBtn.textContent = 'Guardado ✓';
            setTimeout(() => {
                saveCustomFieldBtn.textContent = 'Guardar nombre del campo';
            }, 2000);
        }
    });

    // Sign out handler
    document.getElementById('signOut')!.addEventListener('click', async () => {
        await sendMessage({ action: 'logout' });
        location.reload();
    });

    // Sync Lists button handler
    document.getElementById('syncLists')?.addEventListener('click', async () => {
        const btn = document.getElementById('syncLists') as HTMLButtonElement;
        const status = document.getElementById('syncStatus') as HTMLElement;
        const btnText = btn.querySelector('.btn-text') as HTMLElement;
        const spinner = btn.querySelector('.spinner') as HTMLElement;

        btn.disabled = true;
        btnText.textContent = 'Sincronizando…';
        spinner?.classList.remove('hidden');
        status.textContent = 'Cargando espacios y listas…';
        status.style.color = '#666';

        try {
            const startTime = Date.now();
            const result = await sendMessage<{ success: boolean; listCount: number }>({
                action: 'preloadFullHierarchy'
            });
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            if (result.success) {
                status.textContent = `✅ ${result.listCount} listas sincronizadas en ${elapsed}s`;
                status.style.color = '#00c853';
            } else {
                status.textContent = '❌ No se pudo sincronizar';
                status.style.color = '#ff5252';
            }
        } catch (error: any) {
            console.error('SYNC_LISTS_ERROR');
            status.textContent = '❌ No se pudo sincronizar';
            status.style.color = '#ff5252';
        }

        btn.disabled = false;
        btnText.textContent = '🔄 Sincronizar listas';
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
        btnText.textContent = 'Sincronizando…';
        spinner?.classList.remove('hidden');
        status.textContent = `Escaneando tareas de los últimos ${days} días…`;
        status.style.color = '#666';

        try {
            const startTime = Date.now();
            const result = await sendMessage<{ success: boolean; foundCount: number }>({
                action: 'syncEmailTasks',
                data: { days }
            });
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            if (result.success) {
                status.textContent = `✅ ${result.foundCount} tareas vinculadas encontradas en ${elapsed}s`;
                status.style.color = '#00c853';
            } else {
                status.textContent = '❌ No se pudo sincronizar';
                status.style.color = '#ff5252';
            }
        } catch (error: any) {
            console.error('SYNC_EMAIL_TASKS_ERROR');
            status.textContent = '❌ No se pudo sincronizar';
            status.style.color = '#ff5252';
        }

        btn.disabled = false;
        btnText.textContent = '🔄 Sincronizar';
        spinner?.classList.add('hidden');
    });
}


// ============================================================================
// Google Meet Priority
// ============================================================================

async function initMeetPriority(refreshTimeTracking: () => Promise<void>): Promise<() => void> {
    const toggle = document.getElementById('meetPriorityToggle') as HTMLInputElement | null;
    const statusRoot = document.getElementById('meetPriorityStatus');
    const chooser = document.getElementById('meetTaskChooser');
    const searchInput = document.getElementById('meetTaskSearch') as HTMLInputElement | null;
    const searchResults = document.getElementById('meetTaskResults');
    const rememberToggle = document.getElementById('meetRememberToggle') as HTMLInputElement | null;
    const assignButton = document.getElementById('assignMeetTask') as HTMLButtonElement | null;
    const actions = document.getElementById('meetActions');
    const previousButton = document.getElementById('usePreviousMeetTask') as HTMLButtonElement | null;
    const changeButton = document.getElementById('changeMeetTask') as HTMLButtonElement | null;
    const resumeButton = document.getElementById('resumeMeetSession') as HTMLButtonElement | null;
    const ignoreButton = document.getElementById('ignoreMeetSession') as HTMLButtonElement | null;
    const endButton = document.getElementById('endMeetSession') as HTMLButtonElement | null;
    const mappingsDetails = document.getElementById('meetMappingsDetails');
    const mappingsList = document.getElementById('meetMappingsList');

    if (!toggle || !statusRoot || !chooser || !searchInput || !searchResults || !rememberToggle
        || !assignButton || !actions || !previousButton || !changeButton || !resumeButton
        || !ignoreButton || !endButton || !mappingsDetails || !mappingsList) {
        return () => undefined;
    }

    let selectedTask: { id: string; name: string } | null = null;
    let currentStatus: MeetPriorityStatus = { enabled: false, status: 'idle' };
    let searchRevision = 0;
    let searchTimeout: ReturnType<typeof setTimeout> | null = null;
    let changingTask = false;
    const taskDetails = new MeetMappingTaskCache();

    const setVisible = (element: Element, visible: boolean): void => {
        element.classList.toggle('hidden', !visible);
    };

    const setStatusCopy = (title: string, detail: string): void => {
        statusRoot.replaceChildren();
        const heading = document.createElement('strong');
        heading.textContent = title;
        const description = document.createElement('p');
        description.textContent = detail;
        statusRoot.append(heading, description);
    };

    const taskLabel = (taskId: string | undefined): string => {
        if (!taskId) return 'tarea no disponible';
        return taskDetails.get(taskId)?.name || `tarea ${taskId}`;
    };

    const resolveTaskDetail = async (taskId: string): Promise<MeetMappingTaskDetail> => {
        const cached = taskDetails.get(taskId);
        if (cached) return cached;
        let detail = normalizeMeetMappingTaskDetail(null, taskId);
        try {
            const task = await sendMessage<unknown>({
                action: 'getTaskById',
                data: { taskId },
            });
            detail = normalizeMeetMappingTaskDetail(task, taskId);
        } catch {
            // A bounded negative cache keeps the ID usable without retrying on every render.
        }
        taskDetails.set(detail);
        return detail;
    };

    const renderMappings = async (): Promise<void> => {
        const result = await sendMessage<{ mappings: MeetTaskMappingV1[] }>({ action: 'getMeetMappings' });
        const mappings = Array.isArray(result?.mappings) ? result.mappings.slice(0, 50) : [];
        setVisible(mappingsDetails, true);
        mappingsList.replaceChildren();

        if (mappings.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'hint mt-8';
            empty.textContent = 'Todavía no hay salas vinculadas.';
            mappingsList.appendChild(empty);
            return;
        }

        const details = new Map<string, MeetMappingTaskDetail>();
        const taskIds = [...new Set(mappings.map((mapping) => mapping.taskId))];
        for (let index = 0; index < taskIds.length; index += 4) {
            const batch = taskIds.slice(index, index + 4);
            const resolved = await Promise.all(batch.map((taskId) => resolveTaskDetail(taskId)));
            for (const detail of resolved) details.set(detail.id, detail);
        }

        const tableRegion = document.createElement('div');
        tableRegion.className = 'meet-mappings-table-region';
        tableRegion.tabIndex = 0;
        tableRegion.setAttribute('role', 'region');
        tableRegion.setAttribute('aria-label', 'Vinculaciones guardadas de Google Meet');
        const table = document.createElement('table');
        table.className = 'meet-mappings-table';
        const head = document.createElement('thead');
        const headingRow = document.createElement('tr');
        for (const heading of ['Tarea', 'ID', 'Estado', 'Acciones']) {
            const cell = document.createElement('th');
            cell.scope = 'col';
            cell.textContent = heading;
            headingRow.append(cell);
        }
        head.append(headingRow);
        const body = document.createElement('tbody');

        mappings.forEach((mapping, index) => {
            const detail = details.get(mapping.taskId) || normalizeMeetMappingTaskDetail(null, mapping.taskId);
            const row = document.createElement('tr');
            const taskCell = document.createElement('td');
            taskCell.className = 'meet-mapping-name';
            taskCell.textContent = detail.name;
            const idCell = document.createElement('td');
            const id = document.createElement('code');
            id.textContent = mapping.taskId;
            idCell.append(id);
            const statusCell = document.createElement('td');
            const state = document.createElement('span');
            state.className = `meet-mapping-state ${mapping.enabled ? 'is-active' : 'is-inactive'}`;
            state.textContent = `${mapping.enabled ? 'Activa' : 'Desactivada'} · ${detail.status}`;
            statusCell.append(state);

            const actionCell = document.createElement('td');
            const buttonGroup = document.createElement('div');
            buttonGroup.className = 'meet-mapping-actions';
            const enabledButton = document.createElement('button');
            enabledButton.type = 'button';
            enabledButton.className = 'btn btn-secondary';
            enabledButton.textContent = mapping.enabled ? 'Desactivar' : 'Activar';
            enabledButton.setAttribute('aria-label', `${enabledButton.textContent} reunión vinculada ${index + 1}`);
            enabledButton.addEventListener('click', async () => {
                enabledButton.disabled = true;
                try {
                    await sendMessage({
                        action: 'setMeetMappingEnabled',
                        data: { roomKey: mapping.roomKey, enabled: !mapping.enabled },
                    });
                    await renderMappings();
                } catch {
                    enabledButton.disabled = false;
                }
            });

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'btn btn-danger';
            deleteButton.textContent = 'Borrar';
            deleteButton.setAttribute('aria-label', `Borrar reunión vinculada ${index + 1}`);
            deleteButton.addEventListener('click', async () => {
                deleteButton.disabled = true;
                try {
                    await sendMessage({ action: 'deleteMeetMapping', data: { roomKey: mapping.roomKey } });
                    await renderMappings();
                } catch {
                    deleteButton.disabled = false;
                }
            });

            buttonGroup.append(enabledButton, deleteButton);
            actionCell.append(buttonGroup);
            row.append(taskCell, idCell, statusCell, actionCell);
            body.append(row);
        });
        table.append(head, body);
        tableRegion.append(table);
        mappingsList.append(tableRegion);
    };

    const renderStatus = async (): Promise<void> => {
        const status = await sendMessage<MeetPriorityStatus>({ action: 'getMeetPriorityStatus' });
        currentStatus = status;
        toggle.checked = status.enabled;

        const pending = status.status === 'awaiting-task';
        const tracking = status.status === 'tracking';
        const paused = status.status === 'paused';
        const ignored = status.status === 'ignored';
        setVisible(chooser, status.enabled && (pending || changingTask));
        setVisible(actions, status.enabled && (pending || tracking || paused));
        setVisible(previousButton, pending && !!status.previousTaskId && !!status.previousTeamId);
        setVisible(changeButton, tracking || paused);
        setVisible(resumeButton, paused);
        setVisible(ignoreButton, pending);
        setVisible(endButton, tracking || paused);

        if (!status.enabled) {
            setStatusCopy('Prioridad Meet desactivada', 'El sitio Meet no tiene autoridad sobre el temporizador.');
        } else if (status.status === 'idle') {
            setStatusCopy('Sin reunión activa', 'Home y prejoin no inician temporizadores.');
        } else if (pending) {
            setStatusCopy('Reunión detectada', status.conflict
                ? 'Hay otra sala abierta. Sólo la pestaña Meet enfocada puede tomar prioridad.'
                : 'No hay una tarea vinculada. Elegí una o ignorá esta sesión.');
        } else if (tracking) {
            if (status.taskId) await resolveTaskDetail(status.taskId);
            const elapsed = status.joinedAt ? formatMeetElapsed(Date.now() - status.joinedAt) : '00:00:00';
            const conflictNote = status.conflict ? ' · otra sala quedó sin autoridad' : '';
            setStatusCopy('Reunión en curso', `${taskLabel(status.taskId)} · ${elapsed}${conflictNote}`);
        } else if (paused) {
            if (status.taskId) await resolveTaskDetail(status.taskId);
            setStatusCopy('Reunión pausada', `${taskLabel(status.taskId)} · confirmá para continuar.`);
        } else if (ignored) {
            setStatusCopy('Reunión ignorada', 'El tracking normal puede continuar; esta sesión no volverá a preguntar.');
        }
    };

    const resetChooser = (): void => {
        selectedTask = null;
        changingTask = false;
        searchInput.value = '';
        searchResults.replaceChildren();
        rememberToggle.checked = false;
        assignButton.disabled = true;
    };

    searchInput.addEventListener('input', () => {
        selectedTask = null;
        assignButton.disabled = true;
        const query = searchInput.value.trim();
        const revision = ++searchRevision;
        if (searchTimeout) clearTimeout(searchTimeout);
        searchResults.replaceChildren();
        if (query.length < 2) return;

        const loading = document.createElement('p');
        loading.className = 'hint';
        loading.textContent = 'Buscando…';
        searchResults.appendChild(loading);
        searchTimeout = setTimeout(async () => {
            try {
                const result = await sendMessage<{ tasks: Array<{ id?: string; name?: string }> }>({
                    action: 'searchTasks',
                    data: { query },
                });
                if (revision !== searchRevision) return;
                searchResults.replaceChildren();
                const tasks = Array.isArray(result?.tasks) ? result.tasks.slice(0, 5) : [];
                if (tasks.length === 0) {
                    const empty = document.createElement('p');
                    empty.className = 'hint';
                    empty.textContent = 'No se encontraron tareas';
                    searchResults.appendChild(empty);
                    return;
                }
                tasks.forEach((task) => {
                    if (!task.id || !task.name) return;
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'search-result-item meet-task-result';
                    const name = document.createElement('span');
                    name.className = 'task-name';
                    name.textContent = task.name;
                    const id = document.createElement('span');
                    id.className = 'task-id';
                    id.textContent = task.id;
                    item.append(name, id);
                    item.addEventListener('click', () => {
                        selectedTask = { id: task.id!, name: task.name! };
                        searchInput.value = task.name!;
                        searchResults.replaceChildren();
                        assignButton.disabled = false;
                    });
                    searchResults.appendChild(item);
                });
            } catch {
                if (revision !== searchRevision) return;
                searchResults.replaceChildren();
                const error = document.createElement('p');
                error.className = 'hint';
                error.textContent = 'No se pudo buscar';
                searchResults.appendChild(error);
            }
        }, 300);
    });

    assignButton.addEventListener('click', async () => {
        if (!selectedTask) return;
        const teamId = await getTeamId();
        if (!teamId) {
            setStatusCopy('Falta espacio de trabajo', 'Elegí un espacio en Configuración.');
            return;
        }
        assignButton.disabled = true;
        try {
            const remember = rememberToggle.checked;
            const result = await sendMessage<{ success: boolean; mappingSaved: boolean }>({
                action: 'assignMeetTask',
                data: { taskId: selectedTask.id, teamId, remember },
            });
            resetChooser();
            await Promise.all([renderStatus(), renderMappings(), refreshTimeTracking()]);
            if (remember && !result.mappingSaved) {
                setStatusCopy('Reunión en curso', 'El timer inició, pero la asociación no pudo guardarse.');
            }
        } catch {
            setStatusCopy('No se pudo asignar', 'La reunión o la tarea ya no están disponibles.');
            assignButton.disabled = false;
        }
    });

    previousButton.addEventListener('click', async () => {
        if (!currentStatus.previousTaskId || !currentStatus.previousTeamId) return;
        previousButton.disabled = true;
        try {
            const remember = rememberToggle.checked;
            const result = await sendMessage<{ success: boolean; mappingSaved: boolean }>({
                action: 'assignMeetTask',
                data: {
                    taskId: currentStatus.previousTaskId,
                    teamId: currentStatus.previousTeamId,
                    remember,
                },
            });
            await Promise.all([renderStatus(), renderMappings(), refreshTimeTracking()]);
            if (remember && !result.mappingSaved) {
                setStatusCopy('Reunión en curso', 'La tarea se reutilizó, pero la asociación no pudo guardarse.');
            }
        } catch {
            setStatusCopy('No se pudo reutilizar', 'La tarea anterior no es válida para esta sesión.');
        } finally {
            previousButton.disabled = false;
        }
    });

    changeButton.addEventListener('click', () => {
        selectedTask = null;
        searchInput.value = '';
        searchResults.replaceChildren();
        rememberToggle.checked = false;
        assignButton.disabled = true;
        changingTask = true;
        setVisible(chooser, true);
        searchInput.focus();
    });

    resumeButton.addEventListener('click', async () => {
        resumeButton.disabled = true;
        try {
            await sendMessage({ action: 'resumeMeetSession' });
            await Promise.all([renderStatus(), refreshTimeTracking()]);
        } catch {
            setStatusCopy('No se pudo reanudar', 'La sala o la tarea ya no están disponibles.');
        } finally {
            resumeButton.disabled = false;
        }
    });

    ignoreButton.addEventListener('click', async () => {
        ignoreButton.disabled = true;
        try {
            await sendMessage({ action: 'ignoreMeetSession' });
            resetChooser();
            await Promise.all([renderStatus(), refreshTimeTracking()]);
        } finally {
            ignoreButton.disabled = false;
        }
    });

    endButton.addEventListener('click', async () => {
        endButton.disabled = true;
        try {
            await sendMessage({ action: 'endMeetSession' });
            resetChooser();
            await Promise.all([renderStatus(), refreshTimeTracking()]);
        } finally {
            endButton.disabled = false;
        }
    });

    toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try {
            await sendMessage({ action: 'setMeetPriorityEnabled', data: { enabled: toggle.checked } });
            resetChooser();
            await Promise.all([renderStatus(), renderMappings(), refreshTimeTracking()]);
        } catch {
            toggle.checked = !toggle.checked;
            setStatusCopy('No se pudo cambiar', 'La configuración permanece sin cambios.');
        } finally {
            toggle.disabled = false;
        }
    });

    mappingsDetails.addEventListener('toggle', () => {
        if ((mappingsDetails as HTMLDetailsElement).open) void renderMappings();
    });

    await renderStatus();
    await renderMappings();
    const statusPoll = window.setInterval(() => {
        if (document.visibilityState === 'visible') void renderStatus();
    }, 1_000);
    return () => {
        clearInterval(statusPoll);
        if (searchTimeout) clearTimeout(searchTimeout);
    };
}

function formatMeetElapsed(durationMs: number): string {
    const safeMs = Math.max(0, durationMs);
    const hours = Math.floor(safeMs / 3_600_000);
    const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
    const seconds = Math.floor((safeMs % 60_000) / 1_000);
    return [hours, minutes, seconds].map((value) => value.toString().padStart(2, '0')).join(':');
}


// ============================================================================
// Team Loading
// ============================================================================

async function loadTeams(): Promise<void> {
    const teamSelect = document.getElementById('teamSelect') as HTMLSelectElement;

    try {
        console.log('[Popup] LOAD_TEAMS');
        const teams = await sendMessage<{ teams: ClickUpTeam[] }>({ action: 'getTeams' });
        console.log('[Popup] WORKSPACES_LOADED_COUNT', teams?.teams?.length || 0);

        // Cache teams to storage to ensure getTeamId can find them later
        if (teams && teams.teams && teams.teams.length > 0) {
            await chrome.storage.local.set({ cachedTeams: teams });
        }

        if (!teams || !teams.teams || teams.teams.length === 0) {
            console.error('[Popup] NO_TEAMS_FOUND');
            teamSelect.innerHTML = '<option value="">No se encontraron espacios</option>';
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

        let initialTeamId = selectAuthorizedTeamId(teams.teams, savedTeamId);

        // Auto-select if only one team exists and no preference saved (or preference matches)
        if (initialTeamId && initialTeamId !== savedTeamId) {
            console.log('[Popup] SINGLE_WORKSPACE_AUTO_SELECT');
            await sendMessage({ action: 'savePreferredTeam', data: { teamId: initialTeamId } });
        }

        if (initialTeamId) {
            teamSelect.value = initialTeamId;
        }

        // NOTE: No auto-preload. User must click "Sync Lists" to preload cache.
        // Searching works on-demand if cache is empty.

        // Listener for changes
        teamSelect.addEventListener('change', async () => {
            const teamId = teamSelect.value;
            if (!teamId) return;

            // Save preference
            await sendMessage({ action: 'savePreferredTeam', data: { teamId } });

            showSavedIndicator(); // Reusing existing indicator logic (assumed global or create it)

            // NOTE: No auto-preload on workspace change. User can click "Sync Lists" if needed.
        });

    } catch (error) {
        console.error('[Popup] LOAD_TEAMS_ERROR');
        teamSelect.innerHTML = '<option value="">No se pudieron cargar los espacios</option>';
    }
}

function showSavedIndicator(): void {
    const indicator = document.createElement('div');
    indicator.className = 'saved-indicator';
    indicator.textContent = '✓ Guardado';
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
        const selectedTeamId = selectAuthorizedTeamId(store.cachedTeams?.teams, store.preferredTeamId);
        if (selectedTeamId) return selectedTeamId;

        // 3. Fallback: Check Active DOM Element (if applicable)
        const teamSelect = document.getElementById('teamSelect') as HTMLSelectElement;
        if (teamSelect && teamSelect.value) {
            return teamSelect.value;
        }

        return null;
    } catch (e) {
        console.error('[Popup] GET_TEAM_ID_ERROR');
        return null;
    }
}


// ============================================================================
// Cache Status
// ============================================================================

async function loadCacheStatus(): Promise<void> {
    const status = document.getElementById('syncStatus') as HTMLElement;

    try {
        const teamId = await getTeamId();
        if (!teamId) {
            status.textContent = '⚠️ Seleccioná primero un espacio de trabajo';
            status.style.color = '#ff9800';
            return;
        }

        // Cache structure is: { [teamId]: { data: { spaces: [...] }, timestamp: number } }
        const cache = await sendMessage<Record<string, { data?: { spaces?: any[] }; timestamp?: number }>>({
            action: 'getHierarchyCache'
        });

        const teamCache = cache?.[teamId];
        if (teamCache && teamCache.timestamp) {
            const elapsed = Date.now() - teamCache.timestamp;
            const minutes = Math.floor(elapsed / 60000);
            const hours = Math.floor(minutes / 60);

            let timeAgo = '';
            if (hours > 24) {
                const days = Math.floor(hours / 24);
                timeAgo = `hace ${days} día${days > 1 ? 's' : ''}`;
            } else if (hours > 0) {
                timeAgo = `hace ${hours} hora${hours > 1 ? 's' : ''}`;
            } else if (minutes > 0) {
                timeAgo = `hace ${minutes} min`;
            } else {
                timeAgo = 'recién';
            }

            // Count lists from hierarchy: spaces → folders → lists + folderless lists
            let listCount = 0;
            if (teamCache.data?.spaces) {
                for (const space of teamCache.data.spaces) {
                    listCount += space.lists?.length || 0;
                    for (const folder of (space.folders || [])) {
                        listCount += folder.lists?.length || 0;
                    }
                }
            }

            status.textContent = `✅ ${listCount} listas sincronizadas ${timeAgo}`;
            status.style.color = '#00c853';
        } else {
            status.textContent = '⚠️ Todavía no sincronizado; hacé clic para sincronizar';
            status.style.color = '#ff9800';
        }
    } catch (e) {
        status.textContent = 'Precargar listas para crear tareas más rápido';
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
                timeAgo = `hace ${days} día${days > 1 ? 's' : ''}`;
            } else if (hours > 0) {
                timeAgo = `hace ${hours} hora${hours > 1 ? 's' : ''}`;
            } else if (minutes > 0) {
                timeAgo = `hace ${minutes} min`;
            } else {
                timeAgo = 'recién';
            }

            status.textContent = `✅ ${syncData.foundCount || 0} vínculos encontrados ${timeAgo}`;
            status.style.color = '#00c853';
        } else {
            status.textContent = '⚠️ No sincronizado; útil para migrar a otra PC';
            status.style.color = '#ff9800';
        }
    } catch (e) {
        status.textContent = 'Sincronizar tareas vinculadas a emails';
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
                const data = await chrome.storage.local.get([
                    'emailTaskMappings',
                    'emailTaskMappingsV2',
                    'preferredTeamId',
                    'threadIdField',
                    'useCustomFieldForThreadId',
                    'autoStartTimer',
                    'autoStopTimer'
                ]);
                const exportData = await createSafeExportPayload(data, chrome.runtime.getManifest().version);

                // Create download
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `clickup-gmail-backup-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
                await chrome.storage.local.set({ [LAST_SAFE_BACKUP_KEY]: Date.now() });

                if (dataStatus) {
                    dataStatus.textContent = '✅ Datos exportados correctamente';
                    dataStatus.style.color = '#00c853';
                }
            } catch (e) {
                if (dataStatus) {
                    dataStatus.textContent = '❌ No se pudo exportar. Intentá de nuevo.';
                    dataStatus.style.color = '#ff5252';
                }
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            try {
                const backupState = await chrome.storage.local.get(LAST_SAFE_BACKUP_KEY);
                const confirmation = prompt('Escribí BORRAR DATOS para eliminar vínculos locales y cachés sin autenticación. Exportá primero si no hiciste backup en los últimos 15 minutos.');
                const decision = canClearLocalData(backupState[LAST_SAFE_BACKUP_KEY], Date.now(), confirmation || '');
                if (!decision.ok) {
                    if (dataStatus) {
                        dataStatus.textContent = decision.code === 'BACKUP_REQUIRED'
                            ? '⚠️ Exportá los datos primero. Se requiere un backup seguro reciente.'
                            : '⚠️ Borrado cancelado. La confirmación no coincide.';
                        dataStatus.style.color = '#ff9800';
                    }
                    return;
                }

                await sendMessage({ action: 'clearLocalData' });

                if (dataStatus) {
                    dataStatus.textContent = '✅ Vínculos locales y caché sin autenticación borrados';
                    dataStatus.style.color = '#00c853';
                }
            } catch (e) {
                if (dataStatus) {
                    dataStatus.textContent = '❌ No se pudo borrar. Intentá de nuevo.';
                    dataStatus.style.color = '#ff5252';
                }
            }
        });
    }
}

async function initMeetingLinkSection(): Promise<void> {
    const section = document.getElementById('meetingLinkSection') as HTMLElement | null;
    await initMeetingLinkSectionFailClosed(
        section,
        () => sendMessage<MeetingLinkUiState>({ action: 'getMeetingLinkUiState' }),
    );
}

// ============================================================================
// Message Helper
// ============================================================================

async function sendMessage<T = any>(message: { action: string; data?: any }): Promise<T> {
    const response = await chrome.runtime.sendMessage(message) as any;
    if (response?.error) {
        if (response.requiresReauth === true) window.location.reload();
        throw new Error(response.error);
    }
    return response as T;
}
