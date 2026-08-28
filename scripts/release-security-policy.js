const BLOCKED_CLICKUP_OAUTH_MARKERS = [
    { label: 'token endpoint', pattern: /api\/v2\/oauth\/token/i },
    { label: 'authorization endpoint', pattern: /app\.clickup\.com\/api\?(?:[^\s"']*&)?client_id=/i },
    { label: 'credential action', pattern: /\bsaveOAuthConfig\b/ },
    { label: 'client secret field', pattern: /\bclient_secret\b/i },
    { label: 'legacy OAuth credential fields', pattern: /(?:\bclientId\b[\s\S]{0,240}\bclientSecret\b|\bclientSecret\b[\s\S]{0,240}\bclientId\b)/ },
    { label: 'legacy OAuth config variable', pattern: /\b(?:const|let|var)\s+oauthConfig\b|\boauthConfig\s*[.=]/ },
    { label: 'assembled legacy OAuth marker', pattern: /\[['"]oauth['"]\s*,\s*['"]Config['"]\]\s*\.join|\[['"]oauth['"]\s*,\s*['"]token['"]\]\s*\.join/i },
    { label: 'legacy setup UI', pattern: /Configuraci[oó]n avanzada con OAuth/i },
    { label: 'legacy config helper', pattern: /\b(?:get|save|has)SecureOAuthConfig\b/ },
    { label: 'legacy auth action', pattern: /(["'])authenticate\1/ },
    { label: 'legacy browser auth flow', pattern: /\blaunchWebAuthFlow\b/ },
];
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';
const GOOGLE_CALENDAR_CLIENT_ID = '1085109551140-db2i3dgveraah5vkjoadfkmf091e29h2.apps.googleusercontent.com';

function findBlockedClickUpOAuthMarker(content) {
    return BLOCKED_CLICKUP_OAUTH_MARKERS.find(({ pattern }) => pattern.test(content))?.label || null;
}

function grantsGoogleApisHost(pattern) {
    if (pattern === '<all_urls>') return true;
    const match = /^(?:\*|[a-z][a-z0-9+.-]*):\/\/([^/]+)\//i.exec(pattern);
    if (!match) return false;
    const host = match[1].toLowerCase();
    if (host === '*') return true;
    if (host === 'googleapis.com' || host.endsWith('.googleapis.com')) return true;
    if (!host.startsWith('*.')) return false;
    const suffix = host.slice(2);
    return suffix === 'googleapis.com' || 'googleapis.com'.endsWith(`.${suffix}`);
}

function firefoxManifestHostSurfaces(manifest) {
    return [
        ...(manifest.permissions || []),
        ...(manifest.optional_permissions || []),
        ...(manifest.host_permissions || []),
        ...(manifest.optional_host_permissions || []),
        ...(manifest.content_scripts || []).flatMap((script) => script.matches || []),
        ...(manifest.web_accessible_resources || []).flatMap((resource) => resource.matches || []),
        ...(manifest.externally_connectable?.matches || []),
    ];
}

function calendarManifestPolicyErrors(manifest, target) {
    const errors = [];
    if (target === 'chrome') {
        if (!(manifest.permissions || []).includes('identity')) errors.push('Chrome Calendar identity permission missing');
        if (!(manifest.host_permissions || []).includes('https://www.googleapis.com/*')) errors.push('Chrome Calendar API host missing');
        if (manifest.oauth2?.client_id !== GOOGLE_CALENDAR_CLIENT_ID) errors.push('Chrome Calendar OAuth client mismatch');
        if (JSON.stringify(manifest.oauth2?.scopes) !== JSON.stringify([GOOGLE_CALENDAR_SCOPE])) errors.push('Chrome Calendar OAuth scope mismatch');
        return errors;
    }

    const firefoxPermissions = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];
    const firefoxHosts = firefoxManifestHostSurfaces(manifest);
    if (firefoxPermissions.includes('identity')) errors.push('Firefox must not request identity while Calendar is disabled');
    if (manifest.oauth2) errors.push('Firefox manifest contains Chrome OAuth block');
    if (firefoxHosts.some(grantsGoogleApisHost)) {
        errors.push('Firefox must not claim Calendar API access while Calendar is disabled');
    }
    return errors;
}

module.exports = {
    BLOCKED_CLICKUP_OAUTH_MARKERS,
    GOOGLE_CALENDAR_CLIENT_ID,
    GOOGLE_CALENDAR_SCOPE,
    calendarManifestPolicyErrors,
    findBlockedClickUpOAuthMarker,
    grantsGoogleApisHost,
};
