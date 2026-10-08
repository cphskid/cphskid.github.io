-- =============================================================================
-- 時空冒險樂園：時光幣、每日任務、商店
--
-- 原則（規劃書「樂園商店、時光幣與社交規劃」，2026-10-04 Chuck 定案）：
--   錢只有一個出口：時光幣只由樂園發。遊戲只把進度存好（例如島嶼開拓者的 island_saves），
--   金額由這裡的費率表（park_coin_rates）和各設施登記的 <前綴>_coin_sources(學生) 決定。
--   伺服器記一本帳（park_coin_ledger），每筆有唯一的來源編號（學生＋來源），重送不會重複入帳；
--   前端改不了金額。守護異世界自己的銅幣不動、不合併。
--
--   島嶼開拓者：每一步依輕、中、重給 5／10／20，整章通關 30，每顆星 10；
--     重玩整章遞減：二刷給整章獎勵的一半、三刷四分之一、四刷起不給；看到新結局另給 30。
--     費率、各步的輕中重之後用全體通關時間中位數校正（改表就好，不用改程式）。
--   守護異世界：每蓋到一個樂園護照章給 20。
--   每日任務：每天 3 個，各 5，全做完再加 10，一天最多 25。
--   本週冒險值＝這週新賺到的時光幣（不是餘額），週一（臺灣時間）重置；花掉也不會掉。
--
-- 商店四類：主角（換裝間的衣飾，價錢在 park_wear_items）、寵物（點心）、傢俱（寵物島）、本月限定。
--   寵物不賣（去認養島）；頭像、頭像框、勳章不賣；活動套裝之後用活動糖果換，不用時光幣。
--
-- 一樣只「加表、加函式」，守護異世界的東西一個都不動。
--
-- 怎麼套：Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。
-- 順序：… → park_passport.sql → park_pet.sql → park_traveller.sql → 這份 → 各遊戲 SQL（島嶼開拓者
--       的 island_pioneer.sql 會登記自己的 island_coin_sources）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------

-- 設施多一欄：「這個學生在我這裡該拿到哪些時光幣」的函式，形狀固定
--   <前綴>_coin_sources(uuid) returns table (source text, amount int, note text)
alter table public.park_facilities add column if not exists coins_fn text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'park_facilities_coins_fn_check') then
    alter table public.park_facilities add constraint park_facilities_coins_fn_check
      check (coins_fn ~ '^[a-z][a-z0-9_]*_coin_sources$');
  end if;
end $$;

-- 費率表：之後校正改這裡就好
create table if not exists public.park_coin_rates (
  code   text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  amount int  not null check (amount >= 0),
  note   text not null default ''
);

-- 帳本：入帳是正的、花錢是負的。source 同一個學生不會重複。
create table if not exists public.park_coin_ledger (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  source     text not null check (length(source) between 3 and 120),
  amount     int  not null check (amount <> 0),
  facility   text,                                   -- 從哪個設施來（每日任務、商店是 null）
  note       text not null default '',               -- 給小朋友看的一句話
  seen       boolean not null default false,         -- 樂園跳過「賺到了」的通知了沒
  created_at timestamptz not null default now(),
  unique (student_id, source)
);
create index if not exists park_coin_ledger_week on public.park_coin_ledger (student_id, created_at);

-- 每日任務：每個學生每天一筆（臺灣時間的日期）
create table if not exists public.park_daily (
  student_id uuid not null references public.students(id) on delete cascade,
  day        date not null,
  tasks      text[] not null,
  claimed    text[] not null default '{}',
  primary key (student_id, day)
);

-- 商店（主角的衣飾直接用 park_wear_items 的價錢，不在這張表）
--   cat：pet 寵物點心（ref＝park_pet_items 的 code，可以一直買）／furn 寵物島傢俱（ref＝傢俱 id，買一次）
--   month：本月限定，只在那幾個月上架（1～12，null＝常駐）
create table if not exists public.park_shop_items (
  code   text primary key check (code ~ '^[a-z][a-z0-9-]{1,30}$'),
  cat    text not null check (cat in ('pet', 'furn')),
  ref    text not null,
  name   text not null,
  art    text not null,
  blurb  text not null default '',
  price  int  not null check (price > 0),
  months smallint[],
  active boolean not null default true,
  sort   int  not null default 0
);

