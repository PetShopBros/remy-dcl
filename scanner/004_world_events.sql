-- World Scanner: world_events (DCL 세계의 변화 이력. 추가만 하는 로그)
-- 여러 번 실행해도 안전하다.
--
-- 이벤트 종류
--   scene_created  : 비어 있던 땅에 씬이 올라옴
--   scene_removed  : 씬이 사라져 빈 땅이 됨 (다른 씬이 그 땅을 이어받지 않은 경우)
--   scene_updated  : 같은 파셀 구성에서 엔티티만 새 버전으로 바뀜 (제목은 동일성 판단에 쓰지 않는다)
--   scene_replaced : 파셀 구성이 바뀌었거나 분류(kind)가 바뀐 교체
-- 첫 스캔(baseline)은 이벤트로 만들지 않는다. 스캐너가 변화를 감지한 시점부터만 기록한다.
-- observed_at = 스캐너가 알아챈 시각, deployed_at = 엔티티의 실제 배포 시각 (스캔 간격만큼 차이가 난다)
-- event_key = 같은 변화가 두 번 기록되지 않게 하는 키 (event_type|entity_id|prev_entity_id)

create table if not exists public.world_events (
  id             bigint generated always as identity primary key,
  event_key      text not null unique,
  observed_at    timestamptz not null default now(),
  deployed_at    timestamptz,
  event_type     text not null,
  parcels        text[] not null,
  entity_id      text,
  prev_entity_id text,
  title          text,
  prev_title     text,
  kind           text,
  prev_kind      text,
  parcel_count   integer,
  run_id         bigint,
  meta           jsonb,
  constraint world_events_type_check check (event_type in ('scene_created', 'scene_removed', 'scene_updated', 'scene_replaced')),
  constraint world_events_kind_check check (kind is null or kind in ('road', 'plaza', 'district', 'template', 'user_scene', 'unknown')),
  constraint world_events_prev_kind_check check (prev_kind is null or prev_kind in ('road', 'plaza', 'district', 'template', 'user_scene', 'unknown'))
);

-- where parcels @> array['46,115'] 로 특정 파셀의 이력을 빠르게 조회
create index if not exists world_events_parcels_gin on public.world_events using gin (parcels);
create index if not exists world_events_observed_at_idx on public.world_events (observed_at desc);

alter table public.world_events enable row level security;

do $$
begin
  create policy world_events_read on public.world_events for select to anon, authenticated using (true);
exception when duplicate_object then null;
end $$;

grant select on public.world_events to anon, authenticated;
grant all on public.world_events to service_role;

-- 확인
select count(*) as world_events from public.world_events;
