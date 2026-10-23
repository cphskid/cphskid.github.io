-- =============================================================================
-- 時空冒險樂園：遊玩紀錄（2026-10-23「管理者看學生遊玩紀錄」方案 B）
-- =============================================================================
--
-- 每個遊戲進場寫一筆、玩的時候每 30 秒送一次心跳、離開時收尾，就知道誰在什麼時候玩了
-- 什麼、玩多久。老師看得到自己班學生的時間軸，管理員多一頁全站動態。
--
--   park_play_start(facility, place, label)   進場（或換地方）→ 回傳這一筆的編號
--   park_play_beat(id, end)                   心跳；end=true 是離開
--
-- facility：park（樂園大廳）、guardian、island_pioneer…（park_facilities.code）
-- place：遊戲自己決定，島嶼開拓者用 map、ch1…ch7、end、village…；守護異世界整趟一筆 enter
-- 玩多久＝最後一次心跳減開始時間；分頁直接關掉也只差最後一次心跳的 30 秒。
--
-- 這張表上線前的舊資料用現有的表補（守護異世界的 answer_events 每題都有時間、
-- 島嶼開拓者每章的最後存檔），所以時間軸上線第一天就不是空的。
-- 紀錄只留 180 天，過期的在有人進場時順手清掉。
--
-- 套用順序：schema.sql → park_accounts.sql → park_teacher.sql → park_passport.sql
--          → park_pet.sql → park_traveller.sql → park_coins.sql → 這份（之後重跑哪份都可以）

create table if not exists public.park_play_log (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  facility   text not null,
  place      text not null,
  label      text,
  started_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  ended_at   timestamptz
);
create index if not exists park_play_log_student on public.park_play_log (student_id, started_at desc);
create index if not exists park_play_log_started on public.park_play_log (started_at desc);
alter table public.park_play_log enable row level security;
-- 沒有任何 policy：只能透過下面的函式讀寫
revoke all on public.park_play_log from public, anon, authenticated;

