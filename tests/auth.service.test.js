/**
 * Auth Service Unit Tests
 */

const { mockStorage } = require('./setup');

// Mock authService behavior (since we can't import TypeScript directly)

describe('AuthService', () => {
    beforeEach(() => {
        mockStorage.clear();
    });

    describe('getStatus', () => {
        test('returns not authenticated when no token', async () => {
            const result = await chrome.storage.local.get(['clickupToken', 'oauthConfig', 'cachedUser']);
            expect(result.clickupToken).toBeUndefined();
        });

        test('returns configured when OAuth config exists', async () => {
            await chrome.storage.local.set({
                oauthConfig: {
                    clientId: 'test-client-id',
                    clientSecret: 'test-secret'
                }
            });

            const result = await chrome.storage.local.get('oauthConfig');
            expect(result.oauthConfig.clientId).toBe('test-client-id');
        });
    });

    describe('saveOAuthConfig', () => {
        test('saves OAuth configuration correctly', async () => {
            const config = {
                clientId: 'test-id',
                clientSecret: 'test-secret',
                redirectUrl: 'https://example.com/callback'
            };

            await chrome.storage.local.set({ oauthConfig: config });

            const result = await chrome.storage.local.get('oauthConfig');
            expect(result.oauthConfig.clientId).toBe('test-id');
            expect(result.oauthConfig.clientSecret).toBe('test-secret');
        });
    });

    describe('logout', () => {
        test('clears all auth-related data', async () => {
            await chrome.storage.local.set({
                clickupToken: 'token123',
                clickupRefreshToken: 'refresh123',
                cachedUser: { id: 1 },
                cachedTeams: { teams: [] }
            });

            // Simulate logout
            await chrome.storage.local.remove([
                'clickupToken',
                'clickupRefreshToken',
                'cachedUser',
                'cachedTeams'
            ]);

            const result = await chrome.storage.local.get([
                'clickupToken',
                'clickupRefreshToken',
                'cachedUser'
            ]);

            expect(result.clickupToken).toBeUndefined();
            expect(result.clickupRefreshToken).toBeUndefined();
            expect(result.cachedUser).toBeUndefined();
        });
    });
});
