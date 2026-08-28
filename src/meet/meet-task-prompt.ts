export interface MeetTaskSuggestion {
    id: string;
    name: string;
}

const MAX_MEET_SEARCH_LENGTH = 100;
const MAX_MEET_TITLE_LENGTH = 160;

export function sanitizeMeetTitle(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s*[-–—|]\s*Google Meet\s*$/i, '')
        .trim()
        .slice(0, MAX_MEET_TITLE_LENGTH);
}

export function sanitizeMeetSearchSeed(value: unknown): string {
    return sanitizeMeetTitle(value).slice(0, MAX_MEET_SEARCH_LENGTH);
}

export function extractMeetTaskIdCandidates(value: unknown): string[] {
    const title = sanitizeMeetSearchSeed(value);
    if (!title) return [];
    const candidates: string[] = [];
    const add = (candidate: string | undefined): void => {
        const clean = String(candidate || '').replace(/^#/, '').trim();
        if (!/^[A-Za-z0-9_-]{3,100}$/.test(clean) || !/\d/.test(clean)) return;
        if (!candidates.includes(clean)) candidates.push(clean);
    };

    for (const match of title.matchAll(/(?:app\.)?clickup\.com\/t\/([A-Za-z0-9_-]{3,100})/gi)) add(match[1]);
    for (const match of title.matchAll(/#([A-Za-z0-9_-]{3,100})\b/g)) add(match[1]);
    for (const match of title.matchAll(/[[(]([A-Za-z0-9_-]{3,100})[\])]/g)) add(match[1]);
    for (const match of title.matchAll(/\b([A-Z][A-Z0-9]{1,30}-\d{1,30})\b/g)) add(match[1]);
    return candidates.slice(0, 3);
}

export function sanitizeMeetTaskSuggestions(value: unknown): MeetTaskSuggestion[] {
    if (!Array.isArray(value)) return [];
    const suggestions: MeetTaskSuggestion[] = [];
    for (const raw of value.slice(0, 5)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const candidate = raw as Record<string, unknown>;
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
        const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, 500) : '';
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !name) continue;
        suggestions.push({ id, name });
    }
    return suggestions;
}

export function isCustomTaskIdCandidate(value: string): boolean {
    return /^[A-Za-z][A-Za-z0-9]{1,30}-\d{1,30}$/.test(value);
}
