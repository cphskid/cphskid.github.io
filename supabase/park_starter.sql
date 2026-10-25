-- =============================================================================
-- 時空冒險樂園：新手冒險手冊（2026-10-25「分析數據提升黏著率」串，Chuck 同意）
--
-- 為什麼：正式庫數據顯示新人大多在前 5 分鐘就走了（231 人註冊，只有 28 人在遊戲裡待超過 15 分鐘），
--   隔天回來的只有 6%。玩得久的孩子都自己走出同一條路：打一場 → 買東西 → 餵寵物 → 換另一個遊戲。
--   手冊把這條路變成每個新人的預設路線，再用七天、每天不一樣的禮物把孩子帶回來。
--
-- 規則：
--   註冊 14 天內、手冊還沒翻完的學生才有。新手期間樂園畫面用手冊取代每日任務（每日任務照樣在伺服器排，只是不顯示）。
--   七頁，第 N 頁在註冊後第 N 天（臺灣時間）打開，而且前一頁要做完；漏掉的天數可以補，一天補好幾頁也行。
--   第一頁有 5 步（第一天的路線），之後每頁 1 步。每一步做完當下發時光幣，一頁做完再送那頁的禮物。
--   做沒做到全由伺服器看紀錄判斷（跟每日任務同一套），小朋友不用按「領」。
--   進不去的島（班上沒開）那一步自動跳過、不發獎。
--
-- 只「加表、加函式」，其他東西不動。可以重複執行。
-- 順序：… → park_coins.sql → 這份（要用到 park_coin_grant、park_daily_can、park_coin_sync）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------

-- 手冊內容：每一步（page＝第幾頁，sort＝頁內順序）
create table if not exists public.park_starter_steps (
  code     text primary key,
  page     smallint not null check (page between 1 and 7),
  sort     smallint not null default 0,
  name     text not null,          -- 給小朋友看的一句話
  hint     text not null default '',
  go       text,                   -- 按「去」打開哪裡：wear / pet / shop / passport / 設施代碼
  facility text,                   -- 要進得去這座島才算數（進不去就跳過）
  coins    int not null default 0
);

-- 每頁做完送的禮物：kind＝wear 衣飾／furn 傢俱／pet 寵物點心／coins 時光幣
create table if not exists public.park_starter_pages (
  page  smallint primary key check (page between 1 and 7),
  title text not null,
  kind  text not null check (kind in ('wear', 'furn', 'pet', 'coins')),
  ref   text,
  qty   int not null default 1,
  name  text not null,             -- 「時空飛行護目鏡」「小魚乾 ×3」
  art   text not null default '',
  coins int not null default 0     -- 已經有那件東西時改送的時光幣（kind＝coins 時就是禮物本身）
);

-- 每個學生做完了哪些（步驟 code，或整頁 'page:N'）
create table if not exists public.park_starter_done (
  student_id uuid not null references public.students(id) on delete cascade,
  code       text not null,
  skipped    boolean not null default false,
  done_at    timestamptz not null default now(),
  primary key (student_id, code)
);

-- -----------------------------------------------------------------------------
-- 2. 初始資料（重跑會更新文字和獎勵）
-- -----------------------------------------------------------------------------
insert into public.park_starter_steps (code, page, sort, name, hint, go, facility, coins) values
  ('look',   1, 1, '打扮你的時空旅人',          '挑臉型、髮型和一套起始衣服，送你新手禮包 30 時光幣！', 'wear', null, 30),
  ('guard',  1, 2, '去守護異世界，打贏第一場',    '用單字咒語把怪物擋在城門外。',                           'guardian', 'guardian', 10),
  ('buy',    1, 3, '去商店買第一件東西',          '蘋果片只要 30 時光幣，買給寵物吃吧！',                   'shop', null, 10),
  ('pet',    1, 4, '去寵物島，餵你的寵物',        '打開背包，拿點心給牠吃。',                               'pet', null, 10),
  ('pro',    1, 5, '去臺灣島，玩完序章',          '跟著小船找到臺灣，上岸蓋基地。',                         'island_pioneer', 'island_pioneer', 20),
  ('ch1',    2, 1, '臺灣島：玩完第一章',          '回到很久很久以前的臺灣。',                               'island_pioneer', 'island_pioneer', 20),
  ('g3',     3, 1, '守護異世界：打到第三關',      '過了第三關，城堡會更熱鬧。',                             'guardian', 'guardian', 20),
  ('wish',   4, 1, '陪寵物玩：完成牠的願望或丟球', '點寵物頭上的泡泡，看看牠想做什麼。',                     'pet', null, 20),
  ('ch2',    5, 1, '臺灣島：玩完第二章',          '大航海時代的船來了！',                                   'island_pioneer', 'island_pioneer', 20),
  ('stamp5', 6, 1, '護照蓋滿 5 個章',             '在各座島過關就會蓋章，打開護照看看還缺哪些。',           'passport', null, 20),
  ('back',   7, 1, '翻開手冊的最後一頁',          '你回來了！最後一份禮物在這裡。',                         null, null, 30)
