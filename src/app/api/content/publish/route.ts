import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
    createPost, getPosts, updatePostStatus, deletePost, updatePost,
    setPostArchived,
    PublishRequest, PostStatus, getPostCountByPlatform
} from '@/lib/content-publisher';
import { startOfWeek, endOfWeek, format } from 'date-fns';

async function requireAuth() {
    const session = await getServerSession(authOptions);
    if (!session?.user) return null;
    return session;
}

export async function GET(req: Request) {
    const session = await requireAuth();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'posts'; // 'posts' | 'goals'
    const status = searchParams.get('status') as PostStatus | undefined;
    const includeArchived = searchParams.get('includeArchived') === 'true';

    try {
        if (type === 'goals') {
            const today = new Date();
            const weekStart = startOfWeek(today, { weekStartsOn: 1 });
            const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

            const counts = await getPostCountByPlatform(
                format(weekStart, "yyyy-MM-dd'T'00:00:00"),
                format(weekEnd, "yyyy-MM-dd'T'23:59:59")
            );

            const goals = {
                weekStarting: format(weekStart, 'yyyy-MM-dd'),
                weekEnding: format(weekEnd, 'yyyy-MM-dd'),
                targets: {
                    instagram: { target: 3, current: counts.instagram || 0, label: 'IG Posts' },
                    facebook: { target: 3, current: counts.facebook || 0, label: 'FB Posts' },
                    youtube: { target: 1, current: counts.youtube || 0, label: 'YT Videos' },
                    total: { target: 7, current: counts.total || 0, label: 'Total Posts' },
                },
                currentStreak: 0,
                isOnTrack: (counts.total || 0) >= 3,
            };

            return NextResponse.json({ goals });
        } else {
            const posts = await getPosts(status || undefined, includeArchived);
            return NextResponse.json({ posts });
        }
    } catch (error: any) {
        console.error('[Publish API] GET error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await requireAuth();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json() as PublishRequest;

        if (!body.platforms || body.platforms.length === 0) {
            return NextResponse.json({ error: 'At least one platform is required' }, { status: 400 });
        }
        if (!body.caption && (!body.mediaUrls || body.mediaUrls.length === 0)) {
            return NextResponse.json({ error: 'Content (caption or media) is required' }, { status: 400 });
        }

        // Attach current user
        body.createdBy = session.user?.email || undefined;

        const newPost = await createPost(body);

        return NextResponse.json({
            post: newPost,
            results: newPost.publishResults || [],
            allSucceeded: newPost.status === 'PUBLISHED',
            message: newPost.status === 'PUBLISHED'
                ? `Successfully posted to ${body.platforms.join(' & ')}`
                : newPost.status === 'PARTIAL'
                    ? `Some platforms succeeded. Check errors for details.`
                    : newPost.status === 'SCHEDULED'
                        ? `Scheduled for ${body.scheduledFor}`
                        : `Publishing failed. Check errors for details.`,
        }, { status: 201 });
    } catch (error: any) {
        console.error('[Publish API] POST error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    const session = await requireAuth();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { id, ...fields } = body;

        if (!id) {
            return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
        }

        // Archive / unarchive (works on any status, including PUBLISHED/FAILED/PARTIAL)
        if (typeof fields.archived === 'boolean' && Object.keys(fields).length === 1) {
            const updated = await setPostArchived(id, fields.archived);
            if (!updated) {
                return NextResponse.json({ error: 'Post not found' }, { status: 404 });
            }
            return NextResponse.json({ post: updated });
        }

        // If only status is being updated, use the simpler function
        if (fields.status && Object.keys(fields).length === 1) {
            const updated = await updatePostStatus(id, fields.status);
            if (!updated) {
                return NextResponse.json({ error: 'Post not found' }, { status: 404 });
            }
            return NextResponse.json({ post: updated });
        }

        // Full field update (for editing scheduled posts)
        const updated = await updatePost(id, fields);
        if (!updated) {
            return NextResponse.json({ error: 'Post not found or not editable (must be SCHEDULED)' }, { status: 404 });
        }
        return NextResponse.json({ post: updated });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    const session = await requireAuth();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
    }

    try {
        const success = await deletePost(id);
        if (!success) {
            return NextResponse.json({ error: 'Post not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
