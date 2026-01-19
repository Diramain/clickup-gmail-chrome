/**
 * Timer Service
 * Handles time tracking functionality and badge management
 */

import type { TimeEntry } from '../types/clickup';

// ============================================================================
// Types
// ============================================================================

export type BadgeState = 'playing' | 'stopped' | 'paused';

interface BadgeConfig {
    text: string;
    color: string;
}

// ============================================================================
// Constants
// ============================================================================

const BADGE_STATES: Record<BadgeState, BadgeConfig> = {
    playing: { text: '▶', color: '#22c55e' },
    stopped: { text: '', color: '#6b7280' },
    paused: { text: '⏸', color: '#6b7280' }
};

// ============================================================================
// Timer Service Class
// ============================================================================

type ApiMethod<T> = () => Promise<T>;

class TimerService {
    private currentState: BadgeState = 'stopped';

    // API methods injected to avoid circular dependency
    private apiStartTimer: ((teamId: string, taskId: string) => Promise<any>) | null = null;
    private apiStopTimer: ((teamId: string) => Promise<any>) | null = null;
    private apiGetRunningTimer: ((teamId: string) => Promise<TimeEntry | null>) | null = null;
    private apiCreateTimeEntry: ((teamId: string, taskId: string, duration: number, start?: number) => Promise<any>) | null = null;
    private apiGetTimeEntries: ((teamId: string, startDate?: number, endDate?: number) => Promise<TimeEntry[]>) | null = null;

    /**
     * Set API methods (inject to avoid circular dependency with ClickUpAPIWrapper)
     */
    setApiMethods(methods: {
        startTimer: (teamId: string, taskId: string) => Promise<any>;
        stopTimer: (teamId: string) => Promise<any>;
        getRunningTimer: (teamId: string) => Promise<TimeEntry | null>;
        createTimeEntry: (teamId: string, taskId: string, duration: number, start?: number) => Promise<any>;
        getTimeEntries: (teamId: string, startDate?: number, endDate?: number) => Promise<TimeEntry[]>;
    }): void {
        this.apiStartTimer = methods.startTimer;
        this.apiStopTimer = methods.stopTimer;
        this.apiGetRunningTimer = methods.getRunningTimer;
        this.apiCreateTimeEntry = methods.createTimeEntry;
        this.apiGetTimeEntries = methods.getTimeEntries;
    }

    // ========================================================================
    // Badge Management
    // ========================================================================

    /**
     * Update extension badge to show timer state
     */
    async updateBadge(state: BadgeState): Promise<void> {
        this.currentState = state;
        const config = BADGE_STATES[state];

        try {
            await chrome.action.setBadgeText({ text: config.text });
            await chrome.action.setBadgeBackgroundColor({ color: config.color });
        } catch (e) {
            console.error('[Timer] Failed to update badge:', e);
        }
    }

    /**
     * Get current badge state
     */
    getCurrentState(): BadgeState {
        return this.currentState;
    }

    // ========================================================================
    // Timer Operations
    // ========================================================================

    /**
     * Start timer for a task
     */
    async startTimer(teamId: string, taskId: string): Promise<any> {
        if (!this.apiStartTimer) {
            throw new Error('API methods not initialized');
        }

        console.log('[Timer] Starting timer for task:', taskId);
        const result = await this.apiStartTimer(teamId, taskId);
        await this.updateBadge('playing');
        return result;
    }

    /**
     * Stop running timer
     */
    async stopTimer(teamId: string): Promise<any> {
        if (!this.apiStopTimer) {
            throw new Error('API methods not initialized');
        }

        console.log('[Timer] Stopping timer');
        const result = await this.apiStopTimer(teamId);
        await this.updateBadge('stopped');
        return result;
    }

    /**
     * Get currently running timer
     */
    async getRunningTimer(teamId: string): Promise<TimeEntry | null> {
        if (!this.apiGetRunningTimer) {
            throw new Error('API methods not initialized');
        }

        const result = await this.apiGetRunningTimer(teamId);

        // Update badge based on timer state
        await this.updateBadge(result ? 'playing' : 'stopped');

        return result;
    }

    /**
     * Create a time entry (manual time tracking)
     */
    async createTimeEntry(
        teamId: string,
        taskId: string,
        duration: number,
        start?: number
    ): Promise<any> {
        if (!this.apiCreateTimeEntry) {
            throw new Error('API methods not initialized');
        }

        console.log('[Timer] Creating time entry:', { teamId, taskId, duration });
        return await this.apiCreateTimeEntry(teamId, taskId, duration, start);
    }

    /**
     * Get time entries for a date range
     */
    async getTimeEntries(
        teamId: string,
        startDate?: number,
        endDate?: number
    ): Promise<TimeEntry[]> {
        if (!this.apiGetTimeEntries) {
            throw new Error('API methods not initialized');
        }

        return await this.apiGetTimeEntries(teamId, startDate, endDate);
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Format duration in milliseconds to human readable
     */
    formatDuration(ms: number): string {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((ms % (1000 * 60)) / 1000);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }

    /**
     * Parse duration string (e.g., "2h 30m") to milliseconds
     */
    parseDuration(str: string): number | null {
        if (!str) return null;

        let totalMs = 0;
        const hours = str.match(/(\d+)\s*h/i);
        const minutes = str.match(/(\d+)\s*m/i);
        const seconds = str.match(/(\d+)\s*s/i);

        if (hours) totalMs += parseInt(hours[1]) * 60 * 60 * 1000;
        if (minutes) totalMs += parseInt(minutes[1]) * 60 * 1000;
        if (seconds) totalMs += parseInt(seconds[1]) * 1000;

        return totalMs > 0 ? totalMs : null;
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const timerService = new TimerService();
