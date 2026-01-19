
import { ClickUpAPIWrapper } from './api.service';

describe('ClickUpAPIWrapper', () => {
    let api: ClickUpAPIWrapper;
    const token = 'test-token';

    beforeEach(() => {
        api = new ClickUpAPIWrapper(token);
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    it('should be defined', () => {
        expect(api).toBeDefined();
    });

    it('should include authorization header in requests', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({})
        });

        await api.request('/test');

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/test'),
            expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': token,
                    'Content-Type': 'application/json'
                })
            })
        );
    });
});
