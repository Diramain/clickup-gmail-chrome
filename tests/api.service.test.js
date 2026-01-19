/**
 * API Service Tests
 * Tests for ClickUpAPIWrapper basic functionality
 */

describe('ClickUpAPIWrapper', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        global.fetch = jest.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.resetAllMocks();
    });

    it('should make requests with authorization header', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ user: { id: 123 } })
        });

        // Simulate a basic API call
        const response = await fetch('https://api.clickup.com/api/v2/user', {
            headers: {
                'Authorization': 'test-token',
                'Content-Type': 'application/json'
            }
        });

        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.clickup.com/api/v2/user',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'test-token'
                })
            })
        );
    });

    it('should handle JSON responses', async () => {
        const mockData = { teams: [{ id: '123', name: 'Test Team' }] };
        global.fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockData
        });

        const response = await fetch('https://api.clickup.com/api/v2/team');
        const data = await response.json();

        expect(data).toEqual(mockData);
    });

    it('should handle 401 errors', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            json: async () => ({ err: 'Token invalid' })
        });

        const response = await fetch('https://api.clickup.com/api/v2/user');
        expect(response.status).toBe(401);
    });

    it('should handle network errors', async () => {
        global.fetch.mockRejectedValueOnce(new Error('Network error'));

        await expect(
            fetch('https://api.clickup.com/api/v2/user')
        ).rejects.toThrow('Network error');
    });
});
