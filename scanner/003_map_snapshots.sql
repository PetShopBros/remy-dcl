-- World Scanner: map_snapshots (스캔마다 만드는 지도 한 장. 웹 지도와 씬 안 지도가 최신 1행을 함께 읽는다)
-- 여러 번 실행해도 안전하다.
--
-- codes: 301x301 = 90,601 글자. 한 글자가 한 칸.
--   배치: 첫 글자 = (x=-150, y=150) 북서쪽 끝, 가로로 x 증가, 한 줄이 끝나면 y 한 칸 감소
--   인덱스 = (max_y - y) * width + (x - min_x)
--   글자: 0=씬 없음  1=콘텐츠 있음  2=템플릿/빈 씬  3=도로  4=미확인
--         5~9 = 0~4 와 같은 의미 + 최근 변경(overlay).  (5=없음+최근, 6=콘텐츠+최근, 7=템플릿+최근, 8=도로+최근, 9=미확인+최근)

create table if not exists public.map_snapshots (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  run_id     bigint,
  width      integer not null,
  height     integer not null,
  min_x      integer not null,
  max_y      integer not null,
  codes      text not null,
  stats      jsonb not null,
  constraint map_snapshots_codes_len check (char_length(codes) = width * height)
);

alter table public.map_snapshots enable row level security;

do $$
begin
  create policy map_snapshots_read on public.map_snapshots for select to anon, authenticated using (true);
exception when duplicate_object then null;
end $$;

grant select on public.map_snapshots to anon, authenticated;
grant all on public.map_snapshots to service_role;

-- 확인
select count(*) as snapshots from public.map_snapshots;
