import type { Metadata } from 'next';
import { Assistant, Italiana } from 'next/font/google';
import Providers from './providers';
import './globals.css';

const assistant = Assistant({
    variable: '--font-assistant',
    subsets: ['latin'],
    display: 'swap',
});

const italiana = Italiana({
    variable: '--font-italiana',
    subsets: ['latin'],
    weight: '400',
    display: 'swap',
});

export const metadata: Metadata = {
    title: 'Marketing Dashboard | Chin Up! Aesthetics',
    description: 'Track organic social media, paid ads, and revenue attribution for Chin Up! Aesthetics.',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body className={`${assistant.variable} ${italiana.variable}`}>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
