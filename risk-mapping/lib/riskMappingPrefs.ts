// Client-side only. Remembers the last Risk Model the user picked in the PFD
// viewer, so the list page's multi-PFD export (which has no model dropdown
// of its own) and the viewer's own dropdown can both default to it instead
// of forcing a fresh selection every time.
const LAST_MODEL_KEY = 'riskMapping:lastModelId';

export function getLastModelId(): number | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(LAST_MODEL_KEY);
    const parsed = raw ? parseInt(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
}

export function setLastModelId(id: number | null) {
    if (typeof window === 'undefined') return;
    if (id == null) window.localStorage.removeItem(LAST_MODEL_KEY);
    else window.localStorage.setItem(LAST_MODEL_KEY, String(id));
}