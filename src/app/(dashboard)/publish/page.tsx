import { Metadata } from 'next';
import PublishDashboardClient from './client';
import MetaTokenBanner from '@/components/MetaTokenBanner';

export const metadata: Metadata = {
    title: 'Publish | Chin Up! Aesthetics',
    description: 'Create, schedule, and track content publishing.',
};

export default function PublishPage() {
    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
            <div>
                <h1 className="text-3xl font-serif text-white mb-2">Publish & Accountability</h1>
                <p className="text-gray-400">Create, schedule, and track your content goals across all platforms.</p>
            </div>
            <MetaTokenBanner />
            <PublishDashboardClient />
        </div>
    );
}
