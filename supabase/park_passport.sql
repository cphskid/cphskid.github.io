-- =============================================================================
-- 時空冒險樂園 P4：樂園護照與頭像
--
-- 護照：每個設施一頁，完成值得紀念的事就蓋一個章（規劃書「遊戲接入規則」第 4 條）。
-- 頭像：小朋友挑一個 Q 版頭像和頭像框，一開始 12 個可以選，其他的靠蓋章解鎖。
--
-- 一樣只「加表、加函式」，不改也不刪守護異世界的任何東西。
--
-- 怎麼套：Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。
-- 順序：守護異世界 schema.sql → park_accounts.sql → park_teacher.sql → 這份
--       （→ 各遊戲自己的 SQL，例如島嶼開拓者的 island_pioneer.sql）。
-- 守護異世界重跑 schema.sql 之後，樂園這三份都要再跑一次（它會收回權限）。
--
-- 章怎麼蓋上去，有兩條路：
--   1. 遊戲在學生完成時呼叫 park_award_stamp(設施, 章)（島嶼開拓者過完一章就叫）。
--   2. 設施登記一支 <前綴>_earned_stamps(學生) 回傳「他該拿到哪些章」，樂園打開時自己補蓋。
--      守護異世界走這條：過關是伺服器判定的（level_progress），不用改英文遊戲一行程式。
-- 有登記第 2 條的設施，第 1 條也要對得上第 2 條才蓋得下去，小朋友沒辦法自己亂叫函式蓋章。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------

-- 設施多一欄：「該拿到哪些章」的函式名稱，形狀固定 <前綴>_earned_stamps(uuid) returns setof text
alter table public.park_facilities add column if not exists stamps_fn text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'park_facilities_stamps_fn_check') then
    alter table public.park_facilities add constraint park_facilities_stamps_fn_check
      check (stamps_fn ~ '^[a-z][a-z0-9_]*_earned_stamps$');
  end if;
end $$;

-- 章的定義：哪個設施、叫什麼、怎麼拿到、圖。只有登記的章蓋得上去。
create table if not exists public.park_stamps (
  facility text not null references public.park_facilities(code) on delete cascade on update cascade,
  code     text not null check (code ~ '^[a-z0-9][a-z0-9_-]{0,30}$'),
  name     text not null,
  hint     text not null default '',      -- 怎麼拿到（護照上沒蓋到的格子會顯示）
  art      text,                          -- 樂園網站裡的圖，例如 img/stamp/guardian-first.webp
  sort     int  not null default 0,
  active   boolean not null default true, -- false＝遊戲還沒做好這部分，護照上顯示「即將開放」
  primary key (facility, code)
);

-- 學生拿到的章。seen＝打開護照看過了（沒看過的會有「新」的動畫）。
create table if not exists public.park_student_stamps (
  student_id uuid not null references public.students(id) on delete cascade,
  facility   text not null,
  stamp      text not null,
  awarded_at timestamptz not null default now(),
  seen       boolean not null default false,
  primary key (student_id, facility, stamp),
  foreign key (facility, stamp) references public.park_stamps(facility, code) on delete cascade on update cascade
);

-- 頭像與頭像框，以及怎麼解鎖。圖固定在 img/avatar/<code>.webp；框是網頁畫的。
create table if not exists public.park_rewards (
  code        text primary key check (code ~ '^[a-z][a-z0-9-]{1,30}$'),
  kind        text not null check (kind in ('avatar', 'frame')),
  name        text not null,
  need_stamps int  not null default 0 check (need_stamps >= 0),  -- 總共要幾個章
  need_page   text,                     -- 要蓋滿哪個設施的那一頁；'*'＝蓋滿任何一頁
  sort        int  not null default 0
);

