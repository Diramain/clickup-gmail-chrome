import { MeetingLinkHealth, MeetingOperationV1 } from './meeting-link.types';

export type RecoveryStatus = MeetingLinkHealth;

export interface RecoveryCandidate {
    hasCalendar: boolean;
    hasClickUp: boolean;
    duplicateCount?: number;
    legacyOnly?: boolean;
    disabled?: boolean;
}

export function classifyRecoveryCandidate(candidate: RecoveryCandidate): RecoveryStatus {
    if (candidate.disabled) return 'disabled';
    if (candidate.duplicateCount && candidate.duplicateCount > 1) return 'duplicate_conflict';
    if (candidate.legacyOnly) return 'legacy_only';
    if (candidate.hasCalendar && candidate.hasClickUp) return 'healthy';
    if (candidate.hasCalendar) return 'calendar_only';
    if (candidate.hasClickUp) return 'clickup_only';
    return 'orphaned';
}

export function planReadOnlyRecovery(operations: readonly MeetingOperationV1[]): { state: string; unresolved: number; repairPerformed: false } {
    const unresolved = operations.filter((operation) => !['linked', 'linked_degraded', 'abandoned'].includes(operation.state)).length;
    return { state: unresolved > 0 ? 'repair_required' : 'healthy', unresolved, repairPerformed: false };
}
