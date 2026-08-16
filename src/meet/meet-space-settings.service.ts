import type { MeetSettingsPort } from '../calendar/calendar-ports';

export type MeetSettingsCapability = 'disabled' | 'available' | 'unsupported' | 'license_denied' | 'permission_denied';

export class MockMeetSpaceSettingsService implements MeetSettingsPort {
    constructor(private readonly capability: MeetSettingsCapability = 'disabled') {}

    async applyAutoArtifacts(_spaceName: string): Promise<{ ok: true } | { ok: false; reason: 'unsupported' | 'license_denied' | 'permission_denied' }> {
        if (this.capability === 'available') return { ok: true };
        if (this.capability === 'license_denied') return { ok: false, reason: 'license_denied' };
        if (this.capability === 'permission_denied') return { ok: false, reason: 'permission_denied' };
        return { ok: false, reason: 'unsupported' };
    }
}
