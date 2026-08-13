-- Migration: Add `allowed_scopes` to `admin_users`
-- Run this in your Supabase SQL Editor

-- 1. Add the column
ALTER TABLE public.admin_users 
ADD COLUMN allowed_scopes text[] DEFAULT '{Primary,Middle,High,University,Featured}'::text[];

-- NOTE: The default gives existing admins access to everything. 
-- As a platform owner, you can edit this per admin in the control panel.
