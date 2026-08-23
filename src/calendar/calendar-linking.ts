import type { ClickUpCustomTaskType } from '../types/clickup';

export type CalendarTaskLinkScope = 'occurrence' | 'series';

export interface CalendarTaskReferenceV1 {
    id: string;
    name: string;
}

export interface CalendarTaskMappingV1 {
    key: string;
    scope: CalendarTaskLinkScope;
    task: CalendarTaskReferenceV1;
    createdAt: number;
    updatedAt: number;
}

export interface CalendarTaskMappingStoreV1 {
    schemaVersion: 1;
    mappings: Record<string, CalendarTaskMappingV1>;
}

export interface CalendarTaskTypeSelectionV1 {
    customItemId: number;
    name: string;
    updatedAt: number;
}

export const CALENDAR_TASK_MAPPING_SCHEMA_VERSION = 1;

export function mappingStorageKey(scope: CalendarTaskLinkScope, key: string): string | null {
    if ((scope !== 'occurrence' && scope !== 'series') || !isHexKey(key)) return null;
    return `${scope}:${key}`;
}

export function sanitizeCalendarTaskMappings(value: unknown): CalendarTaskMappingStoreV1 {
    const output: CalendarTaskMappingStoreV1 = { schemaVersion: CALENDAR_TASK_MAPPING_SCHEMA_VERSION, mappings: {} };
    if (!isRecord(value) || !isRecord(value.mappings)) return output;
    for (const [key, raw] of Object.entries(value.mappings).slice(0, 500)) {
        const mapping = sanitizeCalendarTaskMapping(raw);
        if (mapping && key === mappingStorageKey(mapping.scope, mapping.key)) output.mappings[key] = mapping;
    }
    return output;
}

export function sanitizeCalendarTaskMapping(value: unknown): CalendarTaskMappingV1 | null {
    if (!isRecord(value)) return null;
    const scope = value.scope === 'series' ? 'series' : value.scope === 'occurrence' ? 'occurrence' : null;
    if (!scope || !isHexKey(value.key)) return null;
    const task = sanitizeCalendarTaskReference(value.task);
    if (!task) return null;
    const createdAt = boundedTimestamp(value.createdAt);
    const updatedAt = boundedTimestamp(value.updatedAt);
    return { key: value.key, scope, task, createdAt, updatedAt };
}

export function sanitizeCalendarTaskReference(value: unknown): CalendarTaskReferenceV1 | null {
    if (!isRecord(value)) return null;
    const id = boundedText(value.id, 100);
    const name = boundedText(value.name, 500);
    return id && name ? { id, name } : null;
}

export function selectCalendarLinkedTask(
    store: CalendarTaskMappingStoreV1,
    occurrenceKey: string,
    seriesKey?: string,
): CalendarTaskReferenceV1 | undefined {
    const occurrenceStoreKey = mappingStorageKey('occurrence', occurrenceKey);
    const occurrence = occurrenceStoreKey ? store.mappings[occurrenceStoreKey] : undefined;
    if (occurrence?.task) return { ...occurrence.task };
    const seriesStoreKey = seriesKey ? mappingStorageKey('series', seriesKey) : null;
    const series = seriesStoreKey ? store.mappings[seriesStoreKey] : undefined;
    return series?.task ? { ...series.task } : undefined;
}

export function sanitizeCustomTaskTypesResponse(value: unknown): ClickUpCustomTaskType[] {
    if (!isRecord(value) || !Array.isArray(value.custom_items)) return [];
    const seen = new Set<number>();
    const output: ClickUpCustomTaskType[] = [];
    for (const raw of value.custom_items.slice(0, 200)) {
        if (!isRecord(raw) || !Number.isInteger(raw.id) || raw.id <= 0 || seen.has(raw.id)) continue;
        const name = boundedText(raw.name, 160);
        if (!name) continue;
        seen.add(raw.id);
        output.push({ id: raw.id, name, ...(boundedText(raw.name_plural, 160) ? { name_plural: boundedText(raw.name_plural, 160) } : {}) });
    }
    return output;
}

export function sanitizeCalendarTaskTypeSelection(value: unknown): CalendarTaskTypeSelectionV1 | null {
    if (!isRecord(value) || !Number.isInteger(value.customItemId) || value.customItemId <= 0) return null;
    const name = boundedText(value.name, 160);
    const updatedAt = boundedTimestamp(value.updatedAt);
    return name ? { customItemId: value.customItemId, name, updatedAt } : null;
}

export function findCustomTaskType(types: readonly ClickUpCustomTaskType[], customItemId: number): ClickUpCustomTaskType | null {
    if (!Number.isInteger(customItemId) || customItemId <= 0) return null;
    return types.find((type) => type.id === customItemId) || null;
}

export function dateToClickUpDueDate(value: string): number | null {
    if (typeof value !== 'string' || value.length > 64) return null;
    const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function boundedText(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

function boundedTimestamp(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : Date.now();
}

function isHexKey(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
