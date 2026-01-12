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
    PREFIX: string;
    STYLES: LogStyles;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, error?: Error | unknown, context?: unknown): void;
    group(label: string, fn: () => void): void;
    time(label: string): () => void;
}

const Logger: ILogger = {
    /**
     * Enable verbose debug logging
     * Can be toggled via: Logger.DEBUG = true
     */
    DEBUG: false,

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
        if (!this.DEBUG) return;

        const prefix = `${this.PREFIX} [${this._timestamp()}] DEBUG:`;
        if (data !== null) {
            console.log(`%c${prefix} ${message}`, this.STYLES.debug, data);
        } else {
            console.log(`%c${prefix} ${message}`, this.STYLES.debug);
        }
    },

    /**
     * Info log
     */
    info(message: string, data: unknown = null): void {
        const prefix = `${this.PREFIX}`;
        if (data !== null) {
            console.log(`%c${prefix} ${message}`, this.STYLES.info, data);
        } else {
            console.log(`%c${prefix} ${message}`, this.STYLES.info);
        }
    },

    /**
     * Warning log
     */
    warn(message: string, data: unknown = null): void {
        const prefix = `${this.PREFIX} ⚠️`;
        if (data !== null) {
            console.warn(`%c${prefix} ${message}`, this.STYLES.warn, data);
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
            if (error instanceof Error) {
                console.error(`  → ${error.message}`);
                if (this.DEBUG && error.stack) {
                    console.error(error.stack);
                }
            } else {
                console.error('  →', error);
            }
        }

        if (context) {
            console.error('  Context:', context);
        }
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
(window as any).Logger = Logger;