-- 學生的樂園外觀
create table if not exists public.park_profiles (
  student_id uuid primary key references public.students(id) on delete cascade,
  avatar     text references public.park_rewards(code) on update cascade on delete set null,
  frame      text references public.park_rewards(code) on update cascade on delete set null,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. 初始資料
--    章與獎勵的名稱、圖、條件是設計資料，重跑會更新；
--    章的 active（開放了沒）只在第一次寫入，之後交給遊戲自己的 SQL 或管理員。
-- -----------------------------------------------------------------------------
insert into public.park_stamps as s (facility, code, name, hint, art, sort, active) values
  ('guardian', 'first',   '第一次過關',     '打贏任何一關',             'img/stamp/guardian-first.webp',   1, true),
  ('guardian', 'clear5',  '過了 5 關',      '總共過 5 關',               'img/stamp/guardian-clear5.webp',  2, true),
  ('guardian', 'ch1',     '草地城堡全破',   '第一章每一關都過',         'img/stamp/guardian-ch1.webp',     3, true),
  ('guardian', 'clear30', '過了 30 關',     '總共過 30 關',              'img/stamp/guardian-clear30.webp', 4, true),
  ('guardian', 'ch2',     '雪地神殿全破',   '第二章每一關都過',         'img/stamp/guardian-ch2.webp',     5, true),
  ('guardian', 'clear60', '過了 60 關',     '總共過 60 關',              'img/stamp/guardian-clear60.webp', 6, true),
  ('guardian', 'ch3',     '草原木堡全破',   '第三章每一關都過',         'img/stamp/guardian-ch3.webp',     7, true),
  ('guardian', 'stars20', '20 關三顆星',    '拿到三顆星的關卡有 20 關', 'img/stamp/guardian-stars20.webp', 8, true),
  ('island_pioneer', 'ch1', '島嶼的第一道火光', '完成第一章（史前）',     'img/stamp/island-ch1.webp', 1, false),
  ('island_pioneer', 'ch2', '山林與部落',       '完成第二章（原住民族）', 'img/stamp/island-ch2.webp', 2, false),
  ('island_pioneer', 'ch3', '大航海時代',       '完成第三章（荷西）',     'img/stamp/island-ch3.webp', 3, false),
  ('island_pioneer', 'ch4', '東寧屯田',         '完成第四章（鄭氏）',     'img/stamp/island-ch4.webp', 4, false),
  ('island_pioneer', 'ch5', '八堡圳',           '完成第五章（清領）',     'img/stamp/island-ch5.webp', 5, true),
  ('island_pioneer', 'ch6', '開港與鐵路',       '完成第六章（清末）',     'img/stamp/island-ch6.webp', 6, false),
  ('island_pioneer', 'ch7', '縱貫與大圳',       '完成第七章（日治）',     'img/stamp/island-ch7.webp', 7, false),
  ('island_pioneer', 'end', '今天的島嶼',       '完成終章（戰後）',       'img/stamp/island-end.webp', 8, false)
on conflict (facility, code) do update
  set name = excluded.name, hint = excluded.hint, art = excluded.art, sort = excluded.sort;

insert into public.park_rewards (code, kind, name, need_stamps, need_page, sort) values
  -- 一開始就能選的 12 個
  ('bear',          'avatar', '台灣黑熊',   0, null,  1),
  ('deer',          'avatar', '梅花鹿',     0, null,  2),
  ('fox',           'avatar', '飛行員狐狸', 0, null,  3),
  ('leopard-cat',   'avatar', '石虎',       0, null,  4),
  ('magpie',        'avatar', '台灣藍鵲',   0, null,  5),
  ('owl',           'avatar', '貓頭鷹',     0, null,  6),
  ('panda',         'avatar', '熊貓',       0, null,  7),
  ('pangolin',      'avatar', '穿山甲',     0, null,  8),
  ('rabbit',        'avatar', '小白兔',     0, null,  9),
  ('squirrel',      'avatar', '松鼠',       0, null, 10),
  ('wolf',          'avatar', '小灰狼',     0, null, 11),
  ('hamster',       'avatar', '倉鼠偵探',   0, null, 12),
  -- 蓋章解鎖
  ('corgi',         'avatar', '柯基',       1, null, 13),
  ('penguin',       'avatar', '企鵝紳士',   2, null, 14),
  ('sheep',         'avatar', '綿羊',       3, null, 15),
  ('hedgehog',      'avatar', '刺蝟背包客', 4, null, 16),
  ('koala',         'avatar', '無尾熊',     5, null, 17),
  ('turtle',        'avatar', '海龜',       6, null, 18),
  ('dolphin',       'avatar', '海豚船長',   8, null, 19),
  ('tiger',         'avatar', '小老虎',    10, null, 20),
  ('leopard-cat-2', 'avatar', '石虎探險家',12, null, 21),
  ('rabbit-2',      'avatar', '星星兔',    14, null, 22),
  -- 蓋滿一頁解鎖（規劃書：蓋滿一頁解鎖一個新頭像或頭像框）
  ('panda-2',       'avatar', '耳機熊貓',   0, 'guardian',       23),
  ('pangolin-2',    'avatar', '羅盤穿山甲', 0, 'island_pioneer', 24),
  -- 頭像框
  ('plain',   'frame', '木頭框',   0, null, 1),
  ('sky',     'frame', '天空框',   3, null, 2),
  ('silver',  'frame', '銀框',     6, null, 3),
  ('gold',    'frame', '金框',     0, '*',  4),
  ('rainbow', 'frame', '彩虹框',  15, null, 5)
on conflict (code) do update
  set kind = excluded.kind, name = excluded.name, need_stamps = excluded.need_stamps,
      need_page = excluded.need_page, sort = excluded.sort;

-- 「該拿到哪些章」的函式：只補空的，不蓋掉管理員改過的
update public.park_facilities set stamps_fn = 'guardian_earned_stamps'
 where code = 'guardian' and stamps_fn is null;
update public.park_facilities set stamps_fn = 'island_earned_stamps'
 where code = 'island_pioneer' and stamps_fn is null;

-- -----------------------------------------------------------------------------
-- 3. 讀取規則：章與獎勵的目錄大家都看得到；學生的章與頭像，本人和他的老師看得到。
--    寫入一律走底下的函式。
-- -----------------------------------------------------------------------------
alter table public.park_stamps         enable row level security;
alter table public.park_student_stamps enable row level security;
alter table public.park_rewards        enable row level security;
alter table public.park_profiles       enable row level security;

revoke all on public.park_stamps, public.park_student_stamps, public.park_rewards, public.park_profiles
  from anon, authenticated;
grant select on public.park_stamps, public.park_rewards to anon, authenticated;
grant select on public.park_student_stamps, public.park_profiles to authenticated;

-- 讀取規則要用：是我自己，或是我任何一班的學生（park_teaches_student 不開給一般人直接叫，包一層）
create or replace function public.park_can_see_student(p_student uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_student = public.current_student_id() or public.park_teaches_student(p_student);
$$;
revoke all on function public.park_can_see_student(uuid) from public, anon, authenticated;
grant execute on function public.park_can_see_student(uuid) to authenticated;

drop policy if exists park_stamps_read on public.park_stamps;
create policy park_stamps_read on public.park_stamps for select to anon, authenticated using (true);
drop policy if exists park_rewards_read on public.park_rewards;
create policy park_rewards_read on public.park_rewards for select to anon, authenticated using (true);
drop policy if exists park_student_stamps_read on public.park_student_stamps;
create policy park_student_stamps_read on public.park_student_stamps for select to authenticated
  using (public.park_can_see_student(student_id));
drop policy if exists park_profiles_read on public.park_profiles;
create policy park_profiles_read on public.park_profiles for select to authenticated
  using (public.park_can_see_student(student_id));

-- -----------------------------------------------------------------------------
-- 4. 小幫手（不開給人直接叫）
-- -----------------------------------------------------------------------------

-- 某個設施「該拿到的章」。函式還沒裝、或執行出錯，回 null（＝不知道）。
create or replace function public.park_earned(p_student uuid, p_facility text)
returns text[] language plpgsql security definer set search_path = public, pg_temp as $$
declare v_fn text; v_out text[];
begin
  select f.stamps_fn into v_fn from public.park_facilities f where f.code = p_facility;
  if v_fn is null or not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_fn) then
    return null;
  end if;
  begin
    execute format('select coalesce(array_agg(x::text), ''{}'') from public.%I($1) x', v_fn)
      into v_out using p_student;
  exception when others then
    return null;
  end;
  return v_out;
end;
$$;

-- 把各遊戲「該拿到」的章補蓋上去。回傳這次新蓋了幾個。
create or replace function public.park_stamp_sync(p_student uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare f record; v_codes text[]; v_n int := 0; v_k int;
begin
  if p_student is null then return 0; end if;
  for f in select fa.code from public.park_facilities fa where fa.stamps_fn is not null loop
    v_codes := public.park_earned(p_student, f.code);
    continue when v_codes is null or cardinality(v_codes) = 0;
    insert into public.park_student_stamps (student_id, facility, stamp)
    select p_student, s.facility, s.code
      from public.park_stamps s
     where s.facility = f.code and s.active and s.code = any(v_codes)
    on conflict do nothing;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end;
$$;

-- 這一頁蓋滿了沒（「即將開放」的章也算在內，所以要等遊戲全部做好才可能蓋滿）
create or replace function public.park_page_full(p_student uuid, p_facility text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.park_stamps s where s.facility = p_facility)
     and not exists (
       select 1 from public.park_stamps s
        where s.facility = p_facility
          and not exists (select 1 from public.park_student_stamps x
                           where x.student_id = p_student and x.facility = s.facility and x.stamp = s.code));
$$;

-- 這個學生解鎖了哪些頭像與框
create or replace function public.park_unlocked(p_student uuid)
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  with n as (select count(*) as stamps from public.park_student_stamps x where x.student_id = p_student),
  full_pages as (
    select f.code from public.park_facilities f where public.park_page_full(p_student, f.code)
  )
  select r.code
    from public.park_rewards r, n
   where r.need_stamps <= n.stamps
     and (r.need_page is null
          or (r.need_page = '*' and exists (select 1 from full_pages))
          or r.need_page in (select code from full_pages));
$$;

-- -----------------------------------------------------------------------------
-- 5. 給遊戲叫的：蓋章
--    學生完成值得紀念的事時呼叫。回傳 {ok, new, name, art, unlocked:[剛解鎖的頭像與框]}；
--    不能蓋時回 {ok:false, reason}，不丟錯，遊戲照玩。
-- -----------------------------------------------------------------------------
create or replace function public.park_award_stamp(p_facility text, p_stamp text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := public.current_student_id();
  v_s public.park_stamps%rowtype;
  v_earned text[];
  v_before text[];
  v_new boolean;
begin
  if v_me is null then return jsonb_build_object('ok', false, 'reason', '只有學生可以蓋章'); end if;
  select * into v_s from public.park_stamps s where s.facility = p_facility and s.code = p_stamp;
  if v_s.code is null then return jsonb_build_object('ok', false, 'reason', '沒有這個章'); end if;
  if not v_s.active then return jsonb_build_object('ok', false, 'reason', '這個章還沒開放'); end if;
  if not coalesce((public.park_can_enter(p_facility) ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', '這個遊戲現在不能玩，不能蓋章');
  end if;
  -- 有登記「該拿到哪些章」的設施，要對得上才蓋
  v_earned := public.park_earned(v_me, p_facility);
  if v_earned is not null and not (p_stamp = any(v_earned)) then
    return jsonb_build_object('ok', false, 'reason', '還沒有完成這個章的條件');
  end if;

  v_before := array(select public.park_unlocked(v_me));
  insert into public.park_student_stamps (student_id, facility, stamp)
  values (v_me, p_facility, p_stamp)
  on conflict do nothing;
  v_new := found;
  return jsonb_build_object(
    'ok', true, 'new', v_new, 'name', v_s.name, 'art', v_s.art,
    'unlocked', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'kind', r.kind, 'name', r.name) order by r.kind, r.sort)
                            from public.park_rewards r
                           where r.code in (select public.park_unlocked(v_me))
                             and not (r.code = any(v_before))), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. 給樂園畫面叫的
-- -----------------------------------------------------------------------------

-- 右上角的小卡片用：我的頭像、框、章數、還沒看過的新章。順便補蓋各遊戲該拿到的章，
-- 所以小朋友在守護異世界過完關、回到樂園，馬上就會看到新章。
create or replace function public.park_my_profile()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_p public.park_profiles%rowtype;
begin
  if v_me is null then return null; end if;
  perform public.park_stamp_sync(v_me);
  select * into v_p from public.park_profiles p where p.student_id = v_me;
  return jsonb_build_object(
    'avatar', v_p.avatar,
    'frame', coalesce(v_p.frame, 'plain'),
    'stamps', (select count(*) from public.park_student_stamps x where x.student_id = v_me),
    'unseen', coalesce((select jsonb_agg(jsonb_build_object('facility', s.facility, 'code', s.code, 'name', s.name, 'art', s.art)
                                         order by x.awarded_at)
                          from public.park_student_stamps x
                          join public.park_stamps s on s.facility = x.facility and s.code = x.stamp
                         where x.student_id = v_me and not x.seen), '[]'::jsonb));
end;
$$;

-- 整本護照：每個有章的設施一頁，加上所有頭像與框（含解鎖了沒、還差什麼）。
create or replace function public.park_passport()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := public.current_student_id();
  v_total int;
  v_unlocked text[];
  v_p public.park_profiles%rowtype;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  perform public.park_stamp_sync(v_me);
  select count(*) into v_total from public.park_student_stamps x where x.student_id = v_me;
  v_unlocked := array(select public.park_unlocked(v_me));
  select * into v_p from public.park_profiles p where p.student_id = v_me;

  return jsonb_build_object(
    'stamps', v_total,
    'avatar', v_p.avatar,
    'frame', coalesce(v_p.frame, 'plain'),
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'facility', f.code, 'name', f.name, 'subject', f.subject, 'zone', f.zone, 'status', f.status,
               'full', public.park_page_full(v_me, f.code),
               'stamps', (select jsonb_agg(jsonb_build_object(
                                   'code', s.code, 'name', s.name, 'hint', s.hint, 'art', s.art, 'active', s.active,
                                   'at', x.awarded_at, 'new', x.stamp is not null and not x.seen)
                                 order by s.sort, s.code)
                            from public.park_stamps s
                            left join public.park_student_stamps x
                                   on x.student_id = v_me and x.facility = s.facility and x.stamp = s.code
                           where s.facility = f.code))
             order by f.sort, f.code)
        from public.park_facilities f
       where f.status <> 'hidden'
         and exists (select 1 from public.park_stamps s where s.facility = f.code)
    ), '[]'::jsonb),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'kind', r.kind, 'name', r.name,
               'need_stamps', r.need_stamps, 'need_page', r.need_page,
               'need_page_name', (select f.name from public.park_facilities f where f.code = r.need_page),
               'unlocked', r.code = any(v_unlocked))
             order by r.kind, r.sort)
        from public.park_rewards r
    ), '[]'::jsonb)
  );
