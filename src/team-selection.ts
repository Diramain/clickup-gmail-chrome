export interface AuthorizedTeamLike {
    id?: unknown;
}

export function selectAuthorizedTeamId(
    teams: AuthorizedTeamLike[] | undefined | null,
    preferredTeamId?: unknown,
): string | null {
    const authorizedIds = (Array.isArray(teams) ? teams : [])
        .map(team => typeof team?.id === 'string' ? team.id.trim() : '')
        .filter(id => id.length > 0 && id.length <= 100);
    const preferred = typeof preferredTeamId === 'string' ? preferredTeamId.trim() : '';
    if (preferred && authorizedIds.includes(preferred)) return preferred;
    return authorizedIds[0] || null;
}

export function isAuthorizedTeamId(
    teams: AuthorizedTeamLike[] | undefined | null,
    candidate: unknown,
): candidate is string {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 100) return false;
    return (Array.isArray(teams) ? teams : []).some(team => team?.id === candidate);
}
