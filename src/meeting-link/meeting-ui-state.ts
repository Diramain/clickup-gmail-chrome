import { sanitizeMeetingFeatureFlags } from './meeting-link.types';

export type MeetingUiStatus = 'disabled' | 'ready_preview' | 'creating_calendar' | 'creating_clickup' | 'publishing_invites' | 'linked' | 'linked_warning' | 'repair_required' | 'unknown_result';

export function deriveMeetingUiState(input: { flags: unknown; operationState?: string; warnings?: readonly unknown[] }): { status: MeetingUiStatus; canCreate: boolean; integrationBlocked: boolean } {
    const flags = sanitizeMeetingFeatureFlags(input.flags);
    if (!flags.calendarIntegrationEnabled || !flags.calendarWriteEnabled) return { status: 'disabled', canCreate: false, integrationBlocked: true };
    switch (input.operationState) {
        case 'preflight_ok': return { status: 'ready_preview', canCreate: true, integrationBlocked: false };
        case 'calendar_create_pending':
        case 'calendar_private_created':
        case 'conference_pending': return { status: 'creating_calendar', canCreate: false, integrationBlocked: false };
        case 'clickup_create_pending': return { status: 'creating_clickup', canCreate: false, integrationBlocked: false };
        case 'clickup_create_unknown': return { status: 'unknown_result', canCreate: false, integrationBlocked: false };
        case 'calendar_publish_pending': return { status: 'publishing_invites', canCreate: false, integrationBlocked: false };
        case 'linked': return { status: 'linked', canCreate: false, integrationBlocked: false };
        case 'linked_degraded': return { status: 'linked_warning', canCreate: false, integrationBlocked: false };
        case 'repair_required': return { status: 'repair_required', canCreate: false, integrationBlocked: false };
        default: return { status: 'disabled', canCreate: false, integrationBlocked: true };
    }
}
