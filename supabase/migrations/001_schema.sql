-- ============================================================
-- AI Design — Supabase Database Schema
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. PROFILES  (extends auth.users with public display info)
-- ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
    id           uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    avatar_url   text,
    language     text default 'en' check (language in ('en', 'zh')),
    created_at   timestamptz default now(),
    updated_at   timestamptz default now()
);

-- Auto-create profile on every new sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
    insert into public.profiles (id, display_name, avatar_url)
    values (
        new.id,
        coalesce(
            new.raw_user_meta_data->>'full_name',
            new.raw_user_meta_data->>'name',
            split_part(new.email, '@', 1)
        ),
        new.raw_user_meta_data->>'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────────
-- 2. TEAMS
-- ────────────────────────────────────────────────────────────
create table if not exists public.teams (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    slug       text unique not null,          -- URL-friendly: "my-team"
    avatar_url text,
    owner_id   uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- 3. TEAM MEMBERS
-- ────────────────────────────────────────────────────────────
create table if not exists public.team_members (
    team_id    uuid not null references public.teams(id)   on delete cascade,
    user_id    uuid not null references auth.users(id)     on delete cascade,
    role       text not null default 'editor'
               check (role in ('owner', 'admin', 'editor', 'viewer')),
    invited_by uuid references auth.users(id),
    joined_at  timestamptz default now(),
    primary key (team_id, user_id)
);

-- ────────────────────────────────────────────────────────────
-- 4. PROJECTS  (metadata only — elements stored separately)
-- ────────────────────────────────────────────────────────────
create table if not exists public.projects (
    id            uuid primary key default gen_random_uuid(),
    name          text not null default 'Untitled Project',
    owner_id      uuid not null references auth.users(id) on delete cascade,
    team_id       uuid references public.teams(id) on delete set null,
    visibility    text not null default 'private'
                  check (visibility in ('private', 'team', 'public')),
    viewport      jsonb    default '{"x":0,"y":0,"scale":0.2}'::jsonb,
    thumbnail_url text,
    frame_count   int      default 0,
    deleted_at    timestamptz,               -- soft delete
    created_at    timestamptz default now(),
    updated_at    timestamptz default now()
);

create index if not exists idx_projects_owner   on public.projects(owner_id)       where deleted_at is null;
create index if not exists idx_projects_team    on public.projects(team_id)        where deleted_at is null;
create index if not exists idx_projects_updated on public.projects(updated_at desc);

-- ────────────────────────────────────────────────────────────
-- 5. PROJECT ELEMENTS  (canvas data, isolated to avoid list-query bloat)
-- ────────────────────────────────────────────────────────────
create table if not exists public.project_elements (
    project_id uuid primary key references public.projects(id) on delete cascade,
    elements   jsonb not null default '[]'::jsonb,
    version    int   not null default 1,      -- optimistic concurrency
    updated_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- 6. PROJECT MEMBERS  (per-project access, overrides team role)
-- ────────────────────────────────────────────────────────────
create table if not exists public.project_members (
    project_id uuid not null references public.projects(id) on delete cascade,
    user_id    uuid not null references auth.users(id)      on delete cascade,
    role       text not null default 'viewer'
               check (role in ('editor', 'commenter', 'viewer')),
    invited_by uuid references auth.users(id),
    created_at timestamptz default now(),
    primary key (project_id, user_id)
);

-- ────────────────────────────────────────────────────────────
-- 7. SHARE LINKS  (token-based public access)
-- ────────────────────────────────────────────────────────────
create table if not exists public.share_links (
    id         uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    token      text unique not null default encode(gen_random_bytes(24), 'hex'),
    role       text not null default 'viewer' check (role in ('viewer', 'editor')),
    expires_at timestamptz,
    created_by uuid references auth.users(id),
    created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- 8. PROJECT ASSETS  (uploaded images replacing base64)
-- ────────────────────────────────────────────────────────────
create table if not exists public.project_assets (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references public.projects(id) on delete cascade,
    owner_id     uuid not null references auth.users(id),
    storage_path text not null,               -- Supabase Storage path
    filename     text,
    mime_type    text,
    size_bytes   bigint,
    created_at   timestamptz default now()
);

-- ============================================================
-- RLS HELPER FUNCTIONS
-- ============================================================

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

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- profiles
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_all" on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- teams
alter table public.teams enable row level security;
drop policy if exists "teams_select_member" on public.teams;
drop policy if exists "teams_insert_owner"  on public.teams;
drop policy if exists "teams_update_owner"  on public.teams;
drop policy if exists "teams_delete_owner"  on public.teams;
create policy "teams_select_member" on public.teams for select using (
    owner_id = auth.uid() or exists (
        select 1 from public.team_members tm where tm.team_id = id and tm.user_id = auth.uid()
    )
);
create policy "teams_insert_owner" on public.teams for insert with check (auth.uid() = owner_id);
create policy "teams_update_owner" on public.teams for update using (auth.uid() = owner_id);
create policy "teams_delete_owner" on public.teams for delete using (auth.uid() = owner_id);

-- team_members
alter table public.team_members enable row level security;
drop policy if exists "team_members_select"       on public.team_members;
drop policy if exists "team_members_insert_admin" on public.team_members;
drop policy if exists "team_members_delete_admin" on public.team_members;
create policy "team_members_select" on public.team_members for select using (
    user_id = auth.uid() or exists (
        select 1 from public.team_members tm2
        where tm2.team_id = team_id and tm2.user_id = auth.uid()
    )
);
create policy "team_members_insert_admin" on public.team_members for insert with check (
    exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid())
    or exists (
        select 1 from public.team_members tm
        where tm.team_id = team_id and tm.user_id = auth.uid() and tm.role in ('owner', 'admin')
    )
);
create policy "team_members_delete_admin" on public.team_members for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid())
    or exists (
        select 1 from public.team_members tm
        where tm.team_id = team_id and tm.user_id = auth.uid() and tm.role in ('owner', 'admin')
    )
);

-- projects
alter table public.projects enable row level security;
drop policy if exists "projects_select" on public.projects;
drop policy if exists "projects_insert" on public.projects;
drop policy if exists "projects_update" on public.projects;
drop policy if exists "projects_delete" on public.projects;
create policy "projects_select" on public.projects for select using (can_view_project(id));
create policy "projects_insert" on public.projects for insert with check (auth.uid() = owner_id);
create policy "projects_update" on public.projects for update using (can_edit_project(id));
create policy "projects_delete" on public.projects for delete using (auth.uid() = owner_id);

-- project_elements
alter table public.project_elements enable row level security;
drop policy if exists "elements_select" on public.project_elements;
drop policy if exists "elements_insert" on public.project_elements;
drop policy if exists "elements_update" on public.project_elements;
create policy "elements_select" on public.project_elements for select using (can_view_project(project_id));
create policy "elements_insert" on public.project_elements for insert with check (can_edit_project(project_id));
create policy "elements_update" on public.project_elements for update using (can_edit_project(project_id));

-- project_members
alter table public.project_members enable row level security;
drop policy if exists "project_members_select" on public.project_members;
drop policy if exists "project_members_insert" on public.project_members;
drop policy if exists "project_members_delete" on public.project_members;
create policy "project_members_select" on public.project_members for select using (can_view_project(project_id));
create policy "project_members_insert" on public.project_members for insert with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
    or exists (
        select 1 from public.project_members pm
        where pm.project_id = project_id and pm.user_id = auth.uid() and pm.role = 'editor'
    )
);
create policy "project_members_delete" on public.project_members for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
);

