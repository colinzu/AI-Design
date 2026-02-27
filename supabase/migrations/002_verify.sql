-- ============================================================
-- AI Design — Schema Verification + Safe Re-apply
-- Run in: Supabase Dashboard → SQL Editor
-- This script verifies RLS policies are in place and safely
-- re-applies anything that may have been missed on first run.
-- It is safe to run multiple times (idempotent).
-- ============================================================

-- ── 1. Quick check: which tables exist? ─────────────────────
select
    table_name,
    (select count(*) from information_schema.table_privileges
     where table_name = t.table_name and privilege_type = 'INSERT') as has_insert_priv
from information_schema.tables t
where table_schema = 'public'
  and table_name in ('profiles','teams','team_members','projects',
                     'project_elements','project_members','share_links','project_assets')
order by table_name;

-- ── 2. Check RLS enabled status ─────────────────────────────
select
    relname as table_name,
    relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('profiles','teams','team_members','projects',
                  'project_elements','project_members','share_links','project_assets')
order by relname;

-- ── 3. Check which RLS policies exist ───────────────────────
select
    schemaname,
    tablename,
    policyname,
    cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ── 4. Safe re-apply: enable RLS + ensure insert policies ───
-- (These are idempotent — safe to run even if already applied)

alter table if exists public.profiles         enable row level security;
alter table if exists public.teams            enable row level security;
alter table if exists public.team_members     enable row level security;
alter table if exists public.projects         enable row level security;
alter table if exists public.project_elements enable row level security;
alter table if exists public.project_members  enable row level security;
alter table if exists public.share_links      enable row level security;
alter table if exists public.project_assets   enable row level security;

-- Re-create helper functions (idempotent via create or replace)
create or replace function public.can_view_project(p_project_id uuid)
returns boolean language sql security definer
set search_path = public as $$
    select exists (
        select 1 from public.projects p
        where p.id = p_project_id
          and p.deleted_at is null
          and (
              p.owner_id = auth.uid()
              or exists (
                  select 1 from public.project_members pm
                  where pm.project_id = p.id and pm.user_id = auth.uid()
              )
              or (p.visibility = 'team' and p.team_id is not null and exists (
                  select 1 from public.team_members tm
                  where tm.team_id = p.team_id and tm.user_id = auth.uid()
              ))
              or p.visibility = 'public'
          )
    );
$$;

create or replace function public.can_edit_project(p_project_id uuid)
returns boolean language sql security definer
set search_path = public as $$
    select exists (
        select 1 from public.projects p
        where p.id = p_project_id
          and p.deleted_at is null
          and (
              p.owner_id = auth.uid()
              or exists (
                  select 1 from public.project_members pm
                  where pm.project_id = p.id
                    and pm.user_id = auth.uid()
                    and pm.role = 'editor'
              )
              or (p.visibility = 'team' and p.team_id is not null and exists (
                  select 1 from public.team_members tm
                  where tm.team_id = p.team_id
                    and tm.user_id = auth.uid()
                    and tm.role in ('owner', 'admin', 'editor')
              ))
          )
    );
$$;

-- Re-apply projects policies
drop policy if exists "projects_select" on public.projects;
drop policy if exists "projects_insert" on public.projects;
drop policy if exists "projects_update" on public.projects;
drop policy if exists "projects_delete" on public.projects;
create policy "projects_select" on public.projects for select using (can_view_project(id));
create policy "projects_insert" on public.projects for insert with check (auth.uid() = owner_id);
create policy "projects_update" on public.projects for update using (can_edit_project(id));
create policy "projects_delete" on public.projects for delete using (auth.uid() = owner_id);

-- Re-apply project_elements policies
drop policy if exists "elements_select" on public.project_elements;
drop policy if exists "elements_insert" on public.project_elements;
drop policy if exists "elements_update" on public.project_elements;
create policy "elements_select" on public.project_elements for select using (can_view_project(project_id));
create policy "elements_insert" on public.project_elements for insert with check (can_edit_project(project_id));
create policy "elements_update" on public.project_elements for update using (can_edit_project(project_id));

-- Re-apply profiles policies
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_all" on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- ── 5. Final check: confirm policies exist ──────────────────
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('projects', 'project_elements')
order by tablename, policyname;
