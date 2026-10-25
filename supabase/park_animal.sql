-- =============================================================================
-- 時光祕境島（時光動物祕境，設施 science_warrior）：進度與老師細節頁（2026-10-25）
-- =============================================================================
--
-- 遊戲放在樂園底下（animal/），跟樂園同一個 Supabase、同一套帳號。
-- 每一關記一列：走到第幾步、失誤幾次、玩幾趟、第一次過關的時間、最快幾秒過關；
-- 地圖角落的彩蛋勳章另外一張表。老師看自己班（animal/?teacher），樂園總覽多一欄，
-- 管理員「要改善的地方」多一段（park_playlog.sql 的 park_admin_insights）。
--
--   animal_track(level, event, step, no, steps, sec)   學生：遊戲裡發生的事（只有這一支能寫）
--   animal_class_summary(code)                         樂園全班總覽那一欄
--   animal_class_progress(code)                        老師細節頁：名單＋每人每關＋彩蛋
--
-- 關卡代碼由遊戲決定（forest、nest、harbor、town…），新關卡不用改資料庫；
-- 只有老師看的名字與「共幾關」在 animal_level_label / animal_level_count。
--
-- 套用順序：park_teacher.sql → park_playlog.sql → 這份（重跑沒關係）

create table if not exists public.animal_progress (
  student_id     uuid not null references public.students(id) on delete cascade,
  level          text not null check (level ~ '^[a-z]{2,20}$'),
  step           text,                         -- 這一趟現在的步驟（遊戲裡的 phase）
  step_no        smallint not null default 0,  -- 這一趟走到第幾步
  steps          smallint,                     -- 這關共幾步
  step_at        timestamptz,                  -- 走到這一步的時間（停很久＝卡住）
  best_no        smallint not null default 0,  -- 沒過關前最遠走到第幾步
  misses         int not null default 0,       -- 全部失誤（被大冠鷲抓到、被兵蟻擋下、油漆抹在濕鐵上…）
  run_misses     int not null default 0,       -- 這一趟的失誤
  plays          int not null default 0,       -- 進這關幾趟
  run_at         timestamptz,                  -- 這一趟開始的時間
  clears         int not null default 0,
  first_clear_at timestamptz,
  best_sec       int,                          -- 最快幾秒過關
  last_sec       int,
  updated_at     timestamptz not null default now(),
  primary key (student_id, level)
);
alter table public.animal_progress enable row level security;
revoke all on public.animal_progress from public, anon, authenticated;

create table if not exists public.animal_eggs (
  student_id uuid not null references public.students(id) on delete cascade,
  egg        text not null check (egg ~ '^[a-z][a-z0-9-]{1,30}$'),
  level      text,
  got_at     timestamptz not null default now(),
  primary key (student_id, egg)
);
alter table public.animal_eggs enable row level security;
revoke all on public.animal_eggs from public, anon, authenticated;

