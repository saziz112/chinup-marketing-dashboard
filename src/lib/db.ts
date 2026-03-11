/**
 * Database Module — Vercel Postgres
 * Initializes all tables for the Marketing Dashboard.
 */

import { sql } from '@vercel/postgres';

export async function initAllTables() {
    // Phase 1: tables with no FK dependencies (parallel)
    await Promise.all([
        initUsersTable(),
        initSocialAccountsTable(),
        initSocialMetricsDailyTable(),
        initSocialPostsTable(),
        initAdCampaignsTable(),
        initAdMetricsDailyTable(),
        initLeadsTable(),
        initReviewsTable(),
        initReviewMetricsDailyTable(),
        initSearchConsoleDailyTable(),
        initSyncLogTable(),
        initCreativeImagesTable(),
        initCompetitorNotesTable(),
        initCreativeImageTagsTable(),
        initCreativePostUsageTable(),
        initCampaignRunsTable(),
        initSmsCacheTable(),
        initMbSalesHistoryTable(),
        initMbAppointmentsHistoryTable(),
        initMbSyncStateTable(),
        initMbClientsCacheTable(),
        initGhlContactsMapTable(),
        initApiUsageMonthlyTable(),
    ]);
    // Phase 2: tables with FK dependencies
    await initCampaignContactsTable();
}

async function initUsersTable() {
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
}

async function initSocialAccountsTable() {
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
}

async function initSocialMetricsDailyTable() {
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
}

async function initSocialPostsTable() {
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
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(platform, post_id)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_social_posts_posted_at ON social_posts(posted_at)`;
}

async function initAdCampaignsTable() {
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
}

async function initAdMetricsDailyTable() {
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
}

async function initLeadsTable() {
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
}

async function initReviewsTable() {
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
}

async function initReviewMetricsDailyTable() {
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
}

async function initSearchConsoleDailyTable() {
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
}

async function initSyncLogTable() {
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
}

async function initCreativeImagesTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS creative_images (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            enhanced_prompt TEXT,
            style VARCHAR(50),
            aspect_ratio VARCHAR(20),
            resolution VARCHAR(10),
            reference_image_url TEXT,
            task_id VARCHAR(100),
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            image_url TEXT,
            blob_url TEXT,
            fail_msg TEXT,
            cost_time_ms INT,
            created_by VARCHAR(255),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP WITH TIME ZONE
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_creative_images_status ON creative_images(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_creative_images_created ON creative_images(created_at)`;
    // Variation grouping columns
    await sql`ALTER TABLE creative_images ADD COLUMN IF NOT EXISTS group_id VARCHAR(100)`;
    await sql`ALTER TABLE creative_images ADD COLUMN IF NOT EXISTS variation_index INT DEFAULT 0`;
    await sql`CREATE INDEX IF NOT EXISTS idx_creative_images_group ON creative_images(group_id)`;
}

async function initCompetitorNotesTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS competitor_notes (
            id SERIAL PRIMARY KEY,
            location_id VARCHAR(20) NOT NULL,
            competitor_id VARCHAR(100) NOT NULL,
            strengths TEXT DEFAULT '[]',
            weaknesses TEXT DEFAULT '[]',
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(255),
            UNIQUE(location_id, competitor_id)
        )
    `;
}

async function initCreativeImageTagsTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS creative_image_tags (
            id SERIAL PRIMARY KEY,
            image_id TEXT NOT NULL,
            tag VARCHAR(100) NOT NULL,
            UNIQUE(image_id, tag)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_creative_tags_image ON creative_image_tags(image_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_creative_tags_tag ON creative_image_tags(tag)`;
}

