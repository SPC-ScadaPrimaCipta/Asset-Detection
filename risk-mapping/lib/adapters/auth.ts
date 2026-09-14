/**
 * Authentication Adapter
 *
 * Bridge to NextAuth session and authorization.
 * Implement these to connect Risk Mapping to your auth system.
 */

import type { Session } from 'next-auth';
import { getServerSession as nextGetServerSession } from 'next-auth';
import type { NextAuthOptions } from 'next-auth';

export const authOptions: NextAuthOptions = {
    providers: [],
    secret: process.env.NEXTAUTH_SECRET,
    session: { strategy: 'jwt' },
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.group = (user as any).group;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                (session.user as any).group = token.group;
            }
            return session;
        },
    },
};

export async function getServerSession(): Promise<Session | null> {
    return await nextGetServerSession(authOptions);
}

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