-- 買到的傢俱（點心直接放進桌寵背包）
create table if not exists public.park_student_furniture (
  student_id uuid not null references public.students(id) on delete cascade,
  item       text not null,
  got_at     timestamptz not null default now(),
  primary key (student_id, item)
);

-- -----------------------------------------------------------------------------
-- 2. 初始資料（重跑會更新數值，不會多出東西）
-- -----------------------------------------------------------------------------
insert into public.park_coin_rates (code, amount, note) values
  ('light',          5,  '輕：開場、結尾、撥雲找地點、不會失敗的對話（2 分以內）'),
  ('medium',         10, '中：一個機制的小謎題（3～5 分）'),
  ('heavy',          20, '重：每章倒數第二步的大難題（6 分以上）'),
  ('chapter',        30, '整章通關（回到現在那一刻）'),
  ('star',           10, '每顆星（一章最多 3 顆）'),
  ('ending',         30, '重玩時看到新的結局'),
  ('challenge',      10, '⭐⭐⭐再挑戰第一次過關'),
  ('guardian_stamp', 20, '守護異世界每蓋到一個樂園護照章'),
  ('daily',          5,  '每日任務一個'),
  ('daily_all',      10, '每日任務 3 個全做完')
on conflict (code) do update set note = excluded.note;   -- 金額校正過就不蓋回去

insert into public.park_pet_items (code, kind, name, icon, xp, facility, sort) values
  ('apple',   'special', '蘋果片',   '🍎', 2, null, 10),
  ('carrot',  'special', '紅蘿蔔',   '🥕', 2, null, 11),
  ('seeds',   'special', '葵花子',   '🌻', 2, null, 12),
  ('biscuit', 'special', '骨頭餅乾', '🦴', 3, null, 13),
  ('fish',    'special', '小魚乾',   '🐟', 3, null, 14),
  ('mooncake','special', '迷你月餅', '🥮', 4, null, 15)
on conflict (code) do update
  set kind = excluded.kind, name = excluded.name, icon = excluded.icon, xp = excluded.xp, sort = excluded.sort;

insert into public.park_shop_items (code, cat, ref, name, art, blurb, price, months, sort) values
  ('pet-apple',    'pet',  'apple',     '蘋果片',   'img/pet/food/apple.webp',    '脆脆甜甜，大家都愛', 30, null, 1),
  ('pet-carrot',   'pet',  'carrot',    '紅蘿蔔',   'img/pet/food/carrot.webp',   '兔子和黃金鼠的最愛', 30, null, 2),
  ('pet-seeds',    'pet',  'seeds',     '葵花子',   'img/pet/food/seeds.webp',    '一顆一顆慢慢嗑', 30, null, 3),
  ('pet-biscuit',  'pet',  'biscuit',   '骨頭餅乾', 'img/pet/food/biscuit.webp',  '小狗看到會轉圈圈', 50, null, 4),
  ('pet-fish',     'pet',  'fish',      '小魚乾',   'img/pet/food/fish.webp',     '小貓看到會喵喵叫', 50, null, 5),
  ('furn-scratcher','furn','scratcher', '貓抓板',   'img/pet/furniture/scratcher.webp', '抓抓磨爪子，還能爬上去', 120, null, 10),
  ('furn-sandbox', 'furn', 'sandbox',   '小沙坑',   'img/pet/furniture/sandbox.webp',   '挖挖挖，看能挖到什麼', 150, null, 11),
  ('furn-trampoline','furn','trampoline','彈跳床',  'img/pet/furniture/trampoline.webp','跳得比雲還高', 180, null, 12),
  ('furn-hammock', 'furn', 'hammock',   '吊床',     'img/pet/furniture/hammock.webp',   '在樹下搖啊搖，睡個午覺', 200, null, 13),
  ('pet-mooncake', 'pet',  'mooncake',  '迷你月餅', 'img/pet/food/mooncake.webp', '中秋限定，咬一口有蛋黃', 60, '{9,10}', 20),
  ('furn-rabbit-lamp','furn','rabbit-lamp','兔子燈', 'img/pet/furniture/rabbit-lamp.webp', '中秋限定，晚上會亮', 250, '{9,10}', 21)