-- share_links
alter table public.share_links enable row level security;
drop policy if exists "share_links_select" on public.share_links;
drop policy if exists "share_links_insert" on public.share_links;
drop policy if exists "share_links_delete" on public.share_links;
create policy "share_links_select" on public.share_links for select using (can_view_project(project_id));
create policy "share_links_insert" on public.share_links for insert with check (can_edit_project(project_id));
create policy "share_links_delete" on public.share_links for delete using (can_edit_project(project_id));

-- project_assets
alter table public.project_assets enable row level security;
drop policy if exists "assets_select" on public.project_assets;
drop policy if exists "assets_insert" on public.project_assets;
create policy "assets_select" on public.project_assets for select using (can_view_project(project_id));
create policy "assets_insert" on public.project_assets for insert with check (
    can_edit_project(project_id) and auth.uid() = owner_id
);

-- ============================================================
-- STORAGE BUCKETS  (create manually in Supabase Dashboard → Storage)
-- ============================================================
-- Bucket 1: "project-thumbnails"
--   Public: true | Max size: 500 KB | MIME: image/jpeg, image/webp
--   INSERT policy: auth.uid() is not null
--   SELECT policy: true
--
-- Bucket 2: "project-assets"
--   Public: false | Max size: 10 MB | MIME: image/*
--   INSERT policy: auth.uid() is not null
--   SELECT policy: auth.uid() is not null
