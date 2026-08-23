export interface TaskSearchCandidate {
    id: string;
    name: string;
}

export function normalizeTaskSearchText(value: string): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('es')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

export function extractTaskIdCandidate(input: string): string | null {
    const trimmed = String(input || '').trim();
    const urlMatch = trimmed.match(/(?:app\.)?clickup\.com\/t\/([a-zA-Z0-9_-]{3,100})/i);
    if (urlMatch) return urlMatch[1];

    const hashMatch = trimmed.match(/^#([a-zA-Z0-9_-]{3,100})$/);
    if (hashMatch) return hashMatch[1];

    if (/^[A-Za-z][A-Za-z0-9]{1,30}-\d{1,30}$/.test(trimmed)) return trimmed;

    if (/^[a-zA-Z0-9]{5,100}$/.test(trimmed) && /\d/.test(trimmed)) {
        return trimmed;
    }

    return null;
}

function idSearchTerm(query: string): string | null {
    const exactCandidate = extractTaskIdCandidate(query);
    if (exactCandidate) return exactCandidate.toLocaleLowerCase('en');

    const trimmed = String(query || '').trim().replace(/^#/, '');
    if (/^[a-zA-Z0-9]{3,20}$/.test(trimmed) && /\d/.test(trimmed)) {
        return trimmed.toLocaleLowerCase('en');
    }

    return null;
}

export function scoreTaskSearchCandidate(task: TaskSearchCandidate, query: string): number | null {
    const taskId = String(task.id || '').toLocaleLowerCase('en');
    const idQuery = idSearchTerm(query);
    if (idQuery && taskId === idQuery) return 10_000;
    if (idQuery && taskId.includes(idQuery)) return 9_000 - Math.max(0, taskId.length - idQuery.length);

    const normalizedQuery = normalizeTaskSearchText(query);
    const normalizedName = normalizeTaskSearchText(task.name);
    if (!normalizedQuery || !normalizedName) return null;

    const words = normalizedQuery.split(' ').filter(Boolean);
    const containsAllWords = words.length > 0 && words.every(word => normalizedName.includes(word));
    if (normalizedName === normalizedQuery) return 8_000;
    if (normalizedName.startsWith(normalizedQuery)) return 7_500;
    if (normalizedName.includes(normalizedQuery)) return 7_000;
    if (containsAllWords) {
        const firstWordPosition = normalizedName.indexOf(words[0]);
        return 6_000 - Math.max(0, firstWordPosition);
    }

    return null;
}

export function rankTaskSearchResults<T extends TaskSearchCandidate>(tasks: T[], query: string, limit = 10): T[] {
    const unique = new Map<string, { task: T; score: number }>();

    for (const task of tasks) {
        const score = scoreTaskSearchCandidate(task, query);
        if (score === null || !task.id) continue;

        const existing = unique.get(task.id);
        if (!existing || score > existing.score) unique.set(task.id, { task, score });
    }

    return [...unique.values()]
        .sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            const lengthDifference = a.task.name.length - b.task.name.length;
            if (lengthDifference !== 0) return lengthDifference;
            return a.task.name.localeCompare(b.task.name, 'es', { sensitivity: 'base' });
        })
        .slice(0, Math.max(0, limit))
        .map(item => item.task);
}

export function hasHighConfidenceTaskSearchResult<T extends TaskSearchCandidate>(tasks: T[], query: string): boolean {
    return tasks.some(task => (scoreTaskSearchCandidate(task, query) ?? 0) >= 7_000);
}
