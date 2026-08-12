/**
 * Logger Utility
 * Structured logging with levels for Chrome extension
 * 
 * Usage:
 *   Logger.info('Message', { data });
 *   Logger.warn('Warning', { context });
 *   Logger.error('Error', error, { context });
 */

interface LogStyles {
    info: string;
    warn: string;
    error: string;
    debug: string;
}

interface ILogger {
    DEBUG: boolean;
    PRODUCTION: boolean;  // SEC-M3: Suppress logs in production
    PREFIX: string;
    STYLES: LogStyles;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, error?: Error | unknown, context?: unknown): void;
    group(label: string, fn: () => void): void;
    time(label: string): () => void;
    sanitizeError(error: unknown): string;
}

const Logger: ILogger = {
    /**
     * Enable verbose debug logging for local, non-persistent troubleshooting only.
     * Toggle explicitly in DevTools runtime when needed; never persist this flag.
     */
    DEBUG: false,

    /**
     * Release-safe by default. Production logging allows only event names,
     * counters, and sanitized error codes. No payloads, storage snapshots,
     * email content, URLs, OAuth config, tokens, teams, members, or task data.
     */
    PRODUCTION: true,

    /**
     * Prefix for all log messages
     */
    PREFIX: '[ClickUp]',

    /**
     * Log styles for console
     */
    STYLES: {
        info: 'color: #49CCF9',
        warn: 'color: #FFC107; font-weight: bold',
        error: 'color: #FF5252; font-weight: bold',
        debug: 'color: #888'
    },

    /**
     * Format timestamp
     */
    _timestamp(): string {
        return new Date().toISOString().substr(11, 12);
    },

    /**
     * Debug log - only shown when DEBUG is true
     */
    debug(message: string, data: unknown = null): void {
        if (!this.DEBUG || this.PRODUCTION) return;

        const prefix = `${this.PREFIX} [${this._timestamp()}] DEBUG:`;
        console.log(`%c${prefix} ${message}`, this.STYLES.debug);
    },

    /**
     * Info log (suppressed in PRODUCTION mode)
     */
    info(message: string, data: unknown = null): void {
        if (this.PRODUCTION) return;  // SEC-M3: Skip in production

        const prefix = `${this.PREFIX}`;
        console.log(`%c${prefix} ${message}`, this.STYLES.info);
    },

    /**
     * Warning log
     */
    warn(message: string, data: unknown = null): void {
        const prefix = `${this.PREFIX} ⚠️`;
        if (this.PRODUCTION) {
            console.warn(`%c${prefix} ${message}`, this.STYLES.warn);
        } else {
            console.warn(`%c${prefix} ${message}`, this.STYLES.warn);
        }
    },

    /**
     * Error log with optional error object
     */
    error(message: string, error: Error | unknown = null, context: unknown = null): void {
        const prefix = `${this.PREFIX} ❌`;
        console.error(`%c${prefix} ${message}`, this.STYLES.error);

        if (error) {
            console.error(`  → ${this.sanitizeError(error)}`);
            if (!this.PRODUCTION && error instanceof Error) {
                if (this.DEBUG && error.stack) {
                    console.error(error.stack);
                }
            }
        }

        void context;
    },

    sanitizeError(error: unknown): string {
        const raw = error instanceof Error ? error.message : String(error || 'unknown_error');
        if (/\b(401|403)\b/.test(raw)) return 'auth_error';
        if (/\b429\b/.test(raw)) return 'rate_limited';
        if (/\b5\d\d\b/.test(raw)) return 'upstream_error';
        if (/network|fetch/i.test(raw)) return 'network_error';
        if (/oauth|token|secret|credential|config/i.test(raw)) return 'credential_error';
        return 'operation_failed';
    },

    /**
     * Group related logs
     */
    group(label: string, fn: () => void): void {
        console.group(`${this.PREFIX} ${label}`);
        try {
            fn();
        } finally {
            console.groupEnd();
        }
    },

    /**
     * Log with timing
     */
    time(label: string): () => void {
        const start = performance.now();
        return () => {
            const duration = (performance.now() - start).toFixed(2);
            this.debug(`${label} completed in ${duration}ms`);
        };
    }
} as ILogger & { _timestamp(): string };

// Export for module usage
export { Logger };
export type { ILogger };

// Make available globally for content scripts
(globalThis as any).Logger = Logger;
