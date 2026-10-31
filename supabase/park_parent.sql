-- =============================================================================
-- 時空冒險樂園：爸媽任務與監護人（2026-10-30「家長任務詳細規劃」，Chuck 全部照建議）
-- =============================================================================
--
-- 不強制綁家長。孩子用禮物拜託爸媽，爸媽做一次就送孩子東西，任務不限天數、隨時都能做。
-- 綁定記在 park_guardians（監護人），跟「帳號、班級與權限盤點」建議的監護人是同一張表：
-- 改密碼、看孩子在哪些班那些權限之後由那邊決定，這份只用它判斷「誰是這個孩子的爸媽」。
-- 綁好的同時也開一個家庭班把孩子加進去，所以後台原本的全班總覽、細節頁、試煉卷都照常能用。
--
-- 兩種綁法：
--   家長先看到：後台「幫孩子開帳號」park_parent_create_child → 孩子帳號直接開在家庭班、自動綁好
--   孩子先玩：  孩子按「拿給爸媽」拿到一次性家長碼（14 天）→ 爸媽掃 QR、註冊後 park_parent_redeem
--               （碼是孩子自己產生、自己拿給爸媽的，就算孩子確認過了）
--
-- 爸媽任務（伺服器看紀錄判斷，孩子打開卡片時 park_parent_me 自動發獎）：
--   link    和爸媽連起來        → 神秘蛋：孵出一隻還沒有的夥伴（都有了改送 100 時光幣）
--   view    爸媽看過我的冒險    → 100 時光幣
--   sticker 爸媽送我鼓勵貼紙    → 親子長椅（寵物島傢俱）
--   goal    爸媽幫我訂本週目標  → 達成那週送 30 時光幣（每週都能再訂）
--   app     把樂園放到桌面      → 50 時光幣（park_coins.sql 的 park_app_home 發，這裡只顯示）
--   每週    週末聯絡簿          → 爸媽簽名送 30 時光幣，每簽滿 4 次再送全家福相框（寵物島傢俱）
--
--   孩子：park_parent_code()、park_parent_me()
--   爸媽：park_parent_redeem(code)、park_parent_create_child(login, pw, nick)、park_parent_kids()、
--         park_parent_view(student)、park_parent_sticker(student, sticker)、park_parent_goal(student, goal)、
--         park_parent_sign(student)
--
-- 套用順序：schema.sql → park_accounts.sql → park_teacher.sql → park_passport.sql → park_pet.sql
--          → park_coins.sql → park_playlog.sql → 這份（之後重跑都可以）

-- -----------------------------------------------------------------------------
-- 1. 資料表
-- -----------------------------------------------------------------------------
create table if not exists public.park_guardians (
  student_id uuid not null references public.students(id) on delete cascade,
  guardian   uuid not null references public.teachers(user_id) on delete cascade,
  via        text not null check (via in ('create', 'code')),
  created_at timestamptz not null default now(),
  primary key (student_id, guardian)
);
create index if not exists park_guardians_guardian on public.park_guardians(guardian);

create table if not exists public.park_parent_codes (
  code       text primary key check (code ~ '^[A-Z2-9]{6}$'),
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  used_by    uuid
);
create index if not exists park_parent_codes_student on public.park_parent_codes(student_id);

-- 爸媽做過的事。week＝那一週的星期一（台灣時間）
create table if not exists public.park_parent_events (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  guardian   uuid not null,
  kind       text not null check (kind in ('view', 'sticker', 'goal', 'sign')),
  week       date not null,
  data       text,                              -- sticker：貼紙代號；goal：目標代號
  seen       boolean not null default false,    -- 孩子看過了（貼紙、簽名跳通知用）
  at         timestamptz not null default now()
);
create index if not exists park_parent_events_student on public.park_parent_events(student_id, kind, week);
create unique index if not exists park_parent_events_once on public.park_parent_events(student_id, week, kind)
  where kind in ('goal', 'sign');

