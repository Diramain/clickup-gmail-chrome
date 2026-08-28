import type { ClickUpTokenOnlyMigration } from './clickup-auth';

export interface ClickUpTokenOnlyMigrationOperations {
    markReauthRequired(): Promise<void>;
    removeLegacyAuthState(): Promise<void>;
    preservePersonalToken(token: string): Promise<void>;
    retireCredential(): Promise<void>;
    clearAccountBoundary(): Promise<void>;
}

export async function applyClickUpTokenOnlyMigration(
    migration: ClickUpTokenOnlyMigration,
    operations: ClickUpTokenOnlyMigrationOperations,
): Promise<void> {
    if (migration.requiresReauth) {
        // Persist the fail-closed marker before deleting any credential state.
        await operations.markReauthRequired();
        await operations.removeLegacyAuthState();
        await operations.retireCredential();
        await operations.clearAccountBoundary();
        return;
    }

    await operations.removeLegacyAuthState();
    if (migration.personalToken) {
        await operations.preservePersonalToken(migration.personalToken);
    }
}