on conflict (code) do update
  set cat = excluded.cat, ref = excluded.ref, name = excluded.name, art = excluded.art, blurb = excluded.blurb,
      price = excluded.price, months = excluded.months, sort = excluded.sort;

-- -----------------------------------------------------------------------------
-- 3. 讀取規則：費率、商品大家都看得到；帳本、任務、傢俱只有本人看得到。寫入一律走函式。
-- -----------------------------------------------------------------------------
alter table public.park_coin_rates        enable row level security;
alter table public.park_coin_ledger       enable row level security;
alter table public.park_daily             enable row level security;
alter table public.park_shop_items        enable row level security;
alter table public.park_student_furniture enable row level security;

revoke all on public.park_coin_rates, public.park_coin_ledger, public.park_daily,
              public.park_shop_items, public.park_student_furniture from anon, authenticated;
grant select on public.park_coin_rates, public.park_shop_items to anon, authenticated;
grant select on public.park_coin_ledger, public.park_daily, public.park_student_furniture to authenticated;

drop policy if exists park_coin_rates_read on public.park_coin_rates;
create policy park_coin_rates_read on public.park_coin_rates for select to anon, authenticated using (true);
drop policy if exists park_shop_items_read on public.park_shop_items;
create policy park_shop_items_read on public.park_shop_items for select to anon, authenticated using (true);
drop policy if exists park_coin_ledger_read on public.park_coin_ledger;
create policy park_coin_ledger_read on public.park_coin_ledger for select to authenticated
  using (student_id = public.current_student_id());
drop policy if exists park_daily_read on public.park_daily;
create policy park_daily_read on public.park_daily for select to authenticated
  using (student_id = public.current_student_id());
drop policy if exists park_student_furniture_read on public.park_student_furniture;
create policy park_student_furniture_read on public.park_student_furniture for select to authenticated
  using (student_id = public.current_student_id());

-- -----------------------------------------------------------------------------
-- 4. 小幫手（不開給人直接叫）
-- -----------------------------------------------------------------------------

create or replace function public.park_coin_rate(p_code text)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select amount from public.park_coin_rates where code = p_code), 0);
$$;

-- 臺灣時間的今天、這週一 0 點
create or replace function public.park_today()
returns date language sql stable set search_path = public, pg_temp as $$
  select (now() at time zone 'Asia/Taipei')::date;
$$;
create or replace function public.park_week_start()
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select (date_trunc('week', now() at time zone 'Asia/Taipei')) at time zone 'Asia/Taipei';
$$;

create or replace function public.park_coin_balance(p_student uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0)::int from public.park_coin_ledger where student_id = p_student;
$$;

-- 本週冒險值：這週新賺到的（花掉的不扣）
create or replace function public.park_coin_week(p_student uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0)::int from public.park_coin_ledger
   where student_id = p_student and amount > 0 and created_at >= public.park_week_start();
$$;

