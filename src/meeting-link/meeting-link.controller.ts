import { sanitizeMeetingFeatureFlags } from './meeting-link.types';

export const MEETING_FEATURE_FLAGS_KEY = 'meetingFeatureFlagsV1';
export const MEETING_RUNTIME_CAPABILITY_ENABLED = false;

export type MeetingLinkWriteAction =
    | 'previewMeetingLink'
    | 'beginMeetingLinkCreate'
    | 'resumeMeetingOperation'
    | 'repairMeetingOperation';

export interface MeetingLinkStorageReader {
    get(key: typeof MEETING_FEATURE_FLAGS_KEY): Promise<Record<typeof MEETING_FEATURE_FLAGS_KEY, unknown>>;
}

export interface MeetingLinkUiStateDto {
    ok: true;
    status: 'disabled';
    canCreate: false;
    integrationBlocked: true;
    runtimeCapabilityEnabled: false;
}

export interface MeetingLinkDisabledDto {
    ok: false;
    code: 'FEATURE_DISABLED';
    runtimeCapabilityEnabled: false;
}

export class MeetingLinkController {
    constructor(private readonly storage: MeetingLinkStorageReader) { }

    async getUiState(): Promise<MeetingLinkUiStateDto> {
        try {
            await this.readFlags();
        } catch {
            // A3 fail-closed: storage failures must not surface or enable UI/runtime.
        }
        return createDisabledUiStateDto();
    }

    async handleWriteAction(_action: MeetingLinkWriteAction): Promise<MeetingLinkDisabledDto> {
        return createFeatureDisabledDto();
    }

    private async readFlags(): Promise<void> {
        const result = await this.storage.get(MEETING_FEATURE_FLAGS_KEY);
        sanitizeMeetingFeatureFlags(result[MEETING_FEATURE_FLAGS_KEY]);
    }
}

function createDisabledUiStateDto(): MeetingLinkUiStateDto {
    return {
        ok: true,
        status: 'disabled',
        canCreate: false,
        integrationBlocked: true,
        runtimeCapabilityEnabled: MEETING_RUNTIME_CAPABILITY_ENABLED,
    };
}

function createFeatureDisabledDto(): MeetingLinkDisabledDto {
    return {
        ok: false,
        code: 'FEATURE_DISABLED',
        runtimeCapabilityEnabled: MEETING_RUNTIME_CAPABILITY_ENABLED,
    };
}