-- 一次性的獎（神秘蛋）發過沒
create table if not exists public.park_parent_rewards (
  student_id uuid not null references public.students(id) on delete cascade,
  task       text not null,
  at         timestamptz not null default now(),
  primary key (student_id, task)
);

alter table public.park_guardians     enable row level security;
alter table public.park_parent_rewards enable row level security;
alter table public.park_parent_codes  enable row level security;
alter table public.park_parent_events enable row level security;
-- 沒有任何 policy：只能透過下面的函式讀寫
revoke all on public.park_guardians, public.park_parent_codes, public.park_parent_events, public.park_parent_rewards from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. 小工具
-- -----------------------------------------------------------------------------
create or replace function public.park_parent_week()
returns date language sql stable set search_path = public, pg_temp as $$
  select (public.park_week_start() at time zone 'Asia/Taipei')::date;
$$;

create or replace function public.park_is_guardian(p_student uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.park_guardians g where g.student_id = p_student and g.guardian = auth.uid());
$$;

-- 本週目標（三選一）與達成沒
create or replace function public.park_parent_goal_name(p_goal text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_goal when 'days3' then '這週來玩 3 天' when 'stamp2' then '這週拿到 2 個護照章'
                     when 'min60' then '這週玩滿 60 分鐘' end;
$$;
create or replace function public.park_parent_week_stats(p_student uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'days', (select count(distinct (l.started_at at time zone 'Asia/Taipei')::date)::int from public.park_play_log l
              where l.student_id = p_student and l.started_at >= public.park_week_start()),
    'minutes', (select coalesce(round(sum(extract(epoch from (l.last_seen - l.started_at))) / 60), 0)::int
                  from public.park_play_log l
                 where l.student_id = p_student and l.started_at >= public.park_week_start() and l.facility <> 'park'),
    'stamps', (select count(*)::int from public.park_student_stamps x
                where x.student_id = p_student and x.awarded_at >= public.park_week_start()),
    'places', (select coalesce(jsonb_agg(distinct coalesce(f.name, l.facility)), '[]'::jsonb)
                 from public.park_play_log l left join public.park_facilities f on f.code = l.facility
                where l.student_id = p_student and l.started_at >= public.park_week_start() and l.facility <> 'park'));
$$;
create or replace function public.park_parent_goal_met(p_goal text, p_stats jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case p_goal when 'days3' then (p_stats ->> 'days')::int >= 3
                     when 'stamp2' then (p_stats ->> 'stamps')::int >= 2
                     when 'min60' then (p_stats ->> 'minutes')::int >= 60 else false end;
$$;

-- 家長的家庭班：有就用第一個，沒有就開一個「○○的家」
create or replace function public.park_parent_home()
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  select c.code into v_code from public.classes c join public.park_class_settings s on s.class_code = c.code
   where c.owner = auth.uid() and s.kind = 'home' order by c.created_at limit 1;
  if v_code is null then
    v_code := public.park_create_class(
      left(coalesce((select nullif(btrim(t.display_name), '') from public.teachers t where t.user_id = auth.uid()), '我') , 17) || '的家',
      null, 'home');
  end if;
  return v_code;
end;
$$;

-- 綁成監護人＋放進家庭班（一個孩子最多 2 位監護人）
create or replace function public.park_parent_bind(p_student uuid, p_via text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_home text; v_bad text;
begin
  if not public.park_is_guardian(p_student) then
    if (select count(*) from public.park_guardians g where g.student_id = p_student) >= 2 then
      raise exception '這個孩子已經有 2 位爸媽連起來了';
    end if;
    insert into public.park_guardians (student_id, guardian, via) values (p_student, auth.uid(), p_via);
  end if;
  v_home := public.park_parent_home();
  if not exists (select 1 from public.park_class_members m where m.class_code = v_home and m.student_id = p_student) then
    v_bad := public.park_class_full_problem(v_home);
    if v_bad is not null then raise exception '%', v_bad; end if;
    if (select s.class_code from public.students s where s.id = p_student) is null then
      update public.students set class_code = v_home where id = p_student;   -- 觸發器會補成員紀錄
    else
      insert into public.park_class_members (class_code, student_id) values (v_home, p_student);
    end if;
  end if;
  perform public.park_log('parent_bind', v_home, p_student::text, jsonb_build_object('via', p_via));
  return v_home;
end;
$$;

-- 孩子領獎（同一個 source 只發一次）
create or replace function public.park_parent_award(p_student uuid, p_task text, p_week date default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sp text; v_n int; v_signs int;
begin
  if p_task = 'link' then
    insert into public.park_parent_rewards (student_id, task) values (p_student, 'link') on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then return null; end if;
    select s.code into v_sp from public.park_pet_species s
     where s.starter and not exists (select 1 from public.park_pets p where p.student_id = p_student and p.species = s.code)
     order by random() limit 1;
    if v_sp is null then
      perform public.park_coin_grant(p_student, 'parent:link', 100, null, '爸媽任務：和爸媽連起來');
      return '神秘蛋孵出 100 時光幣（夥伴你都有了）';
    end if;
    insert into public.park_pets (student_id, species, name, active)
    values (p_student, v_sp, (select name from public.park_pet_species where code = v_sp),
            not exists (select 1 from public.park_pets p where p.student_id = p_student))
    on conflict (student_id, species) do nothing;
    return '神秘蛋孵出了「' || (select name from public.park_pet_species where code = v_sp) || '」！去寵物島看看';
  elsif p_task = 'view' then
    v_n := public.park_coin_grant(p_student, 'parent:view', 100, null, '爸媽任務：爸媽看過我的冒險');
    return case when v_n > 0 then '爸媽看過你的冒險了，+100 時光幣' end;
  elsif p_task = 'sticker' then
    insert into public.park_student_furniture (student_id, item) values (p_student, 'family-bench') on conflict do nothing;
    get diagnostics v_n = row_count;
    return case when v_n > 0 then '收到爸媽的貼紙，送你寵物島傢俱「親子長椅」' end;
  elsif p_task = 'goal' then
    v_n := public.park_coin_grant(p_student, 'parent:goal:' || p_week, 30, null, '爸媽任務：達成本週目標');
    return case when v_n > 0 then '本週目標達成！+30 時光幣' end;
  elsif p_task = 'sign' then
    v_n := public.park_coin_grant(p_student, 'parent:sign:' || p_week, 30, null, '週末聯絡簿：爸媽簽名');
    if v_n = 0 then return null; end if;
    select count(*) into v_signs from public.park_parent_events e where e.student_id = p_student and e.kind = 'sign';
    if v_signs >= 4 then
      insert into public.park_student_furniture (student_id, item) values (p_student, 'family-photo') on conflict do nothing;
      get diagnostics v_n = row_count;
      if v_n > 0 then return '爸媽簽了聯絡簿，+30 時光幣；簽滿 4 次，再送「全家福相框」！'; end if;
    end if;
    return '爸媽簽了週末聯絡簿，+30 時光幣';
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. 孩子
-- -----------------------------------------------------------------------------

-- 拿給爸媽的一次性家長碼：還有沒用過、14 天內的就沿用
create or replace function public.park_parent_code()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_code text; v_at timestamptz;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  select c.code, c.created_at into v_code, v_at from public.park_parent_codes c
   where c.student_id = v_me and c.used_at is null and c.created_at > now() - interval '13 days'
   order by c.created_at desc limit 1;
  if v_code is null then
    loop
      v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 31)::int + 1, 1), '')
                   from generate_series(1, 6));
      exit when not exists (select 1 from public.park_parent_codes c where c.code = v_code);
    end loop;
    insert into public.park_parent_codes (code, student_id) values (v_code, v_me) returning created_at into v_at;
  end if;
  return jsonb_build_object('code', v_code, 'until', v_at + interval '14 days');
