/**
 * NextAuth.js Configuration
 * Role-based access: admin (Sam) and marketing_manager (Sharia)
 */

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { USERS } from '@/lib/config';
import { getUserByEmail, verifyPassword, recordSuccessfulLogin, recordFailedLogin } from '@/lib/users';

export const authOptions: NextAuthOptions = {
    providers: [
        CredentialsProvider({
            name: 'Chin Up! Marketing Dashboard',
            credentials: {
                email: { label: 'Email', type: 'email', placeholder: 'your.name@chinupaesthetics.com' },
                password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;

                // Temporarily using static USERS array for local dev instead of database
                const configUser = USERS.find(u => u.email.toLowerCase() === credentials.email.toLowerCase());
                if (!configUser) return null;

                // Hardcoded passwords for temporary local dev
                const tempPassword = configUser.role === 'admin' ? 'admin2026' : 'marketing2026';

                if (credentials.password !== tempPassword) {
                    return null;
                }

                return {
                    id: configUser.id,
                    email: configUser.email,
                    name: configUser.displayName,
                    image: null, // No mandatory password change for now
                };
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user, trigger }) {
            if (user) {
                token.staffId = user.id;
                token.role = USERS.find(u => u.id === user.id)?.role || 'marketing_manager';
                token.isAdmin = token.role === 'admin';
                token.mustChangePassword = user.image === 'MUST_CHANGE';
            }
            if (trigger === 'update') {
                token.mustChangePassword = false;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                (session.user as Record<string, unknown>).staffId = token.staffId;
                (session.user as Record<string, unknown>).role = token.role;
                (session.user as Record<string, unknown>).isAdmin = token.isAdmin;
                (session.user as Record<string, unknown>).mustChangePassword = token.mustChangePassword;
            }
            return session;
        },
    },
    pages: {
        signIn: '/login',
    },
    session: {
        strategy: 'jwt',
        maxAge: 30 * 24 * 60 * 60, // 30 days
    },
};