end;
$$;

-- 打開護照看過了：新章的動畫只播一次
create or replace function public.park_passport_seen()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.park_student_stamps set seen = true
   where student_id = public.current_student_id() and not seen;
$$;

-- 換頭像與框。沒解鎖的選不了。傳 null 表示那一樣不變。
create or replace function public.park_set_avatar(p_avatar text, p_frame text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_ok text[];
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  v_ok := array(select public.park_unlocked(v_me));
  if p_avatar is not null and not exists (select 1 from public.park_rewards r where r.code = p_avatar and r.kind = 'avatar') then
    raise exception '沒有這個頭像';
  end if;
  if p_frame is not null and not exists (select 1 from public.park_rewards r where r.code = p_frame and r.kind = 'frame') then
    raise exception '沒有這個頭像框';
  end if;
  if p_avatar is not null and not (p_avatar = any(v_ok)) then raise exception '這個頭像還沒解鎖'; end if;
  if p_frame is not null and not (p_frame = any(v_ok)) then raise exception '這個頭像框還沒解鎖'; end if;
  insert into public.park_profiles as p (student_id, avatar, frame)
  values (v_me, p_avatar, p_frame)
  on conflict (student_id) do update
    set avatar = coalesce(excluded.avatar, p.avatar),
        frame  = coalesce(excluded.frame, p.frame),
        updated_at = now();
  return (select jsonb_build_object('avatar', p.avatar, 'frame', coalesce(p.frame, 'plain'))
            from public.park_profiles p where p.student_id = v_me);
end;
$$;

-- 老師名單上的頭像與章數（全班總覽用）
create or replace function public.park_class_avatars(p_code text)
returns table (student_id uuid, avatar text, frame text, stamps bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.student_id, p.avatar, coalesce(p.frame, 'plain'),
         (select count(*) from public.park_student_stamps x where x.student_id = m.student_id)
    from public.park_class_members m
    left join public.park_profiles p on p.student_id = m.student_id
   where m.class_code = upper(btrim(coalesce(p_code, '')))
     and public.is_teacher_of(m.class_code);
$$;

-- -----------------------------------------------------------------------------
-- 7. 守護異世界的「該拿到哪些章」（暫放這裡，之後搬回英文 repo 的 park_guardian.sql，
--    跟 P2 的 guardian_class_summary 一樣）。全部看伺服器判定的 level_progress。
-- -----------------------------------------------------------------------------
create or replace function public.guardian_earned_stamps(p_student uuid)
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  with c as (
    select l.chapter, (lp.cleared_at is not null) as cleared, coalesce(lp.stars, 0) as stars
      from public.levels l
      left join public.level_progress lp on lp.level_id = l.id and lp.student_id = p_student
  ),
  n as (select count(*) filter (where cleared) as cleared,
               count(*) filter (where cleared and stars = 3) as three from c)
  select 'first'   from n where cleared >= 1
  union all select 'clear5'  from n where cleared >= 5
  union all select 'clear30' from n where cleared >= 30
  union all select 'clear60' from n where cleared >= 60
  union all select 'stars20' from n where three >= 20
  union all select 'ch' || chapter from c group by chapter having bool_and(cleared);
$$;

-- -----------------------------------------------------------------------------
-- 8. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_earned(uuid, text), public.park_stamp_sync(uuid), public.park_page_full(uuid, text),
  public.park_unlocked(uuid), public.park_award_stamp(text, text), public.park_my_profile(),
  public.park_passport(), public.park_passport_seen(), public.park_set_avatar(text, text),
  public.park_class_avatars(text), public.guardian_earned_stamps(uuid)
  from public, anon, authenticated;
grant execute on function
  public.park_award_stamp(text, text), public.park_my_profile(), public.park_passport(),
  public.park_passport_seen(), public.park_set_avatar(text, text), public.park_class_avatars(text)
  to authenticated;
