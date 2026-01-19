/**
 * Authentication Service
 * Handles OAuth flow, token management, and session state
 */

import { saveSecureToken, getSecureToken, hasSecureToken, saveSecureOAuthConfig, getSecureOAuthConfig } from './crypto.service';
import type { ClickUpUserResponse } from '../types/clickup';

// ============================================================================
// Types
// ============================================================================

export interface OAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUrl?: string;
}

export interface ExtensionStatus {
    authenticated: boolean;
    configured: boolean;
    user: ClickUpUserResponse | null;
}

export interface TestResult {
    success: boolean;
    message?: string;
    error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEYS = {
    TOKEN: 'clickupToken',
    REFRESH_TOKEN: 'clickupRefreshToken',
    OAUTH_CONFIG: 'oauthConfig',
    USER: 'cachedUser',
    TEAMS: 'cachedTeams',
};

const API_URLS = {
    TOKEN: 'https://api.clickup.com/api/v2/oauth/token',
    AUTH: 'https://app.clickup.com/api',
};

// ============================================================================
// Auth Service Class
// ============================================================================

class AuthService {
    private onTokenRefreshed: ((token: string) => void) | null = null;

    /**
     * Set callback for when token is refreshed
     */
    setOnTokenRefreshed(callback: (token: string) => void): void {
        this.onTokenRefreshed = callback;
    }

    /**
     * Get current extension status
     */
    async getStatus(): Promise<ExtensionStatus> {
        const data = await chrome.storage.local.get([
            STORAGE_KEYS.OAUTH_CONFIG,
            STORAGE_KEYS.USER
        ]);

        const hasToken = await hasSecureToken(STORAGE_KEYS.TOKEN);

        return {
            authenticated: hasToken,
            configured: !!(data[STORAGE_KEYS.OAUTH_CONFIG]?.clientId),
            user: data[STORAGE_KEYS.USER] || null
        };
    }

    /**
     * Save OAuth configuration (SEC-C1: encrypted client secret)
     * @security Client secret is now encrypted at rest
     */
    async saveOAuthConfig(config: OAuthConfig): Promise<{ success: boolean }> {
        await saveSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG, config);
        return { success: true };
    }

    /**
     * Get saved OAuth configuration (decrypts client secret)
     * @security Handles legacy plain-text migration automatically
     */
    async getOAuthConfig(): Promise<OAuthConfig | null> {
        return await getSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG);
    }

    /**
     * Start OAuth flow using chrome.identity
     */
    async startOAuthFlow(): Promise<{ success: boolean; token: string; user?: ClickUpUserResponse }> {
        const oauthConfig = await this.getOAuthConfig();

        if (!oauthConfig?.clientId || !oauthConfig?.clientSecret) {
            throw new Error('OAuth not configured');
        }

        const redirectUrl = chrome.identity.getRedirectURL();
        const authUrl = `${API_URLS.AUTH}?client_id=${oauthConfig.clientId}&redirect_uri=${encodeURIComponent(redirectUrl)}`;

        try {
            const responseUrl = await chrome.identity.launchWebAuthFlow({
                url: authUrl,
                interactive: true
            });

            if (!responseUrl) {
                throw new Error('No response URL from OAuth flow');
            }

            const url = new URL(responseUrl);
            const code = url.searchParams.get('code');

            if (!code) {
                throw new Error('No authorization code received');
            }

            // Exchange code for token
            const tokenResponse = await fetch(API_URLS.TOKEN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: oauthConfig.clientId,
                    client_secret: oauthConfig.clientSecret,
                    code: code
                })
            });

            const tokenData = await tokenResponse.json();
            console.log('[Auth] OAuth token response received');

            if (tokenData.access_token) {
                // Save tokens encrypted
                await saveSecureToken(STORAGE_KEYS.TOKEN, tokenData.access_token);
                if (tokenData.refresh_token) {
                    await saveSecureToken(STORAGE_KEYS.REFRESH_TOKEN, tokenData.refresh_token);
                }

                return {
                    success: true,
                    token: tokenData.access_token
                };
            }

            throw new Error(tokenData.error || 'Failed to get token');

        } catch (error) {
            console.error('[Auth] OAuth error:', error);
            throw error;
        }
    }

    /**
     * Refresh the access token using refresh token
     */
    async refreshToken(): Promise<{ success: boolean; token?: string }> {
        console.log('[Auth] Attempting token refresh...');

        const oauthConfig = await this.getOAuthConfig();
        const refreshTokenValue = await getSecureToken(STORAGE_KEYS.REFRESH_TOKEN);

        if (!refreshTokenValue || !oauthConfig?.clientId) {
            console.log('[Auth] No refresh token available');
            return { success: false };
        }

        try {
            const response = await fetch(API_URLS.TOKEN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: oauthConfig.clientId,
                    client_secret: oauthConfig.clientSecret,
                    refresh_token: refreshTokenValue,
                    grant_type: 'refresh_token'
                })
            });

            const tokenData = await response.json();

            if (tokenData.access_token) {
                await saveSecureToken(STORAGE_KEYS.TOKEN, tokenData.access_token);
                await saveSecureToken(STORAGE_KEYS.REFRESH_TOKEN, tokenData.refresh_token || refreshTokenValue);

                console.log('[Auth] Token refreshed successfully');

                // Notify callback if set
                if (this.onTokenRefreshed) {
                    this.onTokenRefreshed(tokenData.access_token);
                }

                return { success: true, token: tokenData.access_token };
            }

            console.error('[Auth] Token refresh failed:', tokenData.error);
            return { success: false };

        } catch (error) {
            console.error('[Auth] Token refresh error:', error);
            return { success: false };
        }
    }

    /**
     * Get the current access token (decrypted)
     */
    async getAccessToken(): Promise<string | null> {
        return await getSecureToken(STORAGE_KEYS.TOKEN);
    }

    /**
     * Check if user is authenticated
     */
    async isAuthenticated(): Promise<boolean> {
        return await hasSecureToken(STORAGE_KEYS.TOKEN);
    }

    /**
     * Logout - clear all auth data
     */
    async logout(): Promise<{ success: boolean }> {
        await chrome.storage.local.remove([
            STORAGE_KEYS.TOKEN,
            STORAGE_KEYS.REFRESH_TOKEN,
            STORAGE_KEYS.USER,
            STORAGE_KEYS.TEAMS
        ]);

        console.log('[Auth] Logged out');
        return { success: true };
    }

    /**
     * Save user data after successful auth
     */
    async saveUser(user: ClickUpUserResponse): Promise<void> {
        await chrome.storage.local.set({ [STORAGE_KEYS.USER]: user });
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const authService = new AuthService();
