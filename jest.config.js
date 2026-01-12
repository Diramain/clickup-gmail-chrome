module.exports = {
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.js'],
    moduleFileExtensions: ['js'],

    // Setup files to run before tests
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

    // Coverage configuration
    collectCoverageFrom: [
        'background.js',
        'src/**/*.js',
        '!src/modal.js', // Complex UI, needs integration tests
        '!**/node_modules/**'
    ],

    // Transform ES modules if needed
    transform: {},

    // Mock chrome API globally
    globals: {
        chrome: {}
    }
};