end;
$$;

-- 爸媽任務卡要的一整包；做到了就在這裡發獎，fresh 是這次才拿到的
create or replace function public.park_parent_me()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := public.current_student_id(); v_wk date := public.park_parent_week();
  v_fresh text[] := '{}'; v_t text; v_goal text; v_stats jsonb; v_linked boolean; v_e record;
begin
  if v_me is null then return null; end if;
  v_linked := exists (select 1 from public.park_guardians g where g.student_id = v_me);
  v_stats := public.park_parent_week_stats(v_me);
  select e.data into v_goal from public.park_parent_events e where e.student_id = v_me and e.kind = 'goal' and e.week = v_wk;

  if v_linked then v_t := public.park_parent_award(v_me, 'link'); if v_t is not null then v_fresh := v_fresh || v_t; end if; end if;
  if exists (select 1 from public.park_parent_events e where e.student_id = v_me and e.kind = 'view') then
    v_t := public.park_parent_award(v_me, 'view'); if v_t is not null then v_fresh := v_fresh || v_t; end if;
  end if;
  if exists (select 1 from public.park_parent_events e where e.student_id = v_me and e.kind = 'sticker') then
    v_t := public.park_parent_award(v_me, 'sticker'); if v_t is not null then v_fresh := v_fresh || v_t; end if;
  end if;
  if v_goal is not null and public.park_parent_goal_met(v_goal, v_stats) then
    v_t := public.park_parent_award(v_me, 'goal', v_wk); if v_t is not null then v_fresh := v_fresh || v_t; end if;
  end if;
  -- 簽名、貼紙：還沒看過的一筆一筆說
  for v_e in update public.park_parent_events e set seen = true
              where e.student_id = v_me and not e.seen and e.kind in ('sticker', 'sign')
             returning e.kind, e.week, e.data loop
    if v_e.kind = 'sign' then
      v_t := public.park_parent_award(v_me, 'sign', v_e.week); if v_t is not null then v_fresh := v_fresh || v_t; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'linked', v_linked,
    'parents', (select coalesce(jsonb_agg(t.display_name order by g.created_at), '[]'::jsonb)
                  from public.park_guardians g join public.teachers t on t.user_id = g.guardian where g.student_id = v_me),
    'tasks', jsonb_build_array(
      jsonb_build_object('code', 'link', 'done', v_linked),
      jsonb_build_object('code', 'view', 'done', exists (select 1 from public.park_parent_events e where e.student_id = v_me and e.kind = 'view')),
      jsonb_build_object('code', 'sticker', 'done', exists (select 1 from public.park_parent_events e where e.student_id = v_me and e.kind = 'sticker')),
      jsonb_build_object('code', 'goal', 'done', exists (select 1 from public.park_coin_ledger l where l.student_id = v_me and l.source like 'parent:goal:%')),
      jsonb_build_object('code', 'app', 'done', exists (select 1 from public.park_coin_ledger l where l.student_id = v_me and l.source = 'app:home'))),
    'goal', case when v_goal is null then null else jsonb_build_object('code', v_goal, 'name', public.park_parent_goal_name(v_goal),
                 'met', public.park_parent_goal_met(v_goal, v_stats)) end,
    'stats', v_stats,
    'signed', exists (select 1 from public.park_parent_events e where e.student_id = v_me and e.kind = 'sign' and e.week = v_wk),
    'signs', (select count(*)::int from public.park_parent_events e where e.student_id = v_me and e.kind = 'sign'),
    'stickers', (select coalesce(jsonb_agg(jsonb_build_object('sticker', e.data, 'from', t.display_name, 'at', e.at) order by e.at desc), '[]'::jsonb)
                   from (select * from public.park_parent_events where student_id = v_me and kind = 'sticker' order by at desc limit 30) e
                   left join public.teachers t on t.user_id = e.guardian),
    'fresh', to_jsonb(v_fresh));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. 爸媽（後台）
