/**
 * Crypto Service - Secure token encryption/decryption
 * Uses Web Crypto API with AES-256-GCM for encryption
 * 
 * @security This provides at-rest encryption for sensitive tokens
 */

// Storage key for the encryption key
const ENCRYPTION_KEY_STORAGE = 'encryptionKey';

interface EncryptedData {
    iv: string;      // Base64 encoded IV
    data: string;    // Base64 encoded encrypted data
    version: number; // Schema version for future migrations
}

/**
 * Generates a cryptographic key for encryption
 * Key is derived from extension ID + random salt for uniqueness
 */
async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
    const stored = await chrome.storage.local.get(ENCRYPTION_KEY_STORAGE);

    if (stored[ENCRYPTION_KEY_STORAGE]) {
        // Import existing key
        const keyData = Uint8Array.from(atob(stored[ENCRYPTION_KEY_STORAGE]), c => c.charCodeAt(0));
        return await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    // Generate new key
    const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, // extractable for storage
        ['encrypt', 'decrypt']
    );

    // Store the key
    const exportedKey = await crypto.subtle.exportKey('raw', key);
    const keyString = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
    await chrome.storage.local.set({ [ENCRYPTION_KEY_STORAGE]: keyString });

    // Re-import as non-extractable for security
    return await crypto.subtle.importKey(
        'raw',
        exportedKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypts a token string
 * @param token - The plain text token to encrypt
 * @returns Encrypted data object with IV and ciphertext
 */
export async function encryptToken(token: string): Promise<EncryptedData> {
    const key = await getOrCreateEncryptionKey();

    // Generate random IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encode token to bytes
    const encoder = new TextEncoder();
    const tokenBytes = encoder.encode(token);

    // Encrypt
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        tokenBytes
    );

    return {
        iv: btoa(String.fromCharCode(...iv)),
        data: btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer))),
        version: 1
    };
}

/**
 * Decrypts an encrypted token
 * @param encryptedData - The encrypted data object
 * @returns The original plain text token
 */
export async function decryptToken(encryptedData: EncryptedData): Promise<string> {
    const key = await getOrCreateEncryptionKey();

    // Decode IV and data from base64
    const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(encryptedData.data), c => c.charCodeAt(0));

    // Decrypt
    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
    );

    // Decode to string
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
}

/**
 * Saves a token securely to chrome.storage.local
 * Encrypts the token before storing
 * 
 * @param storageKey - The storage key to use
 * @param token - The plain text token
 */
export async function saveSecureToken(storageKey: string, token: string): Promise<void> {
    if (!token) return;

    const encrypted = await encryptToken(token);
    await chrome.storage.local.set({ [storageKey]: encrypted });
}

/**
 * Retrieves and decrypts a token from chrome.storage.local
 * Handles both encrypted (new) and plain text (legacy) tokens
 * 
 * @param storageKey - The storage key to retrieve
 * @returns The decrypted token or null if not found
 */
export async function getSecureToken(storageKey: string): Promise<string | null> {
    const stored = await chrome.storage.local.get(storageKey);
    const value = stored[storageKey];

    if (!value) return null;

    // Check if it's encrypted (new format) or plain text (legacy)
    if (typeof value === 'object' && value.iv && value.data && value.version) {
        try {
            return await decryptToken(value as EncryptedData);
        } catch (error) {
            console.error('[Crypto] Decryption failed:', error);
            return null;
        }
    }

    // Legacy plain text token - migrate to encrypted
    if (typeof value === 'string') {
        console.log('[Crypto] Migrating legacy token to encrypted format');
        await saveSecureToken(storageKey, value);
        return value;
    }

    return null;
}

/**
 * Removes a secure token from storage
 * @param storageKey - The storage key to remove
 */
export async function removeSecureToken(storageKey: string): Promise<void> {
    await chrome.storage.local.remove(storageKey);
}

/**
 * Checks if a token exists in storage (without decrypting)
 * @param storageKey - The storage key to check
 */
export async function hasSecureToken(storageKey: string): Promise<boolean> {
    const stored = await chrome.storage.local.get(storageKey);
    return !!stored[storageKey];
}

// ============================================================================
// OAuth Config Encryption (SEC-C1 Fix)
// ============================================================================

interface OAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUrl?: string;
}

interface EncryptedOAuthConfig {
    clientId: string;           // Not encrypted (needed for auth URL)
    encryptedSecret: EncryptedData;  // Encrypted client secret
    redirectUrl?: string;
    version: number;
}

/**
 * Saves OAuth config with encrypted client secret
 * @security Encrypts the client secret while leaving clientId accessible
 */
export async function saveSecureOAuthConfig(storageKey: string, config: OAuthConfig): Promise<void> {
    if (!config || !config.clientSecret) return;

    const encryptedSecret = await encryptToken(config.clientSecret);

    const secureConfig: EncryptedOAuthConfig = {
        clientId: config.clientId,
        encryptedSecret,
        redirectUrl: config.redirectUrl,
        version: 1
    };

    await chrome.storage.local.set({ [storageKey]: secureConfig });
    console.log('[Crypto] OAuth config saved with encrypted secret');
}

/**
 * Retrieves OAuth config and decrypts the client secret
 * Handles both encrypted (new) and plain text (legacy) formats
 */
export async function getSecureOAuthConfig(storageKey: string): Promise<OAuthConfig | null> {
    const stored = await chrome.storage.local.get(storageKey);
    const value = stored[storageKey];

    if (!value) return null;

    // Check if it's the new encrypted format
    if (value.encryptedSecret && value.encryptedSecret.iv && value.encryptedSecret.data) {
        try {
            const decryptedSecret = await decryptToken(value.encryptedSecret);
            return {
                clientId: value.clientId,
                clientSecret: decryptedSecret,
                redirectUrl: value.redirectUrl
            };
        } catch (error) {
            console.error('[Crypto] Failed to decrypt OAuth config:', error);
            return null;
        }
    }

    // Legacy plain text format - migrate to encrypted
    if (value.clientId && value.clientSecret && typeof value.clientSecret === 'string') {
        console.log('[Crypto] Migrating legacy OAuth config to encrypted format');
        await saveSecureOAuthConfig(storageKey, value);
        return value as OAuthConfig;
    }

    return null;
}