-- 島嶼開拓者各地方的名字（舊存檔沒有 label 時用；新紀錄由遊戲自己帶）
create or replace function public.park_island_label(p_place text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_place
    when 'map' then '大地圖' when 'world' then '大地圖' when 'prologue' then '序章 認識臺灣'
    when 'ch1' then '第一章 島嶼的第一道火光' when 'ch2' then '第二章 山林與部落'
    when 'ch3' then '第三章 大航海時代' when 'ch4' then '第四章 東寧屯田'
    when 'ch5' then '第五章 八堡圳' when 'ch6' then '第六章 開港與鐵路'
    when 'ch7' then '第七章 縱貫與大圳' when 'end' then '終章 今天的島嶼'
    when 'village' then '風與海的漁村' when 'town' then '規則小鎮' when 'sky' then '天空港'
    when 'isles' then '離島巡航' when 'postcard' then '景點明信片' when 'post' then '景點明信片'
    else p_place end;
$$;

-- -----------------------------------------------------------------------------
-- 1. 遊戲端：進場、心跳
-- -----------------------------------------------------------------------------

create or replace function public.park_play_start(p_facility text, p_place text, p_label text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := public.current_student_id();
  v_fac   text := left(btrim(coalesce(p_facility, '')), 40);
  v_place text := left(btrim(coalesce(p_place, '')), 40);
  v_label text := nullif(left(btrim(coalesce(p_label, '')), 60), '');
  v_id    bigint;
begin
  if v_me is null or v_fac = '' or v_place = '' then return null; end if;
  if v_fac <> 'park' and not exists (select 1 from public.park_facilities f where f.code = v_fac) then return null; end if;
  -- 遊戲出錯一直重來時別把表灌爆
  if (select count(*) from public.park_play_log l
       where l.student_id = v_me and l.started_at > now() - interval '1 minute') >= 20 then return null; end if;

  -- 2 分鐘內才離開同一個地方又回來（重新整理、切回分頁）：接著用那一筆，不算新的一趟
  select l.id into v_id from public.park_play_log l
   where l.student_id = v_me and l.facility = v_fac and l.place = v_place
     and coalesce(l.ended_at, l.last_seen) > now() - interval '2 minutes'
   order by l.started_at desc limit 1;
  -- 同一個人在同一個遊戲同時只開一筆：別的收尾在最後一次心跳
  update public.park_play_log l set ended_at = l.last_seen
   where l.student_id = v_me and l.facility = v_fac and l.ended_at is null and l.id is distinct from v_id;

  if v_id is not null then
    update public.park_play_log l set ended_at = null, last_seen = now(), label = coalesce(v_label, l.label)
     where l.id = v_id;
  else
    insert into public.park_play_log (student_id, facility, place, label)
    values (v_me, v_fac, v_place, v_label) returning id into v_id;
    if random() < 0.02 then
      delete from public.park_play_log l where l.started_at < now() - interval '180 days';
    end if;
  end if;
  return v_id;
end;
$$;

-- 一趟最多算 4 小時（平板開著一整晚不算在玩）
create or replace function public.park_play_beat(p_id bigint, p_end boolean default false)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.park_play_log l
     set last_seen = least(now(), l.started_at + interval '4 hours'),
         ended_at  = case when p_end then least(now(), l.started_at + interval '4 hours') end
   where l.id = p_id and l.student_id = public.current_student_id() and l.ended_at is null;
  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. 讀：把遊玩紀錄和舊資料併成同一種「一筆動態」
-- -----------------------------------------------------------------------------
-- kind：play＝遊玩紀錄表的一趟；level＝守護異世界的一場（answer_events 依場次分）；
--       save＝島嶼開拓者的舊存檔（遊玩紀錄上線前，只知道最後存檔時間）；stamp＝拿到勳章
-- p_students 是 null＝全站（只給管理員用的函式叫）。

create or replace function public.park_activity_rows(p_since timestamptz, p_students uuid[])
returns table (student_id uuid, kind text, facility text, place text, label text,
               started_at timestamptz, ended_at timestamptz, seconds int, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  -- 遊玩紀錄表；島嶼開拓者那一趟裡第一次過了幾步、有沒有過關，從時光幣紀錄看
  return query
  select l.student_id, 'play'::text, l.facility, l.place,
         coalesce(l.label, case when l.facility = 'island_pioneer' then public.park_island_label(l.place) end, l.place),
         l.started_at, coalesce(l.ended_at, l.last_seen),
         extract(epoch from coalesce(l.ended_at, l.last_seen) - l.started_at)::int,
         case when l.facility = 'island_pioneer' and to_regclass('public.park_coin_ledger') is not null then (
           select nullif(concat_ws('・',
                    case when count(*) filter (where c.source like 'island:' || l.place || ':s%') > 0
                         then '新過了 ' || count(*) filter (where c.source like 'island:' || l.place || ':s%') || ' 步' end,
                    case when bool_or(c.source = 'island:' || l.place || ':clear') then '第一次過關' end), '')
             from public.park_coin_ledger c
            where c.student_id = l.student_id
              and c.created_at between l.started_at and coalesce(l.ended_at, l.last_seen) + interval '1 minute')
         end
    from public.park_play_log l
   where l.started_at >= p_since and (p_students is null or l.student_id = any(p_students));

  -- 守護異世界：每一場（同一個 session_id；很舊的沒有 session_id 就用關卡＋小時分）。
  -- 一場打完才一次送上來，所以每題的時間都一樣、看不出玩多久，改在說明寫「答題幾分鐘」（每題想多久加起來）
  return query
  select a.student_id, 'level'::text, 'guardian'::text, max(a.level_id),
         (case max(a.game_id) when 'tower-defense' then '塔防' when 'tug-of-war' then '拔河對戰'
            when 'boss-raid' then '魔王戰' else coalesce(max(a.game_id), '練習') end)
         || coalesce(' 第 ' || max(lv.no) || ' 關「' || max(lv.name) || '」', ''),
         min(a.at), max(a.at), nullif(extract(epoch from max(a.at) - min(a.at))::int, 0),
         count(*) || ' 題，答對 ' || round(100.0 * count(*) filter (where a.correct) / count(*)) || '%'
         || coalesce('・答題 ' || nullif(round(sum(a.ms) / 60000.0), 0) || ' 分鐘', '')
    from public.answer_events a
    left join public.levels lv on lv.id = a.level_id
   where a.at >= p_since and (p_students is null or a.student_id = any(p_students))
   group by a.student_id, coalesce(a.session_id::text, coalesce(a.level_id, '') || coalesce(a.game_id, '') || date_trunc('hour', a.at)::text);

  -- 島嶼開拓者的舊存檔：只算這個人在遊玩紀錄上線（有第一筆島嶼紀錄）之前的
  if to_regclass('public.island_saves') is not null then
    return query execute $q$
      select s.student_id, 'save'::text, 'island_pioneer'::text, s.slot, public.park_island_label(s.slot),
             s.updated_at, s.updated_at, null::int,
             case when s.done then '過關 ' || repeat('★', s.stars) || repeat('☆', 3 - s.stars)
                  when s.step > 0 then '玩到第 ' || s.step || ' 步' else '剛開始' end
        from public.island_saves s
       where s.updated_at >= $1 and ($2 is null or s.student_id = any($2))
         and s.slot not in ('world', 'medals')
         and not exists (select 1 from public.park_play_log l
                          where l.student_id = s.student_id and l.facility = 'island_pioneer'
                            and l.started_at <= s.updated_at)
    $q$ using p_since, p_students;
  end if;

  if to_regclass('public.park_student_stamps') is not null then
    return query execute $q$
      select ss.student_id, 'stamp'::text, ss.facility, ss.stamp, '拿到勳章「' || coalesce(st.name, ss.stamp) || '」',
             ss.awarded_at, ss.awarded_at, null::int, null::text
        from public.park_student_stamps ss
        left join public.park_stamps st on st.facility = ss.facility and st.code = ss.stamp
       where ss.awarded_at >= $1 and ($2 is null or ss.student_id = any($2))
    $q$ using p_since, p_students;
  end if;
end;
$$;

-- 遊戲名字（樂園大廳不是設施）
create or replace function public.park_facility_name(p_code text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_code = 'park' then '樂園大廳'
              else coalesce((select f.name from public.park_facilities f where f.code = p_code), p_code) end;
$$;

-- 老師：一位學生最近 N 天的時間軸（最新的在上面，最多 300 筆）
create or replace function public.park_student_activity(p_student uuid, p_days int default 30)
returns table (kind text, facility text, game text, place text, label text,
               started_at timestamptz, ended_at timestamptz, seconds int, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.park_teaches_student(p_student) then raise exception '這不是你班上的學生'; end if;
  return query
  select r.kind, r.facility, public.park_facility_name(r.facility), r.place, r.label,
         r.started_at, r.ended_at, r.seconds, r.note
    from public.park_activity_rows(now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 180)),
                                   array[p_student]) r
   order by r.started_at desc
   limit 300;
end;
$$;

-- 老師：全班每個人「最後在玩什麼」（最近 60 天；勳章不算在玩）
create or replace function public.park_class_last_play(p_code text)
returns table (student_id uuid, game text, label text, at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_ids uuid[];
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  select array_agg(m.student_id) into v_ids from public.park_class_members m where m.class_code = v_code;
  if v_ids is null then return; end if;
  return query
  select distinct on (r.student_id) r.student_id, public.park_facility_name(r.facility),
         case when r.kind = 'play' and r.place = 'enter' then null else r.label end, r.ended_at
    from public.park_activity_rows(now() - interval '60 days', v_ids) r
   where r.kind <> 'stamp'
   -- 同一個時間點，有關卡名字的優先（守護異世界整趟那筆只知道「在守護異世界」）
   order by r.student_id, r.ended_at desc, (r.kind = 'play' and r.place = 'enter');
end;
$$;

-- 管理員：全站動態
create or replace function public.park_admin_activity(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 7), 1), 90);
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_since timestamptz := ((v_today - (v_days - 1))::timestamp at time zone 'Asia/Taipei');
  v jsonb;
begin
  if not public.is_admin() then raise exception '只有管理員可以看'; end if;

  with park_act as materialized (select * from public.park_activity_rows(v_since, null))
  select jsonb_build_object(
    'days', v_days,
    'log_since', (select min(l.started_at) from public.park_play_log l),
    'total_students', (select count(*) from public.students),
    -- 每天幾個人來玩（任何一個遊戲、樂園大廳都算；只拿勳章不算）
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'players', d.n) order by d.day), '[]')
        from (select g.day::date as day,
                     (select count(distinct a.student_id) from park_act a
                       where a.kind <> 'stamp' and (a.started_at at time zone 'Asia/Taipei')::date = g.day::date) as n
                from generate_series(v_today - (v_days - 1), v_today, interval '1 day') g(day)) d),
    'players', (select count(distinct a.student_id) from park_act a where a.kind <> 'stamp'),
    -- 每個遊戲：幾個人、玩了幾趟、共幾分鐘（分鐘只算遊玩紀錄表，上線前的舊資料沒有）
    'games', (
      select coalesce(jsonb_agg(x order by (x ->> 'players')::int desc), '[]') from (
        select jsonb_build_object('facility', a.facility, 'game', public.park_facility_name(a.facility),
                 'players', count(distinct a.student_id),
                 'visits', count(*) filter (where a.kind = 'play'),
                 'levels', count(*) filter (where a.kind = 'level'),
                 'minutes', round(coalesce(sum(a.seconds) filter (where a.kind = 'play'), 0) / 60.0)) as x
          from park_act a where a.kind <> 'stamp' group by a.facility) t),
    -- 最多人玩的章節、地點、關卡（不算大地圖、樂園大廳、守護異世界整趟）
    'top', (
      select coalesce(jsonb_agg(x order by (x ->> 'players')::int desc, (x ->> 'times')::int desc), '[]') from (
        select jsonb_build_object('game', public.park_facility_name(a.facility), 'label', a.label,
                 'players', count(distinct a.student_id), 'times', count(*),
                 'minutes', round(coalesce(sum(a.seconds), 0) / 60.0)) as x
          from park_act a
         where a.kind in ('play', 'level', 'save') and a.facility <> 'park'
           and a.place not in ('enter', 'map', 'world')
         group by a.facility, a.label
         order by count(distinct a.student_id) desc, count(*) desc
         limit 12) t),
    -- 最近 60 筆
    'recent', (
      select coalesce(jsonb_agg(x order by x ->> 'started_at' desc), '[]') from (
        select jsonb_build_object('student_id', a.student_id, 'nickname', s.nickname, 'login_id', s.login_id,
                 'class_code', s.class_code, 'kind', a.kind, 'game', public.park_facility_name(a.facility),
                 'label', a.label, 'started_at', a.started_at, 'ended_at', a.ended_at,
                 'seconds', a.seconds, 'note', a.note) as x
          from park_act a join public.students s on s.id = a.student_id
         where a.kind <> 'stamp'
         order by a.started_at desc limit 60) t)
  ) into v;
  return v;
