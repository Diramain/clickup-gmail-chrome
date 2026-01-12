/**
 * Jest Setup File
 * Mocks Chrome Extension APIs for testing
 */

// Mock Chrome Storage API
const mockStorage = {
    data: {},

    async get(keys) {
        if (typeof keys === 'string') {
            return { [keys]: this.data[keys] };
        }
        if (Array.isArray(keys)) {
            const result = {};
            keys.forEach(key => {
                if (this.data[key] !== undefined) {
                    result[key] = this.data[key];
                }
            });
            return result;
        }
        return this.data;
    },

    async set(items) {
        Object.assign(this.data, items);
    },

    async remove(keys) {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => delete this.data[key]);
    },

    clear() {
        this.data = {};
    }
};

// Mock Chrome Runtime API
const mockRuntime = {
    listeners: {},

    onMessage: {
        addListener: jest.fn((callback) => {
            mockRuntime.listeners['onMessage'] = callback;
        })
    },

    onInstalled: {
        addListener: jest.fn()
    },

    sendMessage: jest.fn(),

    getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`),

    lastError: null
};

// Mock Chrome Identity API
const mockIdentity = {
    getRedirectURL: jest.fn(() => 'https://mock-redirect-url.chromiumapp.org/'),
    launchWebAuthFlow: jest.fn()
};

// Mock Chrome Tabs API
const mockTabs = {
    query: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn()
};

// Global Chrome object
global.chrome = {
    storage: {
        local: mockStorage
    },
    runtime: mockRuntime,
    identity: mockIdentity,
    tabs: mockTabs
};

// Global fetch mock
global.fetch = jest.fn();

// Helper to reset all mocks between tests
beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    global.fetch.mockReset();
});

// Export for use in tests
module.exports = {
    mockStorage,
    mockRuntime,
    mockIdentity,
    mockTabs
};
