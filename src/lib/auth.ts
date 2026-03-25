/**
 * NextAuth.js Configuration
 * Role-based access: admin (Sam) and marketing_manager (Sharia)
 */

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
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

                try {
                    // Fetch user from Vercel Postgres DB
                    const dbUser = await getUserByEmail(credentials.email);
                    if (!dbUser) return null; // No user found

                    // Verify hashed password
                    const isValid = await verifyPassword(credentials.password, dbUser.password_hash);

                    if (!isValid) {
                        await recordFailedLogin(credentials.email).catch(console.error);
                        return null;
                    }

                    // Record successful login (non-blocking — login still succeeds if recording fails)
                    try {
                        await recordSuccessfulLogin(dbUser.staff_id);
                    } catch (loginRecordErr) {
                        console.warn('[Auth] Failed to record login for', dbUser.staff_id, loginRecordErr);
                    }

                    return {
                        id: dbUser.staff_id,
                        email: dbUser.email,
                        name: dbUser.display_name || undefined,
                        image: dbUser.must_change_password ? 'MUST_CHANGE' : null,
                        role: dbUser.role,
                    } as any;
                } catch (error) {
                    console.error('Auth error:', error);
                    return null;
                }
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user, trigger }) {
            if (user) {
                token.staffId = user.id;
                token.role = (user as any).role || 'marketing_manager';
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