end;
$$;

-- 老師「遊玩紀錄」分頁：全班每人每天、每個遊戲玩了多久（台北時間的日期；最多 35 天）
-- seconds＝遊玩紀錄表的時間（大廳不算）；plays＝幾趟／幾場（含舊紀錄，所以 10/23 前沒有時間也看得出有來玩）
create or replace function public.park_class_days(p_code text, p_days int default 7)
returns table (student_id uuid, day date, facility text, game text, seconds int, plays int, stamps int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_days  int := least(greatest(coalesce(p_days, 7), 1), 35);
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_ids   uuid[];
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  select array_agg(m.student_id) into v_ids from public.park_class_members m where m.class_code = v_code;
  if v_ids is null then return; end if;
  return query
  select r.student_id, (r.started_at at time zone 'Asia/Taipei')::date, r.facility, public.park_facility_name(r.facility),
         coalesce(sum(r.seconds) filter (where r.kind = 'play'), 0)::int,
         (count(*) filter (where r.kind in ('level', 'save') or (r.kind = 'play' and r.place <> 'enter')))::int,
         (count(*) filter (where r.kind = 'stamp'))::int
    from public.park_activity_rows(((v_today - (v_days - 1))::timestamp at time zone 'Asia/Taipei'), v_ids) r
   where r.facility <> 'park'
   group by 1, 2, 3;
end;
$$;

-- 管理員：要改哪裡（2026-10-23）。全站動態回答「多少人玩」，這個回答「大家卡在哪、玩多久、常錯什麼」。
--   island  每一章（全部時間）：開始幾人、過關幾人、沒過關的停在第幾步、平均失誤、「想一想」答對率
--   guardian 每一關（全部時間）：打過幾人、過關幾人、最遠停在這關（沒過）的人數；最近 N 天的答對率
--   words   最近 N 天全站最常錯的字（守護異世界）
--   habit   最近 N 天：來 1 天、2~3 天、4 天以上的人數；每個遊戲一趟平均幾分鐘
create or replace function public.park_admin_insights(p_days int default 14)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 14), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_island jsonb := '[]'; v_guard jsonb := '[]'; v_words jsonb := '[]'; v_habit jsonb;
begin
  if not public.is_admin() then raise exception '只有管理員可以看'; end if;

  if to_regclass('public.island_saves') is not null then
    execute $q$
      select coalesce(jsonb_agg(x order by x ->> 'slot'), '[]') from (
        select jsonb_build_object('slot', s.slot, 'label', public.park_island_label(s.slot),
                 'started', count(*), 'done', count(*) filter (where s.done),
                 'stuck', (select coalesce(jsonb_object_agg(t.step, t.n), '{}') from (
                             select s2.step, count(*) n from public.island_saves s2
                              where s2.slot = s.slot and not s2.done group by s2.step) t),
                 'mistakes', round(avg(case when jsonb_typeof(s.data -> 'mistakes') = 'number' then (s.data ->> 'mistakes')::numeric
                                            when jsonb_typeof(s.data -> 'broken') = 'number' then (s.data ->> 'broken')::numeric end), 1),
                 'last', max(s.updated_at)) as x
          from public.island_saves s
         where s.slot not in ('world', 'medals')
         group by s.slot) t
    $q$ into v_island;
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'ord')::int), '[]') into v_guard from (
    select jsonb_build_object('level', l.id, 'ord', row_number() over (order by l.chapter, l.no), 'chapter', l.chapter, 'no', l.no, 'name', l.name,
             'played', (select count(distinct a.student_id) from public.answer_events a where a.level_id = l.id),
             'cleared', (select count(*) from public.level_progress p where p.level_id = l.id and p.cleared_at is not null),
             'stopped', (select count(*) from (
                           select distinct on (a.student_id) a.student_id, a.level_id
                             from public.answer_events a join public.levels l2 on l2.id = a.level_id
                            order by a.student_id, l2.chapter desc, l2.no desc) f
                          where f.level_id = l.id
                            and not exists (select 1 from public.level_progress p where p.student_id = f.student_id and p.level_id = l.id and p.cleared_at is not null)),
             'n', count(a.*), 'ok', count(a.*) filter (where a.correct)) as x
      from public.levels l
      left join public.answer_events a on a.level_id = l.id and a.at >= v_since
     group by l.id, l.chapter, l.no, l.name) t
   where (x ->> 'played')::int > 0;

  select coalesce(jsonb_agg(x), '[]') into v_words from (
    select jsonb_build_object('word', w.word, 'zh', w.zh, 'skill', a.skill, 'n', count(*), 'bad', count(*) filter (where not a.correct),
             'kids', count(distinct a.student_id) filter (where not a.correct)) as x
      from public.answer_events a join public.words w on w.id = a.word_id
     where a.at >= v_since
     group by w.word, w.zh, a.skill
    having count(*) filter (where not a.correct) > 0
     order by count(*) filter (where not a.correct) desc, count(distinct a.student_id) desc
     limit 15) t;

  with act as materialized (select * from public.park_activity_rows(v_since, null) where kind <> 'stamp'),
  per as (select student_id, count(distinct (started_at at time zone 'Asia/Taipei')::date) d from act group by 1)
  select jsonb_build_object(
    'one', (select count(*) from per where d = 1),
    'few', (select count(*) from per where d between 2 and 3),
    'many', (select count(*) from per where d >= 4),
    'trips', (select coalesce(jsonb_agg(jsonb_build_object('game', public.park_facility_name(t.facility), 'trips', t.n, 'avg', t.avg, 'median', t.med)), '[]') from (
                select l.facility, count(*) n,
                       round(avg(extract(epoch from coalesce(l.ended_at, l.last_seen) - l.started_at)) / 60.0, 1) avg,
                       round((percentile_cont(0.5) within group (order by extract(epoch from coalesce(l.ended_at, l.last_seen) - l.started_at)) / 60.0)::numeric, 1) med
                  from public.park_play_log l
                 where l.started_at >= v_since and l.facility <> 'park' and l.place not in ('map', 'world')
                 group by l.facility) t)) into v_habit;

  return jsonb_build_object('days', v_days, 'island', v_island, 'guardian', v_guard, 'words', v_words, 'habit', v_habit);
end;
$$;

revoke all on function
  public.park_island_label(text), public.park_activity_rows(timestamptz, uuid[]), public.park_facility_name(text),
  public.park_play_start(text, text, text), public.park_play_beat(bigint, boolean),
  public.park_student_activity(uuid, int), public.park_class_last_play(text), public.park_admin_activity(int),
  public.park_class_days(text, int), public.park_admin_insights(int)
  from public, anon;
grant execute on function
  public.park_play_start(text, text, text), public.park_play_beat(bigint, boolean),
  public.park_student_activity(uuid, int), public.park_class_last_play(text), public.park_admin_activity(int),
  public.park_class_days(text, int), public.park_admin_insights(int)
  to authenticated;
