export interface AvailabilityRequestBatch {
    calendars: string[];
    partial: boolean;
}

export function createAvailabilityBatches(calendarIds: readonly string[], maxBatchSize = 50): AvailabilityRequestBatch[] {
    const clean = calendarIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256);
    const batches: AvailabilityRequestBatch[] = [];
    for (let index = 0; index < clean.length; index += maxBatchSize) {
        batches.push({ calendars: clean.slice(index, index + maxBatchSize), partial: clean.length > maxBatchSize });
    }
    return batches;
}

export function summarizeAvailabilityPartial(input: { requested: number; answered: number; errored: number }): { partial: boolean; requested: number; answered: number; errored: number } {
    return {
        partial: input.answered + input.errored < input.requested || input.errored > 0,
        requested: Math.max(0, Math.floor(input.requested)),
        answered: Math.max(0, Math.floor(input.answered)),
        errored: Math.max(0, Math.floor(input.errored)),
    };
}
