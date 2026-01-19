/**
 * Tasks Tab Module
 * Handles task search and quick create functionality
 * 
 * @module TasksTab
 */

import type { ClickUpTask } from '../../src/types/clickup';

// ============================================================================
// Types
// ============================================================================

interface CachedListItem {
    id: string;
    name: string;
    path: string;
}

export interface TasksTabDependencies {
    sendMessage: <T = any>(action: string, data?: any) => Promise<T>;
    escapeHtml: (text: string) => string;
    getTeamId: () => string;
    getCachedLists: () => CachedListItem[];
    onTaskCreated?: (task: ClickUpTask) => void;
    onListSelected?: (list: CachedListItem) => void;
}

// ============================================================================
// Tasks Tab Class
// ============================================================================

export class TasksTab {
    private searchInput: HTMLInputElement | null = null;
    private searchResults: HTMLElement | null = null;
    private newTaskName: HTMLInputElement | null = null;
    private listSearch: HTMLInputElement | null = null;
    private listSearchResults: HTMLElement | null = null;
    private createTaskBtn: HTMLButtonElement | null = null;

    private selectedListId: string = '';
    private searchTimeout!: ReturnType<typeof setTimeout>;
    private listSearchTimeout!: ReturnType<typeof setTimeout>;

    private deps: TasksTabDependencies | null = null;

    /**
     * Inject dependencies (called before init)
     */
    setDependencies(deps: TasksTabDependencies): void {
        this.deps = deps;
    }

    /**
     * Initialize DOM elements and event listeners
     */
    init(): void {
        this.initElements();
        this.initSearchHandler();
        this.initListSearch();
        this.initQuickCreate();
    }

    private initElements(): void {
        this.searchInput = document.getElementById('taskSearch') as HTMLInputElement;
        this.searchResults = document.getElementById('searchResults') as HTMLElement;
        this.newTaskName = document.getElementById('newTaskName') as HTMLInputElement;
        this.listSearch = document.getElementById('listSearch') as HTMLInputElement;
        this.listSearchResults = document.getElementById('listSearchResults') as HTMLElement;
        this.createTaskBtn = document.getElementById('createTask') as HTMLButtonElement;
    }

    private initSearchHandler(): void {
        if (!this.searchInput) return;

        this.searchInput.addEventListener('input', () => {
            clearTimeout(this.searchTimeout);
            const query = this.searchInput!.value.trim();

            if (query.length < 2) {
                if (this.searchResults) this.searchResults.innerHTML = '';
                return;
            }

            this.searchTimeout = setTimeout(() => {
                this.searchTasks(query);
            }, 300);
        });
    }

    private initListSearch(): void {
        if (!this.listSearch) return;

        this.listSearch.addEventListener('input', () => {
            clearTimeout(this.listSearchTimeout);
            const query = this.listSearch!.value.trim();

            if (query.length < 2) {
                if (this.listSearchResults) this.listSearchResults.innerHTML = '';
                return;
            }

            this.listSearchTimeout = setTimeout(() => {
                this.searchLists(query);
            }, 300);
        });
    }

    private initQuickCreate(): void {
        this.newTaskName?.addEventListener('input', () => this.checkCreateEnabled());
    }

    private checkCreateEnabled(): void {
        if (this.createTaskBtn) {
            this.createTaskBtn.disabled = !(this.newTaskName?.value.trim() && this.selectedListId);
        }
    }

    private async searchTasks(query: string): Promise<void> {
        if (!this.deps || !this.searchResults) return;

        const result = await this.deps.sendMessage('searchTasks', { query });

        if (result?.tasks?.length > 0) {
            this.searchResults.innerHTML = result.tasks.slice(0, 5).map((task: ClickUpTask) => `
                <div class="search-result-item" data-task-id="${task.id}" data-task-url="${task.url || ''}">
                    <div class="task-name">${this.deps!.escapeHtml(task.name)}</div>
                    <div class="task-id">${task.id}</div>
                </div>
            `).join('');
        } else {
            this.searchResults.innerHTML = '<p class="no-results">No tasks found</p>';
        }
    }

    private searchLists(query: string): void {
        if (!this.deps || !this.listSearchResults) return;

        const lists = this.deps.getCachedLists();
        const queryLower = query.toLowerCase();

        const filtered = lists.filter((l: CachedListItem) =>
            l.name.toLowerCase().includes(queryLower) ||
            l.path.toLowerCase().includes(queryLower)
        ).slice(0, 8);

        if (filtered.length > 0) {
            this.listSearchResults.innerHTML = filtered.map((list: CachedListItem) => `
                <div class="list-result-item" data-list-id="${list.id}">
                    <div class="list-name">${this.deps!.escapeHtml(list.name)}</div>
                    <div class="list-path">${this.deps!.escapeHtml(list.path)}</div>
                </div>
            `).join('');

            this.listSearchResults.querySelectorAll('.list-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const listId = (item as HTMLElement).dataset.listId!;
                    const listName = item.querySelector('.list-name')?.textContent || '';
                    this.selectList(listId, listName);
                });
            });
        } else {
            this.listSearchResults.innerHTML = '<p class="no-results">No lists found</p>';
        }
    }

    private selectList(listId: string, name: string): void {
        this.selectedListId = listId;
        if (this.listSearch) this.listSearch.value = name;
        if (this.listSearchResults) this.listSearchResults.innerHTML = '';
        this.checkCreateEnabled();

        if (this.deps?.onListSelected) {
            const list = this.deps.getCachedLists().find(l => l.id === listId);
            if (list) this.deps.onListSelected(list);
        }
    }

    getSelectedListId(): string {
        return this.selectedListId;
    }
}

// Singleton instance
export const tasksTab = new TasksTab();
