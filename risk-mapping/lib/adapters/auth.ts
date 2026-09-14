/**
 * Authentication Adapter
 *
 * Bridge to NextAuth session and authorization.
 * Implement these to connect Risk Mapping to your auth system.
 */

import type { Session } from 'next-auth';

// If Asset-Detection is within promia-web-sb project:
// export { getServerSession } from 'next-auth';
// export { default as authOptions } from './adapters';
// export { isRiskMappingEditor } from './adapters';

// If Asset-Detection is standalone:
// Import from your NextAuth setup:

export async function getServerSession(options?: any): Promise<Session | null> {
    // TODO: Implement your NextAuth session getter
    // Example:
    // import { getServerSession as nextGetServerSession } from 'next-auth';
    // import { authOptions } from '@/path/to/auth';
    // return await nextGetServerSession(authOptions);
    throw new Error('getServerSession not implemented. Configure your auth adapter.');
}

export const authOptions = {
    // TODO: Configure your NextAuth options
    // See: https://next-auth.js.org/configuration/options
};

export function isRiskMappingEditor(session: Session | null): boolean {
    // Check if user belongs to Risk Mapping editor group
    // Original: user.group === '0'
    const group = (session?.user as any)?.group;
    return group !== undefined && group !== null && String(group).trim() === '0';
}

export function requireAuth(session: Session | null) {
    if (!session) {
        throw new Error('Authentication required');
    }
    return session;
}

export function requireEditor(session: Session | null) {
    const s = requireAuth(session);
    if (!isRiskMappingEditor(s)) {
        throw new Error('Editor access required');
    }
    return s;
}



