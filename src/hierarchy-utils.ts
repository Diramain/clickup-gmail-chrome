export interface CachedHierarchyList {
    id: string;
    name: string;
    [key: string]: unknown;
}

export interface CachedHierarchyFolder {
    id: string;
    name: string;
    lists?: CachedHierarchyList[];
    [key: string]: unknown;
}

export interface CachedHierarchySpace {
    id: string;
    name: string;
    color?: string;
    avatar?: { url?: string } | null;
    lists?: CachedHierarchyList[];
    folders?: CachedHierarchyFolder[];
    [key: string]: unknown;
}

export interface FlatHierarchyList {
    id: string;
    name: string;
    path: string;
    spaceName: string;
    folderName?: string;
    spaceColor?: string;
    spaceAvatar?: string | null;
}

export function getTeamHierarchyCache(cache: unknown, teamId: string | null | undefined): { data?: { spaces?: CachedHierarchySpace[] }; timestamp?: number } | null {
    if (!cache || typeof cache !== 'object' || !teamId) return null;
    const entry = (cache as Record<string, unknown>)[teamId];
    return entry && typeof entry === 'object' ? entry as { data?: { spaces?: CachedHierarchySpace[] }; timestamp?: number } : null;
}

export function flattenHierarchySpaces(spaces: CachedHierarchySpace[] | undefined | null): FlatHierarchyList[] {
    if (!Array.isArray(spaces)) return [];
    const flattened: FlatHierarchyList[] = [];
    for (const space of spaces) {
        if (!space?.id || !space?.name) continue;
        const spaceColor = space.color || '#7B68EE';
        const spaceAvatar = space.avatar?.url || null;
        for (const list of space.lists || []) {
            if (!list?.id || !list?.name) continue;
            flattened.push({
                id: list.id,
                name: list.name,
                path: `${space.name} > ${list.name}`,
                spaceName: space.name,
                spaceColor,
                spaceAvatar,
            });
        }
        for (const folder of space.folders || []) {
            if (!folder?.id || !folder?.name) continue;
            for (const list of folder.lists || []) {
                if (!list?.id || !list?.name) continue;
                flattened.push({
                    id: list.id,
                    name: list.name,
                    path: `${space.name} > ${folder.name} > ${list.name}`,
                    spaceName: space.name,
                    folderName: folder.name,
                    spaceColor,
                    spaceAvatar,
                });
            }
        }
    }
    return flattened;
}
