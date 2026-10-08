-- World Scanner 1단계 스키마 (기존 컬럼/제약은 건드리지 않고 새 컬럼과 새 테이블만 추가)
-- Supabase SQL Editor 에서 한 번에 실행. 여러 번 실행해도 안전하다.

-- 1) parcels: 좌표 → 현재 엔티티
alter table public.parcels
  add column if not exists entity_id text,
  add column if not exists state text,
  add column if not exists state_changed_at timestamptz;

do $$
begin
  alter table public.parcels
    add constraint parcels_state_check check (state in ('active', 'empty', 'unknown'));
exception when duplicate_object then null;
end $$;

create index if not exists parcels_entity_id_idx on public.parcels (entity_id);
create index if not exists parcels_state_idx on public.parcels (state);

-- 2) catalyst_scenes: 엔티티(씬) 단위 정보
create table if not exists public.catalyst_scenes (
  entity_id     text primary key,
  title         text,
  base          text,
  parcel_count  integer,
  owner         text,
  tags          text[],
  main          text,
  deployed_at   timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  meta          jsonb
);
create index if not exists catalyst_scenes_deployed_at_idx on public.catalyst_scenes (deployed_at desc);

-- 3) scanner_runs: 스캔 1회 요약
create table if not exists public.scanner_runs (
  id            bigint generated always as identity primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  mode          text not null default 'full',
  total_checked integer,
  active_count  integer,
  empty_count   integer,
  entity_count  integer,
  changed_count integer,
  failed_count  integer,
  duration_ms   integer,
  note          text
);

-- 4) RLS: 새 테이블은 읽기만 공개, 쓰기는 service role 키만 가능
alter table public.catalyst_scenes enable row level security;
alter table public.scanner_runs enable row level security;

do $$
begin
  create policy catalyst_scenes_read on public.catalyst_scenes for select to anon, authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy scanner_runs_read on public.scanner_runs for select to anon, authenticated using (true);
exception when duplicate_object then null;
end $$;

-- 4-1) 권한: 읽기는 anon/authenticated, 쓰기는 service_role 만 (Supabase 기본 권한에 기대지 않고 명시)
grant select on public.catalyst_scenes, public.scanner_runs to anon, authenticated;
grant all on public.catalyst_scenes, public.scanner_runs to service_role;

-- 5) 바뀐 행만 한 번에 갱신하는 함수 (스캐너가 1000행씩 호출)
create or replace function public.apply_parcel_observations(
  p_rows jsonb,
  p_changed_at timestamptz default now()
) returns integer
language plpgsql
as $$
declare
  n integer;
begin
  update public.parcels p
     set entity_id = r.entity_id,
         state = r.state,
         state_changed_at = p_changed_at
    from jsonb_to_recordset(p_rows) as r(id text, entity_id text, state text)
   where p.id = r.id
     and (p.entity_id is distinct from r.entity_id or p.state is distinct from r.state);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.apply_parcel_observations(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_parcel_observations(jsonb, timestamptz) to service_role;
