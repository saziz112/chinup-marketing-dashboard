import { NextResponse } from 'next/server';
import {
    createPost, getPosts, updatePostStatus, deletePost, PublishRequest, PostStatus
} from '@/lib/content-publisher';
import { getWeeklyGoals, getHeatmapData } from '@/lib/posting-goals';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'posts'; // 'posts' | 'goals'
    const status = searchParams.get('status') as PostStatus | undefined;

    try {
        if (type === 'goals') {
            const goals = await getWeeklyGoals();
            const heatmap = await getHeatmapData();
            return NextResponse.json({ goals, heatmap });
        } else {
            const posts = await getPosts(status);
            return NextResponse.json({ posts });
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json() as PublishRequest;

        if (!body.platforms || body.platforms.length === 0) {
            return NextResponse.json({ error: 'At least one platform is required' }, { status: 400 });
        }
        if (!body.caption && (!body.mediaUrls || body.mediaUrls.length === 0)) {
            return NextResponse.json({ error: 'Content (caption or media) is required' }, { status: 400 });
        }

        const newPost = await createPost(body);
        return NextResponse.json({ post: newPost }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    try {
        const body = await req.json();
        const { id, status } = body;

        if (!id || !status) {
            return NextResponse.json({ error: 'Post ID and status are required' }, { status: 400 });
        }

        const updated = await updatePostStatus(id, status);
        if (!updated) {
            return NextResponse.json({ error: 'Post not found' }, { status: 404 });
        }

        return NextResponse.json({ post: updated });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
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
