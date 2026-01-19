/**
 * Configuration Tab Module
 * Handles OAuth config, default list selection, and settings
 */

// ============================================================================
// Types
// ============================================================================

export interface ConfigTabDependencies {
    sendMessage: <T = any>(action: string, data?: any) => Promise<T>;
    escapeHtml: (text: string) => string;
    onLogout?: () => void;
    onOAuthSaved?: () => void;
    onDefaultListSet?: (listId: string) => void;
}

interface Team {
    id: string;
    name: string;
}

interface Space {
    id: string;
    name: string;
}

interface List {
    id: string;
    name: string;
}

// ============================================================================
// Config Tab Class
// ============================================================================

export class ConfigTab {
    private clientId: HTMLInputElement | null = null;
    private clientSecret: HTMLInputElement | null = null;
    private saveOauthBtn: HTMLButtonElement | null = null;
    private teamSelect: HTMLSelectElement | null = null;
    private spaceSelect: HTMLSelectElement | null = null;
    private listSelect: HTMLSelectElement | null = null;
    private setDefaultBtn: HTMLButtonElement | null = null;
    private logoutBtn: HTMLButtonElement | null = null;

    private deps: ConfigTabDependencies | null = null;

    setDependencies(deps: ConfigTabDependencies): void {
        this.deps = deps;
    }

    init(): void {
        this.initElements();
        this.initOAuthForm();
        this.initHierarchySelects();
        this.initLogout();
    }

    private initElements(): void {
        this.clientId = document.getElementById('clientId') as HTMLInputElement;
        this.clientSecret = document.getElementById('clientSecret') as HTMLInputElement;
        this.saveOauthBtn = document.getElementById('saveOauth') as HTMLButtonElement;
        this.teamSelect = document.getElementById('teamSelect') as HTMLSelectElement;
        this.spaceSelect = document.getElementById('spaceSelect') as HTMLSelectElement;
        this.listSelect = document.getElementById('listSelect') as HTMLSelectElement;
        this.setDefaultBtn = document.getElementById('setDefaultList') as HTMLButtonElement;
        this.logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement;
    }

    private initOAuthForm(): void {
        this.saveOauthBtn?.addEventListener('click', async () => {
            if (!this.deps) return;

            const clientIdVal = this.clientId?.value.trim();
            const clientSecretVal = this.clientSecret?.value.trim();

            if (!clientIdVal || !clientSecretVal) {
                alert('Please enter both Client ID and Client Secret');
                return;
            }

            await this.deps.sendMessage('saveOAuthConfig', {
                clientId: clientIdVal,
                clientSecret: clientSecretVal,
                redirectUrl: chrome.identity.getRedirectURL()
            });

            this.deps.onOAuthSaved?.();
        });
    }

    private initHierarchySelects(): void {
        this.teamSelect?.addEventListener('change', async () => {
            if (!this.deps) return;
            const teamId = this.teamSelect!.value;
            if (teamId) {
                await this.loadSpaces(teamId);
            }
        });

        this.spaceSelect?.addEventListener('change', async () => {
            if (!this.deps) return;
            const spaceId = this.spaceSelect!.value;
            if (spaceId) {
                await this.loadLists(spaceId);
            }
        });

        this.setDefaultBtn?.addEventListener('click', async () => {
            if (!this.deps) return;
            const listId = this.listSelect?.value;
            if (listId) {
                await this.deps.sendMessage('setDefaultList', { listId });
                this.deps.onDefaultListSet?.(listId);
            }
        });
    }

    private initLogout(): void {
        this.logoutBtn?.addEventListener('click', async () => {
            if (!this.deps) return;
            await this.deps.sendMessage('logout', {});
            this.deps.onLogout?.();
        });
    }

    async loadTeams(): Promise<void> {
        if (!this.deps || !this.teamSelect) return;

        const result = await this.deps.sendMessage<{ teams: Team[] }>('getTeams', {});
        const teams = result?.teams || [];

        this.teamSelect.innerHTML = '<option value="">Select team...</option>' +
            teams.map(t => `<option value="${t.id}">${this.deps!.escapeHtml(t.name)}</option>`).join('');
    }

    async loadSpaces(teamId: string): Promise<void> {
        if (!this.deps || !this.spaceSelect) return;

        const result = await this.deps.sendMessage<{ spaces: Space[] }>('getSpaces', { teamId });
        const spaces = result?.spaces || [];

        this.spaceSelect.innerHTML = '<option value="">Select space...</option>' +
            spaces.map(s => `<option value="${s.id}">${this.deps!.escapeHtml(s.name)}</option>`).join('');

        if (this.listSelect) {
            this.listSelect.innerHTML = '<option value="">Select list...</option>';
        }
    }

    async loadLists(spaceId: string): Promise<void> {
        if (!this.deps || !this.listSelect) return;

        const result = await this.deps.sendMessage<{ lists: List[] }>('getLists', { spaceId });
        const lists = result?.lists || [];

        this.listSelect.innerHTML = '<option value="">Select list...</option>' +
            lists.map(l => `<option value="${l.id}">${this.deps!.escapeHtml(l.name)}</option>`).join('');
    }
}

export const configTab = new ConfigTab();
