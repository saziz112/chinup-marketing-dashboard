export interface PostingGoal {
    id: string;
    platform: 'instagram' | 'facebook' | 'youtube' | 'any';
    mediaType?: 'video' | 'static' | 'story' | 'any';
    targetCount: number;
    currentCount: number;
}

export interface WeeklyAccountability {
    weekStarting: string; // ISO date (Monday)
    goals: PostingGoal[];
    isCompleted: boolean;
    currentStreak: number;
}

// Mock goals
const currentStreak = 4; // 4 weeks in a row!

export async function getWeeklyGoals(): Promise<WeeklyAccountability> {
    // Determine current week Monday
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0);

    return {
        weekStarting: monday.toISOString(),
        currentStreak,
        isCompleted: false, // Calculate based on goals
        goals: [
            {
                id: 'goal_1',
                platform: 'instagram',
                mediaType: 'video', // Reels
                targetCount: 3,
                currentCount: 2
            },
            {
                id: 'goal_2',
                platform: 'youtube',
                mediaType: 'video',
                targetCount: 1,
                currentCount: 1
            },
            {
                id: 'goal_3',
                platform: 'any',
                mediaType: 'story',
                targetCount: 5,
                currentCount: 3
            }
        ]
    };
}

export async function getHeatmapData(): Promise<Record<string, number>> {
    const data: Record<string, number> = {};
    const today = new Date();

    // Generate mock data for the last 90 days
    for (let i = 0; i < 90; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];

        // Random activity 0-3 posts
        let posts = Math.floor(Math.random() * 4);

        // Weekends less active
        if (d.getDay() === 0 || d.getDay() === 6) {
            posts = Math.random() > 0.7 ? 1 : 0;
        }

        data[dateStr] = posts;
    }
    return data;
}
