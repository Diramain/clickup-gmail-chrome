/**
 * Time Tracking Tab Module
 * Handles timer controls, manual time entry, and history
 */

import type { TimeEntry } from '../../src/types/clickup';

// ============================================================================
// Types
// ============================================================================

export interface TrackingTabDependencies {
    sendMessage: <T = any>(action: string, data?: any) => Promise<T>;
    escapeHtml: (text: string) => string;
    getTeamId: () => string;
    formatDuration: (ms: number) => string;
    parseDuration: (str: string) => number;
}

interface ClickUpTask {
    id: string;
    name: string;
    url?: string;
}

// ============================================================================
// Tracking Tab Class
// ============================================================================

export class TrackingTab {
    private timerContainer: HTMLElement | null = null;
    private taskSearch: HTMLInputElement | null = null;
    private taskSearchResults: HTMLElement | null = null;
    private manualDuration: HTMLInputElement | null = null;
    private addManualTimeBtn: HTMLButtonElement | null = null;
    private timeHistory: HTMLElement | null = null;

    private selectedTaskId: string = '';
    private selectedTaskName: string = '';
    private searchTimeout!: ReturnType<typeof setTimeout>;
    private timerInterval: number | null = null;

    private deps: TrackingTabDependencies | null = null;

    setDependencies(deps: TrackingTabDependencies): void {
        this.deps = deps;
    }

    init(): void {
        this.initElements();
        this.initTaskSearch();
        this.initManualEntry();
    }

    private initElements(): void {
        this.timerContainer = document.getElementById('currentTimer') as HTMLElement;
        this.taskSearch = document.getElementById('timerTaskSearch') as HTMLInputElement;
        this.taskSearchResults = document.getElementById('timerTaskResults') as HTMLElement;
        this.manualDuration = document.getElementById('manualDuration') as HTMLInputElement;
        this.addManualTimeBtn = document.getElementById('addManualTime') as HTMLButtonElement;
        this.timeHistory = document.getElementById('timeHistory') as HTMLElement;
    }

    private initTaskSearch(): void {
        if (!this.taskSearch) return;

        this.taskSearch.addEventListener('input', () => {
            clearTimeout(this.searchTimeout);
            const query = this.taskSearch!.value.trim();

            if (query.length < 2) {
                if (this.taskSearchResults) this.taskSearchResults.innerHTML = '';
                return;
            }

            this.searchTimeout = setTimeout(() => {
                this.searchTasks(query);
            }, 300);
        });
    }

    private initManualEntry(): void {
        this.manualDuration?.addEventListener('input', () => {
            this.checkManualEnabled();
        });
    }

    private checkManualEnabled(): void {
        if (this.addManualTimeBtn) {
            this.addManualTimeBtn.disabled = !(
                this.selectedTaskId &&
                this.manualDuration?.value.trim()
            );
        }
    }

    async loadRunningTimer(): Promise<void> {
        if (!this.deps) return;
        const teamId = this.deps.getTeamId();
        if (!teamId) return;

        const result = await this.deps.sendMessage('getRunningTimer', { teamId });

        if (result?.task) {
            this.displayRunningTimer(result);
        } else {
            this.displayNoTimer();
        }
    }

    private displayRunningTimer(timer: TimeEntry): void {
        if (!this.timerContainer || !this.deps) return;

        const taskName = timer.task?.name || 'Unknown Task';
        const startTime = typeof timer.start === 'number' ? timer.start : parseInt(timer.start as string);

        this.timerContainer.innerHTML = `
            <div class="timer-running">
                <div class="timer-task">${this.deps.escapeHtml(taskName)}</div>
                <div class="timer-elapsed" id="timerElapsed">--:--:--</div>
                <button id="stopTimerBtn" class="btn btn-danger">Stop</button>
            </div>
        `;

        this.startElapsedTimer(startTime);

        document.getElementById('stopTimerBtn')?.addEventListener('click', () => {
            this.stopTimer();
        });
    }

    private displayNoTimer(): void {
        if (this.timerContainer) {
            this.timerContainer.innerHTML = '<p class="no-timer">No timer running</p>';
        }
    }

    private startElapsedTimer(startTime: number): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }

        const updateElapsed = () => {
            const elapsed = Date.now() - startTime;
            const el = document.getElementById('timerElapsed');
            if (el && this.deps) {
                el.textContent = this.deps.formatDuration(elapsed);
            }
        };

        updateElapsed();
        this.timerInterval = window.setInterval(updateElapsed, 1000);
    }

    async stopTimer(): Promise<void> {
        if (!this.deps) return;
        const teamId = this.deps.getTeamId();
        if (!teamId) return;

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        await this.deps.sendMessage('stopTimer', { teamId });
        this.displayNoTimer();
        await this.loadTimeHistory();
    }

    async loadTimeHistory(): Promise<void> {
        if (!this.deps || !this.timeHistory) return;
        const teamId = this.deps.getTeamId();
        if (!teamId) return;

        const startDate = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const entries = await this.deps.sendMessage<TimeEntry[]>('getTimeEntries', {
            teamId,
            startDate
        }) || [];

        if (entries.length > 0) {
            this.timeHistory.innerHTML = entries.slice(0, 10).map(entry => `
                <div class="time-entry">
                    <div class="entry-task">${this.deps!.escapeHtml(entry.task?.name || 'Unknown')}</div>
                    <div class="entry-duration">${this.deps!.formatDuration(Number(entry.duration))}</div>
                </div>
            `).join('');
        } else {
            this.timeHistory.innerHTML = '<p class="no-entries">No time entries</p>';
        }
    }

    private async searchTasks(query: string): Promise<void> {
        if (!this.deps || !this.taskSearchResults) return;

        const result = await this.deps.sendMessage('searchTasks', { query });

        if (result?.tasks?.length > 0) {
            this.taskSearchResults.innerHTML = result.tasks.slice(0, 5).map((task: ClickUpTask) => `
                <div class="task-result-item" data-task-id="${task.id}" data-task-name="${this.deps!.escapeHtml(task.name)}">
                    <div class="task-name">${this.deps!.escapeHtml(task.name)}</div>
                </div>
            `).join('');

            this.taskSearchResults.querySelectorAll('.task-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const el = item as HTMLElement;
                    this.selectTask(el.dataset.taskId!, el.dataset.taskName!);
                });
            });
        }
    }

    private selectTask(taskId: string, taskName: string): void {
        this.selectedTaskId = taskId;
        this.selectedTaskName = taskName;
        if (this.taskSearch) this.taskSearch.value = taskName;
        if (this.taskSearchResults) this.taskSearchResults.innerHTML = '';
        this.checkManualEnabled();
    }

    getSelectedTaskId(): string {
        return this.selectedTaskId;
    }
}

export const trackingTab = new TrackingTab();