-- 老師看的關卡名字；新關卡加一行
create or replace function public.animal_level_label(p_level text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_level
    when 'forest' then '第一關 森林' when 'nest' then '第二關 螞蟻地下城'
    when 'harbor' then '第三關 海港工坊' when 'town' then '第四關 劇場小鎮'
    when 'sky' then '第五關 山頂天文台'
    else p_level end;
$$;
-- 現在共幾關（總覽的進度％用）
create or replace function public.animal_level_count()
returns int language sql immutable as $$ select 5 $$;

-- 學生：遊戲裡發生的事。不是學生（老師試玩、沒登入）就什麼都不記。
--   start 開始一趟  step 走到下一步  miss 失誤一次  clear 過關（sec＝這趟花幾秒）  egg 撿到彩蛋（step＝彩蛋代碼）
create or replace function public.animal_track(p_level text, p_event text, p_step text default null,
                                               p_no int default null, p_steps int default null, p_sec int default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := public.current_student_id();
  v_level text := lower(btrim(coalesce(p_level, '')));
  v_step  text := nullif(left(btrim(coalesce(p_step, '')), 30), '');
  v_no    smallint := least(greatest(coalesce(p_no, 0), 0), 50);
  v_steps smallint := nullif(least(greatest(coalesce(p_steps, 0), 0), 50), 0);
  v_sec   int := nullif(least(greatest(coalesce(p_sec, 0), 0), 4 * 3600), 0);
begin
  if v_me is null or v_level !~ '^[a-z]{2,20}$' then return; end if;

  if p_event = 'egg' then
    if v_step is not null and v_step ~ '^[a-z][a-z0-9-]{1,30}$' then
      insert into public.animal_eggs (student_id, egg, level) values (v_me, v_step, v_level)
      on conflict do nothing;
    end if;
    return;
  end if;
  if p_event not in ('start', 'step', 'miss', 'clear') then return; end if;

  insert into public.animal_progress as p (student_id, level) values (v_me, v_level)
  on conflict (student_id, level) do nothing;

  update public.animal_progress p set
    plays      = p.plays + (p_event = 'start')::int,
    run_at     = case when p_event = 'start' then now() else p.run_at end,
    run_misses = case when p_event = 'start' then 0 when p_event = 'miss' then p.run_misses + 1 else p.run_misses end,
    misses     = p.misses + (p_event = 'miss')::int,
    step       = case when p_event = 'start' then null when p_event = 'step' then v_step
                      when p_event = 'clear' then 'win' else p.step end,
    step_no    = case when p_event = 'start' then 0 when p_event = 'step' then v_no
                      when p_event = 'clear' then coalesce(v_steps, p.steps, p.step_no) else p.step_no end,
    steps      = coalesce(v_steps, p.steps),
    step_at    = case when p_event in ('start', 'step', 'clear') then now() else p.step_at end,
    best_no    = greatest(p.best_no, case when p_event = 'step' then v_no
                                          when p_event = 'clear' then coalesce(v_steps, p.steps, 0) else 0 end),
    clears     = p.clears + (p_event = 'clear')::int,
    first_clear_at = case when p_event = 'clear' then coalesce(p.first_clear_at, now()) else p.first_clear_at end,
    last_sec   = case when p_event = 'clear' then v_sec else p.last_sec end,
    best_sec   = case when p_event = 'clear' and v_sec is not null then least(coalesce(p.best_sec, v_sec), v_sec) else p.best_sec end,
    updated_at = now()
   where p.student_id = v_me and p.level = v_level;
end;
$$;

-- 樂園「全班總覽」那一欄（欄位跟 guardian_class_summary、island_class_summary 一樣）
create or replace function public.animal_class_summary(p_code text)
returns table (student_id uuid, progress int, last_played timestamptz,
               status text, attention boolean, reason text)
language sql stable security definer set search_path = public, pg_temp as $$
  with target as (select upper(btrim(coalesce(p_code, ''))) as code),
  kids as (
    select m.student_id as id
      from public.park_class_members m join target t on t.code = m.class_code
     where public.is_teacher_of(t.code)
  ),
  agg as (
    select k.id, count(p.first_clear_at) as cleared, max(p.updated_at) as at
      from kids k left join public.animal_progress p on p.student_id = k.id
     group by k.id
  ),
  latest as (
    select distinct on (k.id) k.id, p.level, p.step_no, p.steps, p.first_clear_at is not null as done,
           p.step = 'win' as won, p.updated_at as at
      from kids k join public.animal_progress p on p.student_id = k.id
     order by k.id, p.updated_at desc
  )
  select a.id,
         least(100, round(100.0 * a.cleared / public.animal_level_count()))::int,
         a.at,
         case
           when a.at is null then '還沒開始'
           else '過了 ' || a.cleared || '/' || public.animal_level_count() || ' 關・最近：' || public.animal_level_label(l.level)
                || case when l.won then ' 過關'
                        when l.steps is not null then '（第 ' || l.step_no || '/' || l.steps || ' 步）' else '' end
         end,
         coalesce(a.at is null or a.at < now() - interval '7 days'
          or (not l.done and l.at < now() - interval '3 days'), false),
         case
           when a.at is null then '還沒玩過'
           when a.at < now() - interval '7 days' then extract(day from now() - a.at)::int || ' 天沒玩了'
           when not l.done and l.at < now() - interval '3 days' then public.animal_level_label(l.level) || '停在同一步好幾天了'
           else null
         end
    from agg a left join latest l on l.id = a.id;
$$;

-- 老師細節頁：這班名單（沒玩過的也在）、每人每關、彩蛋
create or replace function public.animal_class_progress(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  return jsonb_build_object(
    'kids', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nickname', s.nickname) order by s.nickname, s.login_id), '[]')
               from public.park_class_members m join public.students s on s.id = m.student_id
              where m.class_code = v_code),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                'student_id', p.student_id, 'level', p.level, 'step', p.step, 'step_no', p.step_no, 'steps', p.steps,
                'step_at', p.step_at, 'best_no', p.best_no, 'misses', p.misses, 'run_misses', p.run_misses,
                'plays', p.plays, 'clears', p.clears, 'first_clear_at', p.first_clear_at,
                'best_sec', p.best_sec, 'last_sec', p.last_sec, 'updated_at', p.updated_at)), '[]')
               from public.park_class_members m join public.animal_progress p on p.student_id = m.student_id
              where m.class_code = v_code),
    'eggs', (select coalesce(jsonb_agg(jsonb_build_object('student_id', e.student_id, 'egg', e.egg, 'level', e.level, 'got_at', e.got_at)), '[]')
               from public.park_class_members m join public.animal_eggs e on e.student_id = m.student_id
              where m.class_code = v_code));
end;
$$;

revoke all on function public.animal_level_label(text), public.animal_level_count(),
  public.animal_track(text, text, text, int, int, int), public.animal_class_summary(text), public.animal_class_progress(text)
  from public, anon;
grant execute on function public.animal_track(text, text, text, int, int, int), public.animal_class_summary(text),
  public.animal_class_progress(text)
  to authenticated;

-- 在樂園登記細節頁與摘要函式（只補空的欄位，狀態請管理員在後台改）
update public.park_facilities
   set detail_url     = coalesce(detail_url, '/animal/'),
       detail_url_dev = coalesce(detail_url_dev, '/dev/animal/'),
       summary_fn     = coalesce(summary_fn, 'animal_class_summary'),
       updated_at     = now()
 where code = 'science_warrior';