on conflict (code) do update set page = excluded.page, sort = excluded.sort, name = excluded.name, hint = excluded.hint,
  go = excluded.go, facility = excluded.facility, coins = excluded.coins;

insert into public.park_starter_pages (page, title, kind, ref, qty, name, art, coins) values
  (1, '第一天：樂園新手',     'pet',   'fish',        3, '小魚乾 ×3',       'img/pet/food/fish.webp',         0),
  (2, '第二天：時光飛行員',   'wear',  'hat-goggles', 1, '時空飛行護目鏡',  'img/traveller/thumb/hat-goggles.webp', 70),
  (3, '第三天：寵物的最愛',   'pet',   'magic-fruit', 3, '異世界魔法果 ×3', 'img/pet/food/magic-fruit.webp',  0),
  (4, '第四天：寵物島新家具', 'furn',  'scratcher',   1, '貓抓板',          'img/pet/furniture/scratcher.webp', 120),
  (5, '第五天：臺灣小達人',   'wear',  'hat-cap',     1, '黑熊棒球帽',      'img/traveller/thumb/hat-cap.webp', 60),
  (6, '第六天：冒險存款',     'coins', null,          1, '100 時光幣',      'img/ui/coin.webp',               100),
  (7, '第七天：新手畢業',     'furn',  'trampoline',  1, '彈跳床',          'img/pet/furniture/trampoline.webp', 180)
on conflict (page) do update set title = excluded.title, kind = excluded.kind, ref = excluded.ref, qty = excluded.qty,
  name = excluded.name, art = excluded.art, coins = excluded.coins;

-- -----------------------------------------------------------------------------
-- 3. 讀取規則：內容大家都看得到；做完紀錄只有本人看得到。寫入一律走函式。
-- -----------------------------------------------------------------------------
alter table public.park_starter_steps enable row level security;
alter table public.park_starter_pages enable row level security;
alter table public.park_starter_done  enable row level security;
revoke all on public.park_starter_steps, public.park_starter_pages, public.park_starter_done from anon, authenticated;
grant select on public.park_starter_steps, public.park_starter_pages to anon, authenticated;
drop policy if exists park_starter_steps_read on public.park_starter_steps;
create policy park_starter_steps_read on public.park_starter_steps for select using (true);
drop policy if exists park_starter_pages_read on public.park_starter_pages;
create policy park_starter_pages_read on public.park_starter_pages for select using (true);

-- -----------------------------------------------------------------------------
-- 4. 小幫手（不開給人直接叫）
-- -----------------------------------------------------------------------------

-- 註冊那天（臺灣時間）
create or replace function public.park_starter_day0(p_student uuid)
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select (s.created_at at time zone 'Asia/Taipei')::date from public.students s where s.id = p_student;
$$;