-- -----------------------------------------------------------------------------

-- 用孩子給的家長碼連起來
create or replace function public.park_parent_redeem(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.park_parent_codes%rowtype; v_home text;
begin
  perform public.park_require_staff();
  select * into v_c from public.park_parent_codes c where c.code = upper(btrim(coalesce(p_code, '')));
  if v_c.code is null then raise exception '找不到這組家長碼，請孩子再按一次「拿給爸媽」'; end if;
  if v_c.used_at is not null and v_c.used_by is distinct from auth.uid() then raise exception '這組家長碼已經用過了，請孩子再按一次「拿給爸媽」'; end if;
  if v_c.created_at < now() - interval '14 days' then raise exception '這組家長碼過期了，請孩子再按一次「拿給爸媽」'; end if;
  v_home := public.park_parent_bind(v_c.student_id, 'code');
  update public.park_parent_codes set used_at = coalesce(used_at, now()), used_by = auth.uid() where code = v_c.code;
  return jsonb_build_object('student', v_c.student_id, 'home', v_home,
                            'nickname', (select s.nickname from public.students s where s.id = v_c.student_id));
end;
$$;

-- 家長幫孩子開帳號：開在家庭班、自動綁好
create or replace function public.park_parent_create_child(p_login_id text, p_password text, p_nickname text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_login text := lower(btrim(coalesce(p_login_id, ''))); v_nick text := btrim(coalesce(p_nickname, ''));
  v_home text; v_bad text; v_id uuid;
begin
  perform public.park_require_staff();
  if v_login !~ '^[a-z0-9_]{3,16}$' then raise exception '帳號要 3 到 16 個字，只能用英文字母、數字和底線'; end if;
  v_bad := public.nickname_problem(v_nick); if v_bad is not null then raise exception '%', v_bad; end if;
  v_bad := public.password_problem(p_password, v_login); if v_bad is not null then raise exception '%', v_bad; end if;
  if exists (select 1 from public.students s where s.login_id = v_login) then raise exception '這個帳號已經有人用了，換一個'; end if;
  v_home := public.park_parent_home();
  v_bad := public.park_class_full_problem(v_home); if v_bad is not null then raise exception '%', v_bad; end if;
  if exists (select 1 from public.students s where s.class_code = v_home and s.nickname = v_nick) then
    raise exception '家裡已經有人叫這個暱稱了，換一個';
  end if;
  insert into public.students (login_id, pw_hash, nickname, class_code)
  values (v_login, extensions.crypt(lower(p_password), extensions.gen_salt('bf')), v_nick, v_home)
  returning id into v_id;
  insert into public.characters (student_id) values (v_id) on conflict (student_id) do nothing;
  insert into public.park_guardians (student_id, guardian, via) values (v_id, auth.uid(), 'create');
  perform public.park_log('parent_create_child', v_home, v_id::text, jsonb_build_object('login', v_login));
  return jsonb_build_object('student', v_id, 'home', v_home, 'login', v_login, 'nickname', v_nick);
end;
$$;

-- 後台「孩子在等你」：我的每個孩子、還沒做的爸媽任務、本週摘要
create or replace function public.park_parent_kids()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_wk date := public.park_parent_week();
begin
  perform public.park_require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'nickname', s.nickname, 'login', s.login_id,
      'viewed', exists (select 1 from public.park_parent_events e where e.student_id = s.id and e.kind = 'view'),
      'stickers', (select count(*)::int from public.park_parent_events e where e.student_id = s.id and e.kind = 'sticker'),
      'stickers_today', (select count(*)::int from public.park_parent_events e where e.student_id = s.id and e.kind = 'sticker'
                           and e.guardian = auth.uid() and e.at >= date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei'),
      'goal', (select e.data from public.park_parent_events e where e.student_id = s.id and e.kind = 'goal' and e.week = v_wk),
      'signed', exists (select 1 from public.park_parent_events e where e.student_id = s.id and e.kind = 'sign' and e.week = v_wk),
      'signs', (select count(*)::int from public.park_parent_events e where e.student_id = s.id and e.kind = 'sign'),
      'week', public.park_parent_week_stats(s.id)) order by g.created_at)
    from public.park_guardians g join public.students s on s.id = g.student_id
   where g.guardian = auth.uid()), '[]'::jsonb);
