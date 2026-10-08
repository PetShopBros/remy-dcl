-- World Scanner: catalyst_scenes.kind (현재 시점의 분류값. 원본은 스캐너가 계산하며, 다시 계산되면 덮어써진다)
-- 규칙(v3)은 scanner/world-scanner.mjs 의 classifyKind() 와 같아야 한다. 여러 번 실행해도 안전하다.

alter table public.catalyst_scenes add column if not exists kind text;

do $$
begin
  alter table public.catalyst_scenes
    add constraint catalyst_scenes_kind_check
    check (kind in ('road', 'plaza', 'district', 'template', 'user_scene', 'unknown'));
exception when duplicate_object then null;
end $$;

create index if not exists catalyst_scenes_kind_idx on public.catalyst_scenes (kind);

-- backfill: 엔티티가 덮는 파셀의 tile_type 최빈값(plaza/district 판단)과 제목으로 분류
with pd as (
  select entity_id, mode() within group (order by tile_type) as tile_mode
  from public.parcels
  where entity_id is not null
  group by entity_id
),
k as (
  select c.entity_id,
         case
           when c.title ~* '^road at ' then 'road'
           when c.title is null or btrim(c.title) = '' then 'unknown'
           when lower(btrim(c.title)) in ('interactive-text', 'empty', 'new scene', 'new', 'dcl scene', 'builder',
                                          'sdk7 template scene', 'sdk7 scene template', 'test', '新场景')
                or c.title ~* '^builder\s*-?\d'
                or c.title ~* '^new scene \d+$' then 'template'
           when pd.tile_mode = 'plaza' then 'plaza'
           when pd.tile_mode = 'district' then 'district'
           else 'user_scene'
         end as kind
  from public.catalyst_scenes c
  left join pd using (entity_id)
)
update public.catalyst_scenes c
   set kind = k.kind
  from k
 where k.entity_id = c.entity_id
   and c.kind is distinct from k.kind;

-- 확인: 종류별 엔티티 수 (합계 24,387 이어야 함)
select kind, count(*) as scenes from public.catalyst_scenes group by kind order by scenes desc;
