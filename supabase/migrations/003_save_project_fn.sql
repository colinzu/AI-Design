-- ============================================================
-- AI Design — save_project SECURITY DEFINER RPC
-- Run in: Supabase Dashboard → SQL Editor
--
-- WHY THIS EXISTS
-- The normal INSERT path relies on PostgREST setting auth.uid()
-- from the JWT before evaluating RLS policies. In some edge cases
-- (session race, anon-key fallback) auth.uid() arrives as NULL,
-- making every INSERT fail with 42501.
--
-- This function is SECURITY DEFINER, so it runs as the DB owner
-- and bypasses RLS completely. It does its own auth validation by
-- reading the raw JWT claims that PostgREST injects into GUC
-- variables before calling any function, giving us a detailed
-- error message (not just "row-level security policy violation").
-- ============================================================

create or replace function public.save_project(
    p_id          uuid,
    p_owner_id    uuid,
    p_name        text    default 'Untitled Project',
    p_frame_count int     default 0,
    p_viewport    jsonb   default '{"x":0,"y":0,"scale":0.2}'::jsonb,
    p_elements    jsonb   default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sub    text;
    v_role   text;
    v_claims text;
    v_caller uuid;
begin
    -- PostgREST injects JWT claims into these GUC variables
    -- before calling any database function.
    v_sub    := nullif(current_setting('request.jwt.claim.sub',  true), '');
    v_role   := nullif(current_setting('request.jwt.claim.role', true), '');
    v_claims := nullif(current_setting('request.jwt.claims',     true), '');

    -- Fallback: parse the full claims JSON blob
    if v_sub is null and v_claims is not null then
        v_sub := v_claims::jsonb ->> 'sub';
    end if;
    if v_role is null and v_claims is not null then
        v_role := v_claims::jsonb ->> 'role';
    end if;

    -- Cast sub to uuid (will raise if malformed)
    begin
        v_caller := v_sub::uuid;
    exception when others then
        raise exception
            '[save_project] Invalid JWT sub claim: "%" (role=%). '
            'Decode your access_token and verify the "sub" field.',
            coalesce(v_sub, 'null'), coalesce(v_role, 'null');
    end;

    -- Require authenticated role
    if v_role is distinct from 'authenticated' then
        raise exception
            '[save_project] JWT role="%" sub="%". '
            'Expected role="authenticated". '
            'The token may be the anon key — sign out and sign in again.',
            coalesce(v_role, 'null'), coalesce(v_sub, 'null');
    end if;

    -- Caller must own this project
    if v_caller is null or v_caller != p_owner_id then
        raise exception
            '[save_project] Forbidden: JWT sub (%) does not match p_owner_id (%).',
            coalesce(v_sub, 'null'), p_owner_id;
    end if;

    -- ── Upsert project metadata (RLS bypassed by SECURITY DEFINER) ──
    insert into projects (id, owner_id, name, frame_count, viewport, updated_at)
    values (p_id, p_owner_id, p_name, p_frame_count, p_viewport, now())
    on conflict (id) do update set
        name        = excluded.name,
        frame_count = excluded.frame_count,
        viewport    = excluded.viewport,
        updated_at  = now()
    where projects.owner_id = p_owner_id;

    -- ── Upsert canvas elements ───────────────────────────────────────
    insert into project_elements (project_id, elements, updated_at)
    values (p_id, p_elements, now())
    on conflict (project_id) do update set
        elements   = excluded.elements,
        updated_at = now();

    return jsonb_build_object(
        'ok',       true,
        'owner_id', p_owner_id,
        'jwt_role', v_role,
        'jwt_sub',  v_sub
    );
end;
$$;

-- Allow both roles to invoke; the function itself enforces auth
grant execute on function public.save_project to anon, authenticated;
