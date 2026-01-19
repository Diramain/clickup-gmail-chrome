/**
 * Assignee Selector Component
 * Multi-select dropdown for team members
 */

// ============================================================================
// Types
// ============================================================================

export interface Member {
    id: number;
    username?: string;
    email?: string;
    profilePicture?: string | null;
}

export interface AssigneeSelectorConfig {
    containerId: string;
    dropdownId: string;
}

export interface AssigneeSelectorDependencies {
    getMembers: () => Member[];
    escapeHtml: (text: string) => string;
    onSelectionChange?: (selected: number[]) => void;
}

// ============================================================================
// Assignee Selector Class
// ============================================================================

export class AssigneeSelector {
    private container: HTMLElement | null = null;
    private dropdown: HTMLElement | null = null;

    private members: Member[] = [];
    private selectedIds: number[] = [];
    private deps: AssigneeSelectorDependencies | null = null;

    setDependencies(deps: AssigneeSelectorDependencies): void {
        this.deps = deps;
    }

    init(config: AssigneeSelectorConfig): void {
        this.container = document.getElementById(config.containerId) as HTMLElement;
        this.dropdown = document.getElementById(config.dropdownId) as HTMLElement;

        this.bindEvents();
    }

    updateMembers(members: Member[]): void {
        this.members = members;
        this.render();
    }

    private bindEvents(): void {
        // Toggle dropdown on container click
        this.container?.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).classList.contains('cu-remove-assignee')) {
                return; // Let remove handler deal with it
            }
            this.toggleDropdown();
        });

        // Hide on click outside
        document.addEventListener('click', (e) => {
            if (!this.container?.contains(e.target as Node) && !this.dropdown?.contains(e.target as Node)) {
                this.hideDropdown();
            }
        });
    }

    private render(): void {
        if (!this.dropdown || !this.deps) return;

        this.dropdown.innerHTML = this.members.map(m => {
            const isSelected = this.selectedIds.includes(m.id);
            return `
                <div class="cu-member-option ${isSelected ? 'selected' : ''}" data-id="${m.id}">
                    <div class="cu-member-avatar">
                        ${m.profilePicture
                    ? `<img src="${m.profilePicture}" alt="">`
                    : (m.username || m.email || '?').charAt(0).toUpperCase()
                }
                    </div>
                    <span class="cu-member-name">${this.deps!.escapeHtml(m.username || m.email || 'Unknown')}</span>
                    ${isSelected ? '<span class="cu-check">✓</span>' : ''}
                </div>
            `;
        }).join('');

        this.dropdown.querySelectorAll('.cu-member-option').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt((el as HTMLElement).dataset.id!, 10);
                this.toggleMember(id);
            });
        });
    }

    private renderSelected(): void {
        if (!this.container || !this.deps) return;

        const selectedMembers = this.members.filter(m => this.selectedIds.includes(m.id));

        if (selectedMembers.length === 0) {
            this.container.innerHTML = '<span class="cu-placeholder">Select assignees...</span>';
        } else {
            this.container.innerHTML = selectedMembers.map(m => `
                <span class="cu-assignee-tag" data-id="${m.id}">
                    ${this.deps!.escapeHtml(m.username || m.email || '?')}
                    <button class="cu-remove-assignee">&times;</button>
                </span>
            `).join('');

            this.container.querySelectorAll('.cu-remove-assignee').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const tag = (btn as HTMLElement).parentElement!;
                    const id = parseInt(tag.dataset.id!, 10);
                    this.removeMember(id);
                });
            });
        }
    }

    private toggleMember(id: number): void {
        const index = this.selectedIds.indexOf(id);
        if (index === -1) {
            this.selectedIds.push(id);
        } else {
            this.selectedIds.splice(index, 1);
        }

        this.render();
        this.renderSelected();
        this.deps?.onSelectionChange?.(this.selectedIds);
    }

    private removeMember(id: number): void {
        const index = this.selectedIds.indexOf(id);
        if (index !== -1) {
            this.selectedIds.splice(index, 1);
            this.render();
            this.renderSelected();
            this.deps?.onSelectionChange?.(this.selectedIds);
        }
    }

    private toggleDropdown(): void {
        this.dropdown?.classList.toggle('hidden');
    }

    private hideDropdown(): void {
        this.dropdown?.classList.add('hidden');
    }

    getSelectedIds(): number[] {
        return [...this.selectedIds];
    }

    setSelectedIds(ids: number[]): void {
        this.selectedIds = [...ids];
        this.render();
        this.renderSelected();
    }

    preselectMember(id: number): void {
        if (!this.selectedIds.includes(id)) {
            this.selectedIds.push(id);
            this.render();
            this.renderSelected();
        }
    }

    clear(): void {
        this.selectedIds = [];
        this.render();
        this.renderSelected();
    }
}

export const assigneeSelector = new AssigneeSelector();
