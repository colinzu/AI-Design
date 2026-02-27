# Supabase RLS Fix for Error 42501

If you see **"Save failed (42501)"** or **"new row violates row-level security policy for table 'projects'"**, your Supabase database needs the correct RLS policies.

## Quick Fix

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → Your Project → **SQL Editor**
2. Run the migration scripts in order:

### Step 1: Run Schema (if not done)
Copy and run the entire content of `migrations/001_schema.sql`

### Step 2: Re-apply RLS Policies
Copy and run the entire content of `migrations/002_verify.sql`

## Verify Setup

After running the migrations, verify:

1. **Authentication** → Ensure Email/OTP or OAuth providers are enabled
2. **Storage** → Create bucket `project-thumbnails` (Public: true)
3. **RLS** → In Table Editor → `projects` → ensure RLS is enabled and policies exist:
   - `projects_select`
   - `projects_insert` (requires `auth.uid() = owner_id`)
   - `projects_update`
   - `projects_delete`

## Fallback Behavior

When cloud save fails (e.g. RLS not configured), the app now **automatically saves to local IndexedDB**. Your work is preserved. You will see "Saved locally (cloud sync failed)" in the badge. Projects will appear in Recents on the homepage.
