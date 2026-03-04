export type Platform = 'instagram' | 'facebook' | 'youtube';
export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED';

export interface PublishRequest {
    platforms: Platform[];
    title?: string;
    caption: string;
    mediaUrls: string[];
    scheduledFor?: string; // ISO string, if undefined post immediately
}

export interface PostRecord {
    id: string;
    platforms: Platform[];
    title?: string;
    caption: string;
    mediaUrls: string[];
    status: PostStatus;
    scheduledFor?: string;
    createdAt: string;
    publishedAt?: string;
    errors?: Record<string, string>;
}

// In-memory store for mocked data (until DB is hooked up)
let MOCK_POSTS: PostRecord[] = [
    {
        id: 'post_1',
        platforms: ['instagram', 'facebook'],
        caption: 'Loving the new results from our latest Morpheus8 treatment! ✨ #medspa #chinupaesthetics',
        mediaUrls: ['https://images.unsplash.com/photo-1612450410755-f55db463510e?w=800&auto=format&fit=crop'],
        status: 'PUBLISHED',
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        publishedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
        id: 'post_2',
        platforms: ['instagram'],
        caption: 'Day in the life at Chin Up! Aesthetics 💉',
        mediaUrls: [],
        status: 'SCHEDULED',
        scheduledFor: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
    }
];

export async function createPost(req: PublishRequest): Promise<PostRecord> {
    const isScheduled = !!req.scheduledFor && new Date(req.scheduledFor) > new Date();

    const newPost: PostRecord = {
        id: `post_${Date.now()}`,
        ...req,
        status: isScheduled ? 'SCHEDULED' : 'PUBLISHED',
        createdAt: new Date().toISOString(),
        ...(isScheduled ? {} : { publishedAt: new Date().toISOString() })
    };

    MOCK_POSTS = [newPost, ...MOCK_POSTS];

    // Here we would actually call the platform APIs if it's not scheduled
    if (!isScheduled) {
        // e.g., await publishToInstagram(req.mediaUrls[0], req.caption);
    }

    return newPost;
}

export async function getPosts(status?: PostStatus): Promise<PostRecord[]> {
    if (status) {
        return MOCK_POSTS.filter(p => p.status === status);
    }
    return MOCK_POSTS;
}

export async function updatePostStatus(id: string, status: PostStatus): Promise<PostRecord | null> {
    const idx = MOCK_POSTS.findIndex(p => p.id === id);
    if (idx === -1) return null;

    MOCK_POSTS[idx].status = status;
    return MOCK_POSTS[idx];
}

export async function deletePost(id: string): Promise<boolean> {
    const initialLen = MOCK_POSTS.length;
    MOCK_POSTS = MOCK_POSTS.filter(p => p.id !== id);
    return MOCK_POSTS.length < initialLen;
}