-- 入帳：同一個來源只算一次。回傳這次真的入帳的金額（重複的回 0）。
create or replace function public.park_coin_grant(p_student uuid, p_source text, p_amount int, p_facility text, p_note text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if p_student is null or coalesce(p_amount, 0) <= 0 then return 0; end if;
  insert into public.park_coin_ledger (student_id, source, amount, facility, note)
  values (p_student, p_source, p_amount, p_facility, coalesce(p_note, ''))
  on conflict (student_id, source) do nothing;
  get diagnostics v_n = row_count;
  return case when v_n > 0 then p_amount else 0 end;
end;
$$;

-- 守護異世界：每個樂園護照章 20（勳章類的不算，只有過關章）
create or replace function public.guardian_coin_sources(p_student uuid)
returns table (source text, amount int, note text)
language sql stable security definer set search_path = public, pg_temp as $$
  select 'guardian:stamp:' || x.stamp, public.park_coin_rate('guardian_stamp'), '蓋到護照章「' || s.name || '」'
    from public.park_student_stamps x
    join public.park_stamps s on s.facility = x.facility and s.code = x.stamp
   where x.student_id = p_student and x.facility = 'guardian';
$$;
update public.park_facilities set coins_fn = 'guardian_coin_sources' where code = 'guardian' and coins_fn is null;
-- 島嶼開拓者的 SQL 先套過了（已經有 island_coin_sources）就順便登記
update public.park_facilities set coins_fn = 'island_coin_sources'
 where code = 'island_pioneer' and coins_fn is null and to_regprocedure('public.island_coin_sources(uuid)') is not null;

-- 把各設施「該拿到」的時光幣補進帳本。回傳這次新入帳的總額。
create or replace function public.park_coin_sync(p_student uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare f record; r record; v_total int := 0;
begin
  if p_student is null then return 0; end if;
  perform public.park_stamp_sync(p_student);    -- 先把章補蓋好（守護異世界的幣看章）
  for f in select fa.code, fa.coins_fn from public.park_facilities fa where fa.coins_fn is not null loop
    continue when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'public' and p.proname = f.coins_fn);
    begin
      for r in execute format('select source, amount, note from public.%I($1)', f.coins_fn) using p_student loop
        v_total := v_total + public.park_coin_grant(p_student, r.source, r.amount, f.code, r.note);
      end loop;
    exception when others then
      raise warning '時光幣：% 算不出來（%）', f.code, sqlerrm;
    end;
  end loop;
  return v_total;
end;
$$;

-- 每日任務的題庫：每天固定「照顧寵物」「去玩一下」，第三個輪流
create or replace function public.park_daily_name(p_task text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_task
    when 'pet'   then '照顧寵物：餵牠或摸摸牠'
    when 'play'  then '去任何一座島玩一下'
    when 'wish'  then '陪寵物玩：完成牠的願望或丟球'
    when 'dress' then '去換裝間換一套衣服'
    else p_task end;
$$;

-- 今天這個任務做了沒（從各處的紀錄看，不用小朋友回報）
create or replace function public.park_daily_done(p_student uuid, p_task text, p_day date)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v boolean := false; v_from timestamptz := p_day::timestamp at time zone 'Asia/Taipei';
        v_to timestamptz := (p_day + 1)::timestamp at time zone 'Asia/Taipei';
begin
  if p_task = 'pet' then
    select exists (select 1 from public.park_pets p where p.student_id = p_student
                      and (p.ate_at >= v_from and p.ate_at < v_to or p.patted_at >= v_from and p.patted_at < v_to)) into v;
  elsif p_task = 'wish' then
    select exists (select 1 from public.park_pets p where p.student_id = p_student
                      and p.played_at >= v_from and p.played_at < v_to) into v;
  elsif p_task = 'dress' then
    select exists (select 1 from public.park_travellers t where t.student_id = p_student
                      and t.updated_at >= v_from and t.updated_at < v_to) into v;
  elsif p_task = 'play' then
    -- 守護異世界：今天過了一關，或角色今天存過檔
    select exists (select 1 from public.level_progress lp where lp.student_id = p_student
                      and lp.cleared_at >= v_from and lp.cleared_at < v_to)
        or exists (select 1 from public.characters c where c.student_id = p_student
                      and c.updated_at >= v_from and c.updated_at < v_to) into v;
    -- 島嶼開拓者：今天存過檔（套了 island_pioneer.sql 才有這張表）
    if not v and to_regclass('public.island_saves') is not null then
      execute 'select exists (select 1 from public.island_saves s where s.student_id = $1 and s.slot <> ''medals''
                                 and s.updated_at >= $2 and s.updated_at < $3)'
        into v using p_student, v_from, v_to;
    end if;
  end if;
  return coalesce(v, false);
end;
$$;

-- 今天的任務（第一次看到才排）
create or replace function public.park_daily_row(p_student uuid)
returns public.park_daily language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.park_daily; v_day date := public.park_today();
begin
  insert into public.park_daily (student_id, day, tasks)
  values (p_student, v_day,
          array['pet', 'play', case when extract(doy from v_day)::int % 2 = 0 then 'wish' else 'dress' end])
  on conflict do nothing;
  select * into v from public.park_daily d where d.student_id = p_student and d.day = v_day;
  return v;
end;
$$;

create or replace function public.park_daily_json(p_student uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.park_daily := public.park_daily_row(p_student);
begin
  return jsonb_build_object(
    'day', v.day,
    'each', public.park_coin_rate('daily'),
    'bonus', public.park_coin_rate('daily_all'),
    'tasks', (select jsonb_agg(jsonb_build_object('code', t, 'name', public.park_daily_name(t),
                                                  'done', public.park_daily_done(p_student, t, v.day),
                                                  'claimed', t = any(v.claimed)) order by i)
                from unnest(v.tasks) with ordinality u(t, i)),
    'all', cardinality(v.claimed) >= cardinality(v.tasks));
end;
$$;

-- 這週一 0 點到現在、上週同一段時間的總覽給畫面用
create or replace function public.park_coins_state(p_student uuid)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'balance', public.park_coin_balance(p_student),
    'week', public.park_coin_week(p_student),
    'goal', 150,
    'daily', public.park_daily_json(p_student));
$$;

-- -----------------------------------------------------------------------------
-- 5. 給樂園畫面叫的
-- -----------------------------------------------------------------------------

-- 我的時光幣：先把各遊戲該給的補進帳本，再回傳 {balance, week, goal, daily, fresh:[還沒跳過通知的入帳]}
-- 不是學生回 null。
create or replace function public.park_coins_me()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then return null; end if;
  perform public.park_coin_sync(v_me);
  return public.park_coins_state(v_me) || jsonb_build_object(
    'fresh', coalesce((select jsonb_agg(jsonb_build_object('facility', g.facility, 'name', g.name, 'amount', g.amount, 'n', g.n)
                                        order by g.amount desc)
                         from (select l.facility, f.name, sum(l.amount)::int as amount, count(*)::int as n
                                 from public.park_coin_ledger l
                                 left join public.park_facilities f on f.code = l.facility
                                where l.student_id = v_me and not l.seen and l.amount > 0 and l.facility is not null
                                group by l.facility, f.name) g), '[]'::jsonb));
end;
$$;

-- 「賺到了」的通知看過了
create or replace function public.park_coins_seen()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.park_coin_ledger set seen = true
   where student_id = public.current_student_id() and not seen;
$$;

-- 領每日任務的獎勵（要真的做到了才領得到）；3 個都領了自動加全勤獎
create or replace function public.park_daily_claim(p_task text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v public.park_daily; v_got int := 0;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  v := public.park_daily_row(v_me);
  select * into v from public.park_daily d where d.student_id = v_me and d.day = v.day for update;
  if not p_task = any(v.tasks) then raise exception '今天沒有這個任務'; end if;
  if p_task = any(v.claimed) then raise exception '這個已經領過了'; end if;
  if not public.park_daily_done(v_me, p_task, v.day) then raise exception '還沒做到喔，做完再來領'; end if;
  v_got := public.park_coin_grant(v_me, 'daily:' || v.day || ':' || p_task, public.park_coin_rate('daily'),
                                  null, '每日任務：' || public.park_daily_name(p_task));
  update public.park_daily set claimed = claimed || p_task where student_id = v_me and day = v.day
  returning * into v;
  if cardinality(v.claimed) >= cardinality(v.tasks) then
    v_got := v_got + public.park_coin_grant(v_me, 'daily:' || v.day || ':all', public.park_coin_rate('daily_all'),
                                            null, '每日任務全部完成');
  end if;
  return public.park_coins_state(v_me) || jsonb_build_object('got', v_got);
end;
$$;

-- 商店：{balance, month, items:[{cat, code, name, art, blurb, price, owned, qty, slot, set}]}
--   cat：wear 主角（換裝間的衣飾）／pet 寵物點心／furn 傢俱／month 本月限定（點心或傢俱）
create or replace function public.park_shop()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_month int := extract(month from public.park_today())::int;
begin
  return jsonb_build_object(
    'balance', case when v_me is null then 0 else public.park_coin_balance(v_me) end,
    'month', v_month,
    'items', coalesce((select jsonb_agg(x order by x ->> 'cat', (x ->> 'sort')::int) from (
      select jsonb_build_object('cat', 'wear', 'code', i.code, 'name', i.name, 'art', 'img/traveller/thumb/' || i.code || '.webp',
               'blurb', coalesce(s.name, ''), 'price', i.price, 'slot', i.slot, 'set', i.set_code, 'sort', coalesce(s.sort, 0) * 100 + i.sort,
               'owned', v_me is not null and public.park_wear_owns(v_me, i.code)) as x
        from public.park_wear_items i left join public.park_wear_sets s on s.code = i.set_code
       where i.active and not i.free and i.price is not null
      union all
      select jsonb_build_object('cat', case when si.months is not null then 'month' else si.cat end, 'kind', si.cat,
               'code', si.code, 'name', si.name, 'art', si.art, 'blurb', si.blurb, 'price', si.price, 'sort', si.sort,
               'owned', si.cat = 'furn' and exists (select 1 from public.park_student_furniture f
                                                     where f.student_id = v_me and f.item = si.ref),
               'qty', case when si.cat = 'pet' then coalesce((select qty from public.park_pet_inventory v
                                                               where v.student_id = v_me and v.item = si.ref), 0) end)
        from public.park_shop_items si
       where si.active and (si.months is null or v_month = any(si.months))
    ) t), '[]'::jsonb));
end;
$$;

-- 買東西：p_cat 'wear'（衣飾 code）或 'shop'（park_shop_items 的 code）。
-- 錢不夠、已經有了、不在架上都擋掉。同一個人同時按兩次也不會扣兩次。
create or replace function public.park_shop_buy(p_cat text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_price int; v_name text; v_si public.park_shop_items;
        v_month int := extract(month from public.park_today())::int; v_n int;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  perform pg_advisory_xact_lock(hashtext('park_coin:' || v_me::text));
  if p_cat = 'wear' then
    select i.price, i.name into v_price, v_name from public.park_wear_items i
     where i.code = p_code and i.active and not i.free and i.price is not null;
    if v_price is null then raise exception '商店沒有賣這件'; end if;
    if public.park_wear_owns(v_me, p_code) then raise exception '你已經有「%」了', v_name; end if;
    if public.park_coin_balance(v_me) < v_price then raise exception '時光幣不夠，再去冒險賺一點吧'; end if;
    insert into public.park_coin_ledger (student_id, source, amount, note)
    values (v_me, 'buy:wear:' || p_code, -v_price, '買了「' || v_name || '」');
    insert into public.park_student_wear (student_id, item, source) values (v_me, p_code, 'shop');
  elsif p_cat = 'shop' then
    select * into v_si from public.park_shop_items si
     where si.code = p_code and si.active and (si.months is null or v_month = any(si.months));
    if v_si.code is null then raise exception '商店沒有賣這個（可能下架了）'; end if;
    v_name := v_si.name;
    if v_si.cat = 'furn' and exists (select 1 from public.park_student_furniture f where f.student_id = v_me and f.item = v_si.ref) then
      raise exception '你已經有「%」了', v_name;
    end if;
    if v_si.cat = 'pet' and coalesce((select qty from public.park_pet_inventory v where v.student_id = v_me and v.item = v_si.ref), 0) >= 9 then
      raise exception '背包裡的「%」已經很多了，先餵完再買', v_name;
    end if;
    if public.park_coin_balance(v_me) < v_si.price then raise exception '時光幣不夠，再去冒險賺一點吧'; end if;
    select count(*) + 1 into v_n from public.park_coin_ledger where student_id = v_me and source like 'buy:' || p_code || ':%';
    insert into public.park_coin_ledger (student_id, source, amount, note)
    values (v_me, 'buy:' || p_code || ':' || v_n, -v_si.price, '買了「' || v_name || '」');
    if v_si.cat = 'furn' then
      insert into public.park_student_furniture (student_id, item) values (v_me, v_si.ref);
    else
      insert into public.park_pet_inventory as v (student_id, item, qty) values (v_me, v_si.ref, 1)
      on conflict (student_id, item) do update set qty = v.qty + 1;
    end if;
  else
    raise exception '不知道要買什麼';
  end if;
  return public.park_shop() || jsonb_build_object('bought', v_name);
end;
$$;

-- 班級排行：本週冒險值（這週新賺的時光幣，花掉不扣），每人旁邊掛代表勳章。
-- 同班同學或這班的老師才看得到。只列前 10 名（0 分的不列），另外回傳自己的名次，避免墊底的人被看見。
-- 算之前先幫全班補帳（別人在島上賺的還沒進樂園也算得到；通知照樣留給本人看）。
-- 回傳 {code, name, rows:[{rank, id, nickname, look, frame, medal:{name, art, rarity}, week, me}], me:{rank, week}|null, total}
create or replace function public.park_class_board(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_me uuid := public.current_student_id();
  v_m uuid;
  v_out jsonb;
begin
  if not (public.is_teacher_of(v_code)
          or exists (select 1 from public.park_class_members where class_code = v_code and student_id = v_me)) then
    raise exception '你不在這個班';
  end if;
  for v_m in select student_id from public.park_class_members where class_code = v_code loop
    perform public.park_coin_sync(v_m);
  end loop;
  with w as (
    select m.student_id, st.nickname, public.park_coin_week(m.student_id) as week
      from public.park_class_members m join public.students st on st.id = m.student_id
     where m.class_code = v_code
  ), r as (
    select w.*, case when w.week > 0 then rank() over (order by w.week desc) end as rank from w
  )
  select jsonb_build_object(
    'code', v_code,
    'name', (select c.name from public.classes c where c.code = v_code),
    'total', (select count(*) from w),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                'rank', r.rank, 'id', r.student_id, 'nickname', r.nickname, 'week', r.week, 'me', r.student_id = v_me,
                'look', t.look, 'frame', coalesce(p.frame, 'plain'),
                'medal', (select jsonb_build_object('name', s.name, 'art', s.art, 'rarity', s.rarity)
                            from public.park_stamps s
                            join public.park_student_stamps x on x.facility = s.facility and x.stamp = s.code and x.student_id = r.student_id
                           where s.facility || '/' || s.code = p.featured))
              order by r.rank, r.nickname)
              from r left join public.park_profiles p on p.student_id = r.student_id
                     left join public.park_travellers t on t.student_id = r.student_id
             where r.rank is not null and r.rank <= 10), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', r.rank, 'week', r.week) from r where r.student_id = v_me))
  into v_out;
  return v_out;
end;
$$;

-- 寵物島要知道買了哪些傢俱
create or replace function public.park_my_furniture()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(item order by got_at), '[]'::jsonb)
    from public.park_student_furniture where student_id = public.current_student_id();
$$;

-- -----------------------------------------------------------------------------
-- 6. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_coin_rate(text), public.park_today(), public.park_week_start(), public.park_coin_balance(uuid),
  public.park_coin_week(uuid), public.park_coin_grant(uuid, text, int, text, text), public.guardian_coin_sources(uuid),
  public.park_coin_sync(uuid), public.park_daily_name(text), public.park_daily_done(uuid, text, date),
  public.park_daily_row(uuid), public.park_daily_json(uuid), public.park_coins_state(uuid),
  public.park_coins_me(), public.park_coins_seen(), public.park_daily_claim(text), public.park_shop(),
  public.park_shop_buy(text, text), public.park_my_furniture(), public.park_class_board(text)
  from public, anon, authenticated;
grant execute on function
  public.park_coins_me(), public.park_coins_seen(), public.park_daily_claim(text), public.park_shop(),
  public.park_shop_buy(text, text), public.park_my_furniture(), public.park_class_board(text)
  to authenticated;
grant execute on function public.park_shop() to anon;
