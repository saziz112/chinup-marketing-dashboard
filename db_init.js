require('dotenv').config({ path: '.env.development.local' });
// Map prefixed Vercel Postgres variables to the standard ones expected by @vercel/postgres
Object.keys(process.env).forEach(key => {
    if (key.startsWith('MD__POSTGRES_') || key.startsWith('MD__PG') || key.startsWith('MD__DATABASE_')) {
        const standardKey = key.replace('MD__', '');
        process.env[standardKey] = process.env[key];
    }
});

const { sql } = require('@vercel/postgres');

async function init() {
  console.log('Starting DB init on new Database...');
  
  // Create tables manually to bypass Next.js API route requirement
  await sql`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            staff_id VARCHAR(50) UNIQUE NOT NULL,
            role VARCHAR(30) NOT NULL DEFAULT 'marketing_manager',
            must_change_password BOOLEAN DEFAULT TRUE,
            is_active BOOLEAN DEFAULT TRUE,
            last_login_at TIMESTAMP WITH TIME ZONE,
            failed_login_attempts INT DEFAULT 0,
            failed_login_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id)`;
    
    await sql`
        CREATE TABLE IF NOT EXISTS social_accounts (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(20) NOT NULL,
            account_id VARCHAR(100) NOT NULL,
            account_name VARCHAR(255),
            access_token TEXT,
            refresh_token TEXT,
            token_expires_at TIMESTAMP WITH TIME ZONE,
            is_active BOOLEAN DEFAULT TRUE,
            is_competitor BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `;

    await sql`
        CREATE TABLE IF NOT EXISTS social_metrics_daily (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(20) NOT NULL,
            account_id VARCHAR(100),
            metric_date DATE NOT NULL,
            followers INT,
            followers_gained INT,
            impressions INT,
            reach INT,
            engagement_total INT,
            engagement_rate NUMERIC(6,4),
            profile_views INT,
            website_clicks INT,
            posts_published INT,
            video_views INT,
            avg_watch_time_seconds NUMERIC(8,2),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(platform, account_id, metric_date)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_social_metrics_date ON social_metrics_daily(metric_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_social_metrics_platform ON social_metrics_daily(platform)`;

    await sql`
        CREATE TABLE IF NOT EXISTS social_posts (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(20) NOT NULL,
            post_id VARCHAR(100) NOT NULL,
            post_type VARCHAR(20),
            posted_at TIMESTAMP WITH TIME ZONE,
            caption TEXT,
            permalink VARCHAR(500),
            likes INT DEFAULT 0,
            comments INT DEFAULT 0,
            shares INT DEFAULT 0,
            saves INT DEFAULT 0,
            views INT DEFAULT 0,
            reach INT DEFAULT 0,
            impressions INT DEFAULT 0,
            engagement_rate NUMERIC(6,4),
            media_url TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(platform, post_id)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_social_posts_posted_at ON social_posts(posted_at)`;

    await sql`
        CREATE TABLE IF NOT EXISTS ad_campaigns (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(20) NOT NULL,
            campaign_id VARCHAR(100) NOT NULL,
            campaign_name VARCHAR(255),
            status VARCHAR(20),
            objective VARCHAR(50),
            daily_budget NUMERIC(10,2),
            lifetime_budget NUMERIC(10,2),
            start_date DATE,
            end_date DATE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(platform, campaign_id)
        )
    `;

    await sql`
        CREATE TABLE IF NOT EXISTS ad_metrics_daily (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(20) NOT NULL,
            campaign_id VARCHAR(100) NOT NULL,
            metric_date DATE NOT NULL,
            spend NUMERIC(10,2),
            impressions INT,
            reach INT,
            clicks INT,
            ctr NUMERIC(6,4),
            cpc NUMERIC(8,4),
            cpm NUMERIC(8,4),
            conversions INT DEFAULT 0,
            cost_per_conversion NUMERIC(10,2),
            leads INT DEFAULT 0,
            cost_per_lead NUMERIC(10,2),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(platform, campaign_id, metric_date)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ad_metrics_date ON ad_metrics_daily(metric_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ad_metrics_campaign ON ad_metrics_daily(campaign_id)`;

    await sql`
        CREATE TABLE IF NOT EXISTS leads (
            id SERIAL PRIMARY KEY,
            mindbody_client_id VARCHAR(50),
            first_name VARCHAR(100),
            referral_source VARCHAR(100),
            referral_notes TEXT,
            attributed_platform VARCHAR(20),
            attributed_campaign_id VARCHAR(100),
            first_appointment_date DATE,
            first_appointment_revenue NUMERIC(10,2),
            lifetime_revenue NUMERIC(10,2) DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_leads_platform ON leads(attributed_platform)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_leads_date ON leads(first_appointment_date)`;

    await sql`
        CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(20) NOT NULL,
            review_id VARCHAR(100),
            reviewer_name VARCHAR(255),
            rating NUMERIC(2,1),
            review_text TEXT,
            review_date TIMESTAMP WITH TIME ZONE,
            reply_text TEXT,
            replied_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(platform, review_id)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_reviews_platform ON reviews(platform)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(review_date)`;

    await sql`
        CREATE TABLE IF NOT EXISTS review_metrics_daily (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(20) NOT NULL,
            metric_date DATE NOT NULL,
            total_reviews INT,
            average_rating NUMERIC(3,2),
            new_reviews INT DEFAULT 0,
            five_star_count INT DEFAULT 0,
            four_star_count INT DEFAULT 0,
            three_star_count INT DEFAULT 0,
            two_star_count INT DEFAULT 0,
            one_star_count INT DEFAULT 0,
            response_rate NUMERIC(5,2),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(platform, metric_date)
        )
    `;

    await sql`
        CREATE TABLE IF NOT EXISTS search_console_daily (
            id SERIAL PRIMARY KEY,
            metric_date DATE NOT NULL,
            query VARCHAR(500),
            page VARCHAR(500),
            clicks INT,
            impressions INT,
            ctr NUMERIC(6,4),
            position NUMERIC(6,2),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(metric_date, query, page)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_search_console_date ON search_console_daily(metric_date)`;

    await sql`
        CREATE TABLE IF NOT EXISTS sync_log (
            id SERIAL PRIMARY KEY,
            source VARCHAR(50) NOT NULL,
            status VARCHAR(20) NOT NULL,
            records_synced INT DEFAULT 0,
            error_message TEXT,
            started_at TIMESTAMP WITH TIME ZONE,
            completed_at TIMESTAMP WITH TIME ZONE
        )
    `;
    console.log('SUCCESS: All 11 tables created on NEW database.');
}
init().catch(e => console.error(e));