end;
$$;

create or replace function public.park_parent_need(p_student uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.park_require_staff();
  if not public.park_is_guardian(p_student) then raise exception '這個孩子還沒跟你連起來'; end if;
end;
$$;

-- 爸媽打開孩子的細節頁（一週記一次就夠）
create or replace function public.park_parent_view(p_student uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.park_is_guardian(p_student) then return; end if;   -- 老師看自己班的孩子不算
  if not exists (select 1 from public.park_parent_events e
                  where e.student_id = p_student and e.kind = 'view' and e.week = public.park_parent_week()) then
    insert into public.park_parent_events (student_id, guardian, kind, week, seen) values (p_student, auth.uid(), 'view', public.park_parent_week(), true);
  end if;
end;
$$;

-- 送貼紙：6 種、每位爸媽每天最多送一個孩子 3 張
create or replace function public.park_parent_sticker(p_student uuid, p_sticker text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.park_parent_need(p_student);
  if p_sticker not in ('great', 'cheer', 'better', 'careful', 'love', 'play') then raise exception '沒有這種貼紙'; end if;
  if (select count(*) from public.park_parent_events e where e.student_id = p_student and e.kind = 'sticker' and e.guardian = auth.uid()
        and e.at >= date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei') >= 3 then
    raise exception '今天已經送 3 張了，明天再送吧';
  end if;
  insert into public.park_parent_events (student_id, guardian, kind, week, data) values (p_student, auth.uid(), 'sticker', public.park_parent_week(), p_sticker);
end;
$$;

-- 訂本週目標（這週訂了就不能改，避免一直換到達成的那個）
create or replace function public.park_parent_goal(p_student uuid, p_goal text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.park_parent_need(p_student);
  if public.park_parent_goal_name(p_goal) is null then raise exception '沒有這個目標'; end if;
  insert into public.park_parent_events (student_id, guardian, kind, week, data, seen)
  values (p_student, auth.uid(), 'goal', public.park_parent_week(), p_goal, true)
  on conflict (student_id, week, kind) where kind in ('goal', 'sign') do nothing;
  if not found then raise exception '這週已經訂好目標了，下週一可以再訂'; end if;
end;
$$;

-- 簽週末聯絡簿（一週一次，哪一天簽都可以）
create or replace function public.park_parent_sign(p_student uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.park_parent_need(p_student);
  insert into public.park_parent_events (student_id, guardian, kind, week)
  values (p_student, auth.uid(), 'sign', public.park_parent_week())
  on conflict (student_id, week, kind) where kind in ('goal', 'sign') do nothing;
  if not found then raise exception '這週已經簽過了'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_parent_week(), public.park_is_guardian(uuid), public.park_parent_goal_name(text),
  public.park_parent_week_stats(uuid), public.park_parent_goal_met(text, jsonb), public.park_parent_home(),
  public.park_parent_bind(uuid, text), public.park_parent_award(uuid, text, date), public.park_parent_need(uuid),
  public.park_parent_code(), public.park_parent_me(), public.park_parent_redeem(text),
  public.park_parent_create_child(text, text, text), public.park_parent_kids(), public.park_parent_view(uuid),
  public.park_parent_sticker(uuid, text), public.park_parent_goal(uuid, text), public.park_parent_sign(uuid)
  from public, anon, authenticated;
grant execute on function
  public.park_parent_code(), public.park_parent_me(), public.park_parent_redeem(text),
  public.park_parent_create_child(text, text, text), public.park_parent_kids(), public.park_parent_view(uuid),
  public.park_parent_sticker(uuid, text), public.park_parent_goal(uuid, text), public.park_parent_sign(uuid)
  to authenticated;
