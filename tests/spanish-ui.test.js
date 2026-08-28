const fs = require('fs');
const path = require('path');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function activeText(relativePath) {
    return source(relativePath)
        .replace(/<!--([\s\S]*?)-->/g, '')
        .replace(/\/\*([\s\S]*?)\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

describe('Spanish runtime UI copy', () => {
    const activeFiles = [
        'popup/popup.html',
        'popup/popup.ts',
        'task-modal.html',
        'src/modal.ts',
        'src/gmail-native.ts',
        'src/utils/sanitize.utils.ts',
        'src/data-management.ts',
        'src/services/api.service.ts',
        'background.ts',
        'manifest.json',
    ];

    const blockedPhrases = [
        'Loading...',
        'Error loading extension',
        'OAuth Configuration',
        'Copy this',
        'Click the',
        'Enter your credentials',
        'Save Configuration',
        'Configuration Saved',
        'Sign in with ClickUp',
        'Signing in...',
        'Open in separate window',
        'Tasks</span>',
        'Tracking</span>',
        'Search Task',
        'Quick Create',
        'Full Form',
        'Task name...',
        'Description (optional)',
        'Cancel</button>',
        'Create Task',
        'No timer running',
        'Auto Tracking',
        'Start Timer',
        'Manual Entry',
        'Recent Entries',
        'Preferred Workspace',
        'Custom Field',
        'List Cache',
        'Sync Lists',
        'Email Tasks',
        'Last 30 days',
        'Send Feedback',
        'View on GitHub',
        'Data Management',
        'Export Data',
        'Clear Data',
        'Sign Out',
        'Pending Gmail metadata',
        'Add to ClickUp',
        'Create ClickUp task from this email',
        'Sanitized email copy',
        'Remote content and active elements were removed',
        'Task Created!',
        'View Task in ClickUp',
        'Closing in',
        'No tasks found',
        'Search failed',
        'Extension reloaded. Please refresh Gmail.',
        'HTML attachment could not be uploaded',
        'email comment could not be added',
        'Type CLEAR DATA',
    ];

    test('active sources do not contain known English UI phrases', () => {
        const combined = activeFiles.map(file => `\n--- ${file} ---\n${activeText(file)}`).join('\n');
        const residual = blockedPhrases.filter(phrase => combined.includes(phrase));
        expect(residual).toEqual([]);
    });

    test('technical/canonical markers and internal contracts are preserved', () => {
        expect(source('src/link-hardening.ts')).toContain('Gmail Thread ID');
        expect(source('src/link-hardening.ts')).toContain('Thread ID:');
        expect(source('background.ts')).toContain('Thread ID:');
        expect(source('src/message-security.ts')).toContain("'openTaskModal'");
        expect(source('src/message-security.ts')).toContain("'searchTasks'");
        expect(source('src/data-management.ts')).toContain("'CLEAR DATA'");
        expect(source('src/data-management.ts')).toContain("'BORRAR DATOS'");
        expect(source('popup/popup.html')).toContain('Token personal de ClickUp');
        expect(source('popup/popup.html')).not.toMatch(/Client ID|Client Secret|Redirect URL/);
    });
});
