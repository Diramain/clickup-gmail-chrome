/**
 * Timer Service Unit Tests
 */

describe('TimerService', () => {
    describe('formatDuration', () => {
        function formatDuration(ms) {
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

        test('formats hours and minutes', () => {
            expect(formatDuration(2.5 * 60 * 60 * 1000)).toBe('2h 30m');
        });

        test('formats minutes and seconds', () => {
            expect(formatDuration(5 * 60 * 1000 + 30 * 1000)).toBe('5m 30s');
        });

        test('formats seconds only', () => {
            expect(formatDuration(45 * 1000)).toBe('45s');
        });

        test('handles zero', () => {
            expect(formatDuration(0)).toBe('0s');
        });
    });

    describe('parseDuration', () => {
        function parseDuration(str) {
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

        test('parses hours', () => {
            expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
        });

        test('parses hours and minutes', () => {
            expect(parseDuration('1h 30m')).toBe(1.5 * 60 * 60 * 1000);
        });

        test('parses minutes and seconds', () => {
            expect(parseDuration('5m 30s')).toBe(5.5 * 60 * 1000);
        });

        test('returns null for empty input', () => {
            expect(parseDuration('')).toBeNull();
            expect(parseDuration(null)).toBeNull();
        });
    });

    describe('Badge States', () => {
        const BADGE_STATES = {
            playing: { text: '▶', color: '#22c55e' },
            stopped: { text: '', color: '#6b7280' },
            paused: { text: '⏸', color: '#6b7280' }
        };

        test('playing state has correct config', () => {
            expect(BADGE_STATES.playing.text).toBe('▶');
            expect(BADGE_STATES.playing.color).toBe('#22c55e');
        });

        test('stopped state clears badge text', () => {
            expect(BADGE_STATES.stopped.text).toBe('');
        });

        test('paused state shows pause icon', () => {
            expect(BADGE_STATES.paused.text).toBe('⏸');
        });
    });
});
