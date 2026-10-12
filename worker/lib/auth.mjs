// Auth for the contract's protected routes.
// Single user (Israel). Protected endpoints require
// `Authorization: Bearer <API_SECRET>`; when API_SECRET is unset they answer
// 503 and the client falls back to localStorage-only mode.
// Legacy secrets (WATCHLIST_SECRET / BREADTH_SECRET) stay scoped to the old
// express routes (/api/watchlist, POST /api/breadth) — see server/server.mjs.

export function getBearer(request) {
    const h = request.headers.get('authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    return m ? m[1].trim() : '';
}

export function apiSecret(env) {
    const s = (env?.API_SECRET || '').trim();
    return s || '';
}

// Returns null when authorized, otherwise a {status, body} error to return.
export function requireApiAuth(request, env) {
    const secret = apiSecret(env);
    if (!secret) return { status: 503, body: { error: 'api auth not configured' } };
    const token = getBearer(request);
    if (!token || token !== secret) return { status: 401, body: { error: 'unauthorized' } };
    return null;
}
