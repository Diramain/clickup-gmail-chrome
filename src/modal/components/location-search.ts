/**
 * Location Search Component
 * Handles list/location search with fuzzy matching
 */

// ============================================================================
// Types
// ============================================================================

export interface ListItem {
    id: string;
    name: string;
    path: string;
    spaceName: string;
    folderName?: string;
    spaceColor: string;
    spaceAvatar: string | null;
}

export interface LocationSearchConfig {
    inputId: string;
    resultsId: string;
    selectedId: string;
}

export interface LocationSearchDependencies {
    getAllLists: () => ListItem[];
    escapeHtml: (text: string) => string;
    onSelect?: (list: ListItem) => void;
}

// ============================================================================
// Location Search Class
// ============================================================================

export class LocationSearch {
    private input: HTMLInputElement | null = null;
    private results: HTMLElement | null = null;
    private selected: HTMLElement | null = null;
    private searchTimeout!: ReturnType<typeof setTimeout>;

    private selectedList: ListItem | null = null;
    private deps: LocationSearchDependencies | null = null;

    setDependencies(deps: LocationSearchDependencies): void {
        this.deps = deps;
    }

    init(config: LocationSearchConfig): void {
        this.input = document.getElementById(config.inputId) as HTMLInputElement;
        this.results = document.getElementById(config.resultsId) as HTMLElement;
        this.selected = document.getElementById(config.selectedId) as HTMLElement;

        this.bindEvents();
    }

    private bindEvents(): void {
        if (!this.input) return;

        this.input.addEventListener('input', () => {
            clearTimeout(this.searchTimeout);
            const query = this.input!.value.trim();

            if (query.length < 2) {
                this.hideResults();
                return;
            }

            this.searchTimeout = setTimeout(() => {
                this.search(query);
            }, 150);
        });

        this.input.addEventListener('focus', () => {
            if (this.input!.value.trim().length >= 2) {
                this.search(this.input!.value.trim());
            }
        });

        // Hide on click outside
        document.addEventListener('click', (e) => {
            if (!this.input?.contains(e.target as Node) && !this.results?.contains(e.target as Node)) {
                this.hideResults();
            }
        });
    }

    private search(query: string): void {
        if (!this.deps || !this.results) return;

        const lists = this.deps.getAllLists();
        const queryLower = query.toLowerCase();

        const filtered = lists.filter(l =>
            l.name.toLowerCase().includes(queryLower) ||
            l.path.toLowerCase().includes(queryLower) ||
            l.spaceName.toLowerCase().includes(queryLower)
        ).slice(0, 10);

        if (filtered.length > 0) {
            this.results.innerHTML = filtered.map(list => `
                <div class="cu-list-result" data-list-id="${list.id}">
                    <div class="cu-list-avatar" style="background-color: ${list.spaceColor || '#7B68EE'}">
                        ${list.spaceAvatar ? `<img src="${list.spaceAvatar}" alt="">` : list.spaceName.charAt(0)}
                    </div>
                    <div class="cu-list-info">
                        <div class="cu-list-name">${this.deps!.escapeHtml(list.name)}</div>
                        <div class="cu-list-path">${this.deps!.escapeHtml(list.path)}</div>
                    </div>
                </div>
            `).join('');

            this.results.classList.remove('hidden');

            this.results.querySelectorAll('.cu-list-result').forEach(el => {
                el.addEventListener('click', () => {
                    const listId = (el as HTMLElement).dataset.listId!;
                    const list = filtered.find(l => l.id === listId);
                    if (list) this.selectList(list);
                });
            });
        } else {
            this.results.innerHTML = '<p class="cu-no-results">No lists found</p>';
            this.results.classList.remove('hidden');
        }
    }

    private selectList(list: ListItem): void {
        this.selectedList = list;

        if (this.input) this.input.value = '';
        this.hideResults();

        if (this.selected && this.deps) {
            this.selected.innerHTML = `
                <div class="cu-selected-list">
                    <div class="cu-list-avatar" style="background-color: ${list.spaceColor || '#7B68EE'}">
                        ${list.spaceAvatar ? `<img src="${list.spaceAvatar}" alt="">` : list.spaceName.charAt(0)}
                    </div>
                    <span>${this.deps.escapeHtml(list.name)}</span>
                    <button class="cu-clear-selection">&times;</button>
                </div>
            `;

            this.selected.querySelector('.cu-clear-selection')?.addEventListener('click', () => {
                this.clearSelection();
            });
        }

        this.deps?.onSelect?.(list);
    }

    private hideResults(): void {
        if (this.results) {
            this.results.innerHTML = '';
            this.results.classList.add('hidden');
        }
    }

    clearSelection(): void {
        this.selectedList = null;
        if (this.selected) this.selected.innerHTML = '';
        if (this.input) this.input.value = '';
    }

    getSelectedList(): ListItem | null {
        return this.selectedList;
    }

    setSelectedList(list: ListItem): void {
        this.selectList(list);
    }
}

export const locationSearch = new LocationSearch();
