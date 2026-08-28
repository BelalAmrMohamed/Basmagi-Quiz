// =============================================================================
// public/src/shared/public-config.js
// Static public config — replaces the old /api/env serverless function
// (removed to stay under Vercel Hobby's 12-function cap; see
// vercel.json's `functions` allow-list and CHANGELOG for context).
//
// SAFE TO SHIP CLIENT-SIDE: the Supabase anon key is designed to be
// public — it identifies the project, not a secret credential. Access
// control is enforced by Postgres Row Level Security (RLS) policies on
// each table, not by hiding this key. NEVER put SUPABASE_SERVICE_KEY
// (the service-role key) here or anywhere in public/ — that one bypasses
// RLS entirely and must stay server-side only (see api/_middleware.js
// and every api/*.js route that already uses it).
//
// SETUP: fill in the two values below from your Supabase project
// settings (Project Settings → API → Project URL / anon public key).
// These are the exact same values previously served by GET /api/env.
// =============================================================================

export const SUPABASE_URL = "https://esdfdzhtavraczrhxnmp.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_4D7EOElzLkqjjMyrmt15iQ_fyXTNDQD";