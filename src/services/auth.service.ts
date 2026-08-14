/**
 * Authentication Service
 * Handles OAuth flow, token management, and session state
 */

import { saveSecureToken, getSecureToken, hasSecureToken, saveSecureOAuthConfig, hasSecureOAuthConfig, getSecureOAuthConfig, removeSecureToken } from './crypto.service';
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
    requiresReauth: boolean;
    user: ClickUpUserResponse | null;
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
    DRAFT_CLIENT_ID: 'draftClientId',
    DRAFT_CLIENT_SECRET: 'draftClientSecret',
    REAUTH_REQUIRED: 'clickupReauthRequired',
};

const API_URLS = {
    TOKEN: 'https://api.clickup.com/api/v2/oauth/token',
    AUTH: 'https://app.clickup.com/api',
};

// ============================================================================
// Auth Service Class
// ============================================================================

class AuthService {
    /**
     * Get current extension status
     */
    async getStatus(): Promise<ExtensionStatus> {
        const data = await chrome.storage.local.get([STORAGE_KEYS.USER, STORAGE_KEYS.REAUTH_REQUIRED]);

        const hasToken = await hasSecureToken(STORAGE_KEYS.TOKEN);
        const configured = await hasSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG);
        const requiresReauth = data[STORAGE_KEYS.REAUTH_REQUIRED] === true;

        return {
            authenticated: hasToken && !requiresReauth,
            configured,
            requiresReauth,
            user: requiresReauth ? null : data[STORAGE_KEYS.USER] || null,
        };
    }

    /**
     * Save OAuth configuration (SEC-C1: encrypted client secret)
     * @security Client secret is now encrypted at rest
     */
    async saveOAuthConfig(config: OAuthConfig): Promise<{ success: boolean }> {
        await saveSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG, config);
        await chrome.storage.local.remove([STORAGE_KEYS.DRAFT_CLIENT_ID, STORAGE_KEYS.DRAFT_CLIENT_SECRET]);
        if (!await hasSecureOAuthConfig(STORAGE_KEYS.OAUTH_CONFIG)) {
            throw new Error('OAuth configuration was not stored securely');
        }
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
            console.log('[Auth] TOKEN_RESPONSE_RECEIVED');

            if (tokenData.access_token) {
                // Save tokens encrypted
                await saveSecureToken(STORAGE_KEYS.TOKEN, tokenData.access_token);
                await removeSecureToken(STORAGE_KEYS.REFRESH_TOKEN);
                await chrome.storage.local.remove(STORAGE_KEYS.REAUTH_REQUIRED);

                return {
                    success: true,
                    token: tokenData.access_token
                };
            }

            throw new Error(tokenData.error || 'Failed to get token');

        } catch (error) {
            console.error('[Auth] OAUTH_ERROR');
            throw error;
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
        const state = await chrome.storage.local.get(STORAGE_KEYS.REAUTH_REQUIRED);
        return state[STORAGE_KEYS.REAUTH_REQUIRED] !== true && await hasSecureToken(STORAGE_KEYS.TOKEN);
    }

    /**
     * Logout - clear all auth data
     */
    async logout(): Promise<{ success: boolean }> {
        await removeSecureToken(STORAGE_KEYS.TOKEN);
        await removeSecureToken(STORAGE_KEYS.REFRESH_TOKEN);
        await chrome.storage.local.remove([
            STORAGE_KEYS.OAUTH_CONFIG,
            STORAGE_KEYS.DRAFT_CLIENT_ID,
            STORAGE_KEYS.DRAFT_CLIENT_SECRET,
            STORAGE_KEYS.USER,
            STORAGE_KEYS.TEAMS,
            STORAGE_KEYS.REAUTH_REQUIRED,
        ]);

        console.log('[Auth] LOGGED_OUT');
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