async function initCreativePostUsageTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS creative_post_usage (
            id SERIAL PRIMARY KEY,
            creative_image_id TEXT NOT NULL,
            content_post_id TEXT NOT NULL,
            platform VARCHAR(50),
            published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(creative_image_id, content_post_id)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_cpu_creative ON creative_post_usage(creative_image_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cpu_post ON creative_post_usage(content_post_id)`;
}

/* ── SMS/Email Campaign Tables ─────────────────────────────── */

async function initCampaignRunsTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS campaign_runs (
            run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            segment VARCHAR(50) NOT NULL,
            segment_label VARCHAR(100) NOT NULL,
            channel VARCHAR(10) NOT NULL DEFAULT 'sms',
            location_key VARCHAR(20),
            total_targeted INT DEFAULT 0,
            total_sent INT DEFAULT 0,
            total_failed INT DEFAULT 0,
            total_skipped INT DEFAULT 0,
            message_template_key VARCHAR(50),
            run_by VARCHAR(255),
            run_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_campaign_runs_segment ON campaign_runs(segment)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_campaign_runs_run_at ON campaign_runs(run_at)`;
}

async function initCampaignContactsTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS campaign_contacts (
            id SERIAL PRIMARY KEY,
            run_id UUID NOT NULL REFERENCES campaign_runs(run_id),
            contact_id VARCHAR(100) NOT NULL,
            phone_hash VARCHAR(64),
            email_hash VARCHAR(64),
            location_key VARCHAR(20),
            channel VARCHAR(10) NOT NULL DEFAULT 'sms',
            status VARCHAR(20) NOT NULL DEFAULT 'sent',
            error_message VARCHAR(200),
            sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_cc_run ON campaign_contacts(run_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cc_phone_hash ON campaign_contacts(phone_hash)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cc_email_hash ON campaign_contacts(email_hash)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cc_sent_at ON campaign_contacts(sent_at)`;
}

async function initSmsCacheTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS sms_data_cache (
            cache_key VARCHAR(100) PRIMARY KEY,
            cache_data JSONB NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_sms_cache_expires ON sms_data_cache(expires_at)`;
}

// --- Phase 21: Advanced Patient Segmentation Tables ---

async function initMbSalesHistoryTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS mb_sales_history (
            sale_id INTEGER PRIMARY KEY,
            client_id TEXT NOT NULL,
            sale_date DATE NOT NULL,
            location_id INTEGER,
            total_amount NUMERIC(10,2) DEFAULT 0,
            items_json JSONB,
            synced_at TIMESTAMPTZ DEFAULT NOW()
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_mb_sales_client ON mb_sales_history(client_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mb_sales_date ON mb_sales_history(sale_date)`;
}

async function initMbAppointmentsHistoryTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS mb_appointments_history (
            appointment_id INTEGER PRIMARY KEY,
            client_id TEXT NOT NULL,
            start_date TIMESTAMPTZ NOT NULL,
            status TEXT,
            session_type_id INTEGER,
            session_type_name TEXT,
            location_id INTEGER,
            staff_name TEXT,
            synced_at TIMESTAMPTZ DEFAULT NOW()
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_mb_appts_client ON mb_appointments_history(client_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mb_appts_date ON mb_appointments_history(start_date)`;
}

async function initMbSyncStateTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS mb_sync_state (
            sync_type TEXT PRIMARY KEY,
            last_sync_date DATE NOT NULL,
            total_records INTEGER DEFAULT 0,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `;
}

async function initMbClientsCacheTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS mb_clients_cache (
            client_id TEXT PRIMARY KEY,
            first_name TEXT,
            last_name TEXT,
            email TEXT,
            phone TEXT,
            synced_at TIMESTAMPTZ DEFAULT NOW()
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_mb_clients_phone ON mb_clients_cache(phone)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mb_clients_email ON mb_clients_cache(email)`;
}

async function initGhlContactsMapTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS ghl_contacts_map (
            contact_id TEXT NOT NULL,
            location_key TEXT NOT NULL,
            phone_normalized TEXT,
            email TEXT,
            contact_name TEXT,
            dnd_global BOOLEAN DEFAULT FALSE,
            tags JSONB DEFAULT '[]',
            created_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ,
            synced_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (contact_id, location_key)
        )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ghl_contacts_phone ON ghl_contacts_map(phone_normalized)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ghl_contacts_email ON ghl_contacts_map(email)`;
}

async function initApiUsageMonthlyTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS api_usage_monthly (
            api_name TEXT NOT NULL,
            month_key TEXT NOT NULL,
            total_calls INTEGER DEFAULT 0,
            cache_hits INTEGER DEFAULT 0,
            PRIMARY KEY (api_name, month_key)
        )
    `;
}