-- 這一步做到了沒（從各處的紀錄看）
create or replace function public.park_starter_check(p_student uuid, p_code text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v boolean := false;
begin
  if p_code = 'look' then
    select exists (select 1 from public.park_travellers t where t.student_id = p_student) into v;
  elsif p_code = 'guard' then
    select exists (select 1 from public.level_progress lp where lp.student_id = p_student and lp.cleared_at is not null) into v;
  elsif p_code = 'g3' then
    select exists (select 1 from public.level_progress lp where lp.student_id = p_student
                      and lp.level_id = 'td-03' and lp.cleared_at is not null) into v;
  elsif p_code = 'buy' then
    select exists (select 1 from public.park_coin_ledger l where l.student_id = p_student and l.amount < 0) into v;
  elsif p_code = 'pet' then
    select exists (select 1 from public.park_pets p where p.student_id = p_student
                      and (p.ate_at is not null or p.patted_at is not null)) into v;
  elsif p_code = 'wish' then
    select exists (select 1 from public.park_pets p where p.student_id = p_student and p.played_at is not null) into v;
  elsif p_code = 'stamp5' then
    select count(*) >= 5 from public.park_student_stamps s where s.student_id = p_student into v;
  elsif p_code in ('pro', 'ch1', 'ch2') then
    if to_regclass('public.island_saves') is not null then
      execute case when p_code = 'pro'
        then 'select exists (select 1 from public.island_saves s where s.student_id = $1 and s.slot = ''world'' and s.data ->> ''prologue'' = ''true'')'
        else 'select exists (select 1 from public.island_saves s where s.student_id = $1 and s.slot = $2 and s.done)' end
        into v using p_student, p_code;
    end if;
  elsif p_code = 'back' then
    v := true;
  end if;
  return coalesce(v, false);
end;
$$;

-- 送一頁的禮物；已經有那件東西就改送時光幣。回傳送了什麼（給通知用）。
create or replace function public.park_starter_gift(p_student uuid, p_page int)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.park_starter_pages; v_has boolean := false;
begin
  select * into g from public.park_starter_pages where page = p_page;
  if g.page is null then return null; end if;
  if g.kind = 'wear' then
    select exists (select 1 from public.park_student_wear w where w.student_id = p_student and w.item = g.ref) into v_has;
    if not v_has then insert into public.park_student_wear (student_id, item, source) values (p_student, g.ref, 'event'); end if;
  elsif g.kind = 'furn' then
    select exists (select 1 from public.park_student_furniture f where f.student_id = p_student and f.item = g.ref) into v_has;
    if not v_has then insert into public.park_student_furniture (student_id, item) values (p_student, g.ref); end if;
  elsif g.kind = 'pet' then
    insert into public.park_pet_inventory as v (student_id, item, qty) values (p_student, g.ref, g.qty)
    on conflict (student_id, item) do update set qty = v.qty + excluded.qty;
  end if;
  if g.kind = 'coins' or v_has then
    perform public.park_coin_grant(p_student, 'starter:page:' || p_page, g.coins, null, '新手手冊：' || g.title);
    return case when v_has then g.coins || ' 時光幣（你已經有「' || g.name || '」了）' else g.name end;
  end if;
  return g.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. 給樂園畫面叫的
-- -----------------------------------------------------------------------------

-- 我的新手手冊：順便把做到的步驟記下來、發獎。不是學生、過了新手期、早就翻完了回 null。
-- 回傳 {page, pages, day, title, steps:[{code,name,hint,go,done,skipped}], gift:{name,art},
--       locked:true（今天這頁做完了，下一頁明天開）, finished:true（今天剛翻完）, fresh:[{text}]}
create or replace function public.park_starter_me()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := public.current_student_id();
  v_day0 date; v_idx int; v_page int := null; v_locked boolean := false;
  s record; p record; v_left int; v_fresh jsonb := '[]'; v_gift text; v_finished timestamptz;
begin
  if v_me is null then return null; end if;
  v_day0 := public.park_starter_day0(v_me);
  v_idx := public.park_today() - v_day0;       -- 註冊當天是 0
  select done_at into v_finished from public.park_starter_done where student_id = v_me and code = 'page:7';
  if v_finished is not null then
    if (v_finished at time zone 'Asia/Taipei')::date < public.park_today() then return null; end if;
  elsif v_idx > 13 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('park_starter:' || v_me::text));
  perform public.park_coin_sync(v_me);          -- 先把護照章、各島的幣補好（蓋滿 5 個章要看）

  for p in select * from public.park_starter_pages order by page loop
    continue when exists (select 1 from public.park_starter_done d where d.student_id = v_me and d.code = 'page:' || p.page);
    if v_idx < p.page - 1 then v_page := p.page; v_locked := true; exit; end if;
    v_left := 0;
    for s in select * from public.park_starter_steps st where st.page = p.page order by st.sort loop
      continue when exists (select 1 from public.park_starter_done d where d.student_id = v_me and d.code = s.code);
      if s.facility is not null and not public.park_daily_can(v_me, s.facility) then
        insert into public.park_starter_done (student_id, code, skipped) values (v_me, s.code, true) on conflict do nothing;
      elsif public.park_starter_check(v_me, s.code) then
        insert into public.park_starter_done (student_id, code) values (v_me, s.code) on conflict do nothing;
        perform public.park_coin_grant(v_me, 'starter:' || s.code, s.coins, null, '新手手冊：' || s.name);
        v_fresh := v_fresh || jsonb_build_object('text', '完成「' || s.name || '」' || case when s.coins > 0 then '，+' || s.coins || ' 時光幣' else '' end);
      else
        v_left := v_left + 1;
      end if;
    end loop;
    if v_left > 0 then v_page := p.page; exit; end if;
    insert into public.park_starter_done (student_id, code) values (v_me, 'page:' || p.page) on conflict do nothing;
    v_gift := public.park_starter_gift(v_me, p.page);
    v_fresh := v_fresh || jsonb_build_object('text', p.title || '完成！送你' || coalesce(v_gift, '一份禮物'), 'gift', true);
  end loop;

  if v_page is null then
    return jsonb_build_object('finished', true, 'pages', 7, 'fresh', v_fresh, 'balance', public.park_coin_balance(v_me));
  end if;
  return (
    select jsonb_build_object(
      'page', v_page, 'pages', 7, 'day', v_idx + 1, 'title', g.title, 'locked', v_locked,
      'gift', jsonb_build_object('name', g.name, 'art', g.art),
      -- 七天的禮物一次列出來（大目標），手冊最上面那一排
      'gifts', (select jsonb_agg(jsonb_build_object('page', a.page, 'name', a.name, 'art', a.art,
                                                     'done', exists (select 1 from public.park_starter_done d
                                                                      where d.student_id = v_me and d.code = 'page:' || a.page))
                                 order by a.page) from public.park_starter_pages a),
      'steps', coalesce((select jsonb_agg(jsonb_build_object('code', st.code, 'name', st.name, 'hint', st.hint, 'go', st.go,
                                                     'done', d.code is not null and not d.skipped, 'skipped', coalesce(d.skipped, false))
                                  order by st.sort)
                           from public.park_starter_steps st
                           left join public.park_starter_done d on d.student_id = v_me and d.code = st.code
                          where st.page = v_page), '[]'),
      'fresh', v_fresh,
      'balance', public.park_coin_balance(v_me))
    from public.park_starter_pages g where g.page = v_page);
end;
$$;

-- 老師（家長的家庭班也是）：全班的新手手冊翻到第幾頁。只列有開始過的人。
create or replace function public.park_starter_class(p_code text)
returns table (student_id uuid, pages int, steps int, finished boolean, last_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  return query
  select d.student_id,
         (count(*) filter (where d.code like 'page:%'))::int,
         (count(*) filter (where d.code not like 'page:%' and not d.skipped))::int,
         bool_or(d.code = 'page:7'), max(d.done_at)
    from public.park_starter_done d
    join public.park_class_members m on m.student_id = d.student_id and m.class_code = v_code
   group by d.student_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_starter_day0(uuid), public.park_starter_check(uuid, text), public.park_starter_gift(uuid, int),
  public.park_starter_me(), public.park_starter_class(text)
from public, anon, authenticated;
grant execute on function public.park_starter_me(), public.park_starter_class(text) to authenticated;
