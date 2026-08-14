export type MeetDetectorPhase = 'outside' | 'candidate' | 'joined';

export interface MeetDetectorState {
    phase: MeetDetectorPhase;
    roomKey: string | null;
    missingSignalSince: number | null;
    lastHeartbeatAt: number | null;
}

export interface MeetDetectorInput {
    roomKey: string | null;
    confirmedSignal: boolean;
    visible: boolean;
    now: number;
}

export interface MeetDetectorEvent {
    event: 'candidate' | 'joined' | 'left' | 'heartbeat';
    roomKey: string;
}

export interface MeetDetectorResult {
    state: MeetDetectorState;
    events: MeetDetectorEvent[];
}

export const INITIAL_MEET_DETECTOR_STATE: MeetDetectorState = {
    phase: 'outside',
    roomKey: null,
    missingSignalSince: null,
    lastHeartbeatAt: null,
};

export function advanceMeetDetector(
    previous: MeetDetectorState,
    input: MeetDetectorInput,
    leftDebounceMs = 4_000,
    heartbeatMs = 15_000,
): MeetDetectorResult {
    const events: MeetDetectorEvent[] = [];

    if (!input.roomKey) {
        if (previous.phase === 'joined' && previous.roomKey) {
            events.push({ event: 'left', roomKey: previous.roomKey });
        }
        return { state: { ...INITIAL_MEET_DETECTOR_STATE }, events };
    }

    if (previous.roomKey !== input.roomKey) {
        if (previous.phase === 'joined' && previous.roomKey) {
            events.push({ event: 'left', roomKey: previous.roomKey });
        }
        events.push({ event: 'candidate', roomKey: input.roomKey });
        if (input.confirmedSignal && input.visible) {
            events.push({ event: 'joined', roomKey: input.roomKey });
            return {
                state: {
                    phase: 'joined',
                    roomKey: input.roomKey,
                    missingSignalSince: null,
                    lastHeartbeatAt: input.now,
                },
                events,
            };
        }
        return {
            state: {
                phase: 'candidate',
                roomKey: input.roomKey,
                missingSignalSince: null,
                lastHeartbeatAt: null,
            },
            events,
        };
    }

    if (previous.phase !== 'joined') {
        if (input.confirmedSignal && input.visible) {
            events.push({ event: 'joined', roomKey: input.roomKey });
            return {
                state: {
                    phase: 'joined',
                    roomKey: input.roomKey,
                    missingSignalSince: null,
                    lastHeartbeatAt: input.now,
                },
                events,
            };
        }
        return { state: previous, events };
    }

    if (input.confirmedSignal) {
        const heartbeatDue = previous.lastHeartbeatAt === null
            || input.now - previous.lastHeartbeatAt >= heartbeatMs;
        if (heartbeatDue) events.push({ event: 'heartbeat', roomKey: input.roomKey });
        return {
            state: {
                ...previous,
                missingSignalSince: null,
                lastHeartbeatAt: heartbeatDue ? input.now : previous.lastHeartbeatAt,
            },
            events,
        };
    }

    const missingSignalSince = previous.missingSignalSince ?? input.now;
    if (input.now - missingSignalSince < leftDebounceMs) {
        return { state: { ...previous, missingSignalSince }, events };
    }

    events.push({ event: 'left', roomKey: input.roomKey });
    return {
        state: {
            phase: 'candidate',
            roomKey: input.roomKey,
            missingSignalSince: null,
            lastHeartbeatAt: null,
        },
        events,
    };
}
