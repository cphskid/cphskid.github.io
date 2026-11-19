-- =============================================================================
-- 聖誕活動「雪花聖誕村」：雪花結晶（活動貨幣）、降臨月曆、雪山滑雪橇紀錄、全站大聖誕樹的總數
-- 2026-11-19 串「提案島嶼風格與聖誕活動」，Chuck 選雪花 A 方案：
--   滑雪 12＋學習設施 10＋每日任務 5＋寵物小遊戲 3，每天最多 30；降臨月曆另外算。
--   活動 11/25～12/31；結束後剩下的雪花 10 片換 50 時光幣（打開樂園時自動換）。
-- 依賴：park_coins.sql（帳本、park_today、park_shop_items）、park_pet.sql（背包、小遊戲紀錄）。重跑不會壞資料。
-- =============================================================================

-- 活動期間（測試庫可以把 starts 改早一點試玩：update park_snow_cfg set starts = '2026-11-19'）
create table if not exists public.park_snow_cfg (
  id     int primary key default 1 check (id = 1),
  starts date not null,
  ends   date not null
);
insert into public.park_snow_cfg (id, starts, ends) values (1, '2026-11-25', '2026-12-31') on conflict (id) do nothing;
-- 降臨月曆第 1 格是哪一天（正式 12/1；測試庫可以改成今天試開）
alter table public.park_snow_cfg add column if not exists advent_from date not null default '2026-12-01';
alter table public.park_snow_cfg enable row level security;
revoke all on public.park_snow_cfg from public, anon, authenticated;

-- 雪花帳本：一筆一個來源（source 唯一，重算不會重複發）
--   kind：ski 滑雪／learn 學習設施／daily 每日任務／pet 寵物小遊戲／advent 降臨月曆／buy 換東西（負的）／convert 活動結束換時光幣（負的）
create table if not exists public.park_snow_ledger (
  student_id uuid not null references public.students(id) on delete cascade,
  source     text not null,
  kind       text not null check (kind in ('ski', 'learn', 'daily', 'pet', 'advent', 'buy', 'convert')),
  amount     int  not null,
  day        date not null default (now() at time zone 'Asia/Taipei')::date,
  created_at timestamptz not null default now(),
  primary key (student_id, source)
);
create index if not exists park_snow_ledger_day on public.park_snow_ledger (day, kind);
alter table public.park_snow_ledger enable row level security;
revoke all on public.park_snow_ledger from public, anon, authenticated;

-- 滑雪紀錄（只有自己看得到最遠紀錄）
create table if not exists public.park_snow_ski (
  student_id uuid primary key references public.students(id) on delete cascade,
  best       int not null default 0,
  runs       int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.park_snow_ski enable row level security;
revoke all on public.park_snow_ski from public, anon, authenticated;

-- 降臨月曆：開過哪幾格（late＝用補開機會開的）
create table if not exists public.park_snow_advent (
  student_id uuid not null references public.students(id) on delete cascade,
  day        int  not null check (day between 1 and 25),
  late       boolean not null default false,
  opened_at  timestamptz not null default now(),
  primary key (student_id, day)
);
alter table public.park_snow_advent enable row level security;
revoke all on public.park_snow_advent from public, anon, authenticated;

-- 商店：用雪花換（snow_price）；snow_only＝不能用時光幣買（麋鹿雪橇）
-- （欄位 snow_price、snow_only 開在 park_coins.sql）
update public.park_shop_items set snow_price = round(price / 10.0)::int where code like any (array['theme-xmas', 'furn-xm-%', 'furn-house-ginger']) and snow_price is null;
insert into public.park_shop_items (code, cat, ref, name, art, blurb, price, months, sort, sale_from, sale_to, snow_price, snow_only) values
  ('furn-xm-sled', 'furn', 'xm-sled', '麋鹿雪橇', 'img/pet/furniture/xm-sled.webp', '雪花限定：只能用雪花結晶換', 1, null, 508, '2026-11-25', '2026-12-31', 30, true)
on conflict (code) do update set name = excluded.name, art = excluded.art, blurb = excluded.blurb, snow_price = excluded.snow_price,
  snow_only = excluded.snow_only, sale_from = excluded.sale_from, sale_to = excluded.sale_to, sort = excluded.sort;

-- 每天各來源上限
create or replace function public.park_snow_cap(p_kind text)
returns int language sql immutable as $$
  select case p_kind when 'ski' then 12 when 'learn' then 10 when 'daily' then 5 when 'pet' then 3 else 0 end;
$$;

create or replace function public.park_snow_balance(p_student uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0)::int from public.park_snow_ledger where student_id = p_student;
$$;

-- 發雪花：照當天那一類的上限扣掉已經拿的，回傳真的發了幾片
create or replace function public.park_snow_give(p_student uuid, p_source text, p_kind text, p_amount int, p_day date)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_left int; v_n int;
begin
  if p_amount <= 0 or exists (select 1 from public.park_snow_ledger where student_id = p_student and source = p_source) then return 0; end if;
  if p_kind = 'advent' then v_n := p_amount;
  else
    select public.park_snow_cap(p_kind) - coalesce(sum(amount), 0) into v_left from public.park_snow_ledger
     where student_id = p_student and kind = p_kind and day = p_day;
    v_n := least(p_amount, greatest(v_left, 0));
  end if;
  if v_n <= 0 then return 0; end if;
  insert into public.park_snow_ledger (student_id, source, kind, amount, day) values (p_student, p_source, p_kind, v_n, p_day)
  on conflict do nothing;
  return v_n;
end;
$$;

-- 從時光幣帳本、寵物小遊戲紀錄補發雪花（只算活動期間；打開樂園時叫）
--   學習設施：開拓者（island:）、守護異世界（guardian:play / guardian:stamp）、時光實驗室（lab:）、試煉島（quiz: / quizfix:）每一筆 +2，
--            過關（…:clear）或守護蓋章 +4（第一次過關才會有這筆）；每天最多 10
--   每日任務：當天全部做完（daily:<日期>:all）+5
--   寵物小遊戲：釣魚、澆果樹、烤點心每玩一次 +1，每天最多 3
create or replace function public.park_snow_sync(p_student uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.park_snow_cfg; r record; v_today date := public.park_today();
begin
  select * into c from public.park_snow_cfg where id = 1;
  if p_student is null or v_today < c.starts then return; end if;
  for r in select l.source, (l.created_at at time zone 'Asia/Taipei')::date as d from public.park_coin_ledger l
            where l.student_id = p_student and l.amount > 0
              and l.created_at >= (c.starts::timestamp at time zone 'Asia/Taipei') and (l.created_at at time zone 'Asia/Taipei')::date <= c.ends
              and not exists (select 1 from public.park_snow_ledger s where s.student_id = p_student and s.source = 'c:' || l.source)
            order by l.created_at loop
    if r.source like 'daily:%:all' then
      perform public.park_snow_give(p_student, 'c:' || r.source, 'daily', 5, r.d);
    elsif r.source ~ '^(island|lab|quiz|quizfix|guardian:play|guardian:stamp):' then
      perform public.park_snow_give(p_student, 'c:' || r.source, 'learn',
        case when r.source like '%:clear' or r.source like 'guardian:stamp:%' then 4 else 2 end, r.d);
    end if;
  end loop;
  for r in select g.game, g.day, g.n from public.park_pet_game_log g
            where g.student_id = p_student and g.day between c.starts and c.ends loop
    for k in 1 .. least(r.n, 3) loop
      perform public.park_snow_give(p_student, 'pet:' || r.game || ':' || r.day || ':' || k, 'pet', 1, r.day);
    end loop;
  end loop;
end;
$$;

-- 降臨月曆每一格的禮物：kind snow（雪花 n 片）／pet（點心 ref×n）／furn（傢俱 ref）
create or replace function public.park_snow_gift(p_day int)
returns jsonb language sql immutable as $$
  select (array[
    '{"kind":"snow","n":5}', '{"kind":"pet","ref":"biscuit","n":2}', '{"kind":"snow","n":5}', '{"kind":"pet","ref":"candy","n":2}',
    '{"kind":"snow","n":6}', '{"kind":"pet","ref":"cook-honey","n":2}', '{"kind":"snow","n":6}', '{"kind":"furn","ref":"xm-lamp"}',
    '{"kind":"snow","n":7}', '{"kind":"pet","ref":"fish","n":2}', '{"kind":"snow","n":7}', '{"kind":"pet","ref":"cook-cream","n":2}',
    '{"kind":"snow","n":8}', '{"kind":"pet","ref":"apple","n":2}', '{"kind":"snow","n":8}', '{"kind":"furn","ref":"xm-gifts"}',
    '{"kind":"snow","n":8}', '{"kind":"pet","ref":"cook-choco","n":2}', '{"kind":"snow","n":9}', '{"kind":"pet","ref":"seeds","n":3}',
    '{"kind":"snow","n":9}', '{"kind":"pet","ref":"cook-bait","n":3}', '{"kind":"snow","n":10}', '{"kind":"snow","n":10}',
    '{"kind":"furn","ref":"xm-sled"}'
  ])[p_day]::jsonb;
$$;

-- 月曆的「今天是第幾格」：12/1＝1、12/25＝25；還沒到是 0；12/25 以後是 25
create or replace function public.park_snow_advent_today()
returns int language sql stable set search_path = public, pg_temp as $$
  select greatest(0, least(25, (public.park_today() - c.advent_from) + 1))::int from public.park_snow_cfg c where c.id = 1;
$$;

-- 補開機會＝月曆第 1 格那天起每日任務全部做完的天數－已經補開的格數
create or replace function public.park_snow_makeups(p_student uuid)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(0,
    (select count(*) from public.park_coin_ledger l where l.student_id = p_student and l.source like 'daily:%:all'
        and split_part(l.source, ':', 2) >= (select to_char(advent_from, 'YYYY-MM-DD') from public.park_snow_cfg where id = 1))
    - (select count(*) from public.park_snow_advent a where a.student_id = p_student and a.late))::int;
$$;

-- 全站大聖誕樹：活動期間大家「賺到」的雪花總數（換東西不扣）
create or replace function public.park_snow_tree_total()
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0)::int from public.park_snow_ledger where amount > 0;
$$;

-- 活動結束：剩下的雪花 10 片換 50 時光幣（一個人一次）
create or replace function public.park_snow_convert(p_student uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.park_snow_cfg; v_bal int; v_coins int;
begin
  select * into c from public.park_snow_cfg where id = 1;
  if public.park_today() <= c.ends then return 0; end if;
  if exists (select 1 from public.park_snow_ledger where student_id = p_student and source = 'convert:' || c.ends) then return 0; end if;
  v_bal := public.park_snow_balance(p_student);
  v_coins := (v_bal / 10) * 50;
  if v_bal <= 0 then return 0; end if;
  insert into public.park_snow_ledger (student_id, source, kind, amount) values (p_student, 'convert:' || c.ends, 'convert', -v_bal);
  if v_coins > 0 then perform public.park_coin_grant(p_student, 'snow-convert:' || c.ends, v_coins, null, '聖誕活動剩下的雪花結晶換成時光幣'); end if;
  return v_coins;
end;
$$;

-- 狀態：{on, starts, ends, balance, today:{ski,learn,daily,pet}, caps, ski:{best,runs}, advent:{today, opened:[{day,late}], makeups}, tree:{total}, converted}
create or replace function public.park_snow_me()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); c public.park_snow_cfg; v_today date := public.park_today(); v_conv int := 0;
begin
  select * into c from public.park_snow_cfg where id = 1;
  if v_me is not null then
    perform pg_advisory_xact_lock(hashtext('park_snow:' || v_me::text));
    perform public.park_snow_sync(v_me);
    v_conv := public.park_snow_convert(v_me);
  end if;
  return jsonb_build_object(
    'on', v_today between c.starts and c.ends, 'starts', c.starts, 'ends', c.ends,
    'balance', case when v_me is null then 0 else public.park_snow_balance(v_me) end,
    'today', (select coalesce(jsonb_object_agg(k, coalesce((select sum(amount) from public.park_snow_ledger
                 where student_id = v_me and kind = k and day = v_today), 0)), '{}') from unnest(array['ski', 'learn', 'daily', 'pet']) k),
    'caps', jsonb_build_object('ski', 12, 'learn', 10, 'daily', 5, 'pet', 3),
    'ski', coalesce((select jsonb_build_object('best', best, 'runs', runs) from public.park_snow_ski where student_id = v_me), '{"best":0,"runs":0}'),
    'advent', jsonb_build_object('today', case when v_today between c.starts and c.ends then public.park_snow_advent_today() else 0 end,
      'opened', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'late', late) order by day) from public.park_snow_advent where student_id = v_me), '[]'),
      'makeups', case when v_me is null then 0 else public.park_snow_makeups(v_me) end),
    'tree', jsonb_build_object('total', public.park_snow_tree_total()),
    'converted', v_conv);
end;
$$;

-- 滑雪一趟結束：p_snow 撿到幾片（伺服器照每天 12 片上限發）、p_dist 滑多遠（公尺）
create or replace function public.park_snow_ski_done(p_snow int, p_dist int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); c public.park_snow_cfg; v_got int := 0; v_n int; v_best int;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  select * into c from public.park_snow_cfg where id = 1;
  perform pg_advisory_xact_lock(hashtext('park_snow:' || v_me::text));
  insert into public.park_snow_ski as k (student_id, best, runs) values (v_me, greatest(coalesce(p_dist, 0), 0), 1)
  on conflict (student_id) do update set best = greatest(k.best, excluded.best), runs = k.runs + 1, updated_at = now()
  returning best, runs into v_best, v_n;
  if public.park_today() between c.starts and c.ends then
    v_got := public.park_snow_give(v_me, 'ski:' || public.park_today() || ':' || v_n, 'ski', least(greatest(coalesce(p_snow, 0), 0), 40), public.park_today());
  end if;
  return public.park_snow_me() || jsonb_build_object('got', v_got, 'best', v_best);
end;
$$;

-- 開降臨月曆一格：今天那格隨時可開；以前沒開的要用補開機會
create or replace function public.park_snow_advent_open(p_day int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); c public.park_snow_cfg; v_t int; v_late boolean; g jsonb;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  select * into c from public.park_snow_cfg where id = 1;
  if public.park_today() not between c.starts and c.ends then raise exception '聖誕活動期間才能開月曆'; end if;
  perform pg_advisory_xact_lock(hashtext('park_snow:' || v_me::text));
  v_t := public.park_snow_advent_today();
  if p_day < 1 or p_day > 25 or p_day > v_t then raise exception '這一格還沒到時間喔'; end if;
  if exists (select 1 from public.park_snow_advent where student_id = v_me and day = p_day) then raise exception '這一格已經開過了'; end if;
  v_late := p_day < v_t;
  if v_late and public.park_snow_makeups(v_me) <= 0 then raise exception '完成今天的每日任務，就能補開一格'; end if;
  insert into public.park_snow_advent (student_id, day, late) values (v_me, p_day, v_late);
  g := public.park_snow_gift(p_day);
  if g ->> 'kind' = 'snow' then
    perform public.park_snow_give(v_me, 'advent:' || p_day, 'advent', (g ->> 'n')::int, public.park_today());
  elsif g ->> 'kind' = 'pet' then
    insert into public.park_pet_inventory as v (student_id, item, qty) values (v_me, g ->> 'ref', (g ->> 'n')::int)
    on conflict (student_id, item) do update set qty = v.qty + excluded.qty;
  else
    insert into public.park_student_furniture (student_id, item) values (v_me, g ->> 'ref') on conflict do nothing;
  end if;
  return public.park_snow_me() || jsonb_build_object('gift', g || jsonb_build_object('day', p_day));
end;
$$;

-- 用雪花換商店的東西（有 snow_price 的）；活動期間才能換
create or replace function public.park_snow_buy(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_si public.park_shop_items; c public.park_snow_cfg;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  select * into c from public.park_snow_cfg where id = 1;
  select * into v_si from public.park_shop_items where code = p_code and active and snow_price is not null;
  if v_si.code is null then raise exception '這個不能用雪花換'; end if;
  if public.park_today() < greatest(c.starts, coalesce(v_si.sale_from, c.starts)) then raise exception '「%」11/25 才能換', v_si.name; end if;
  if public.park_today() > least(c.ends, coalesce(v_si.sale_to, c.ends)) then raise exception '聖誕活動結束了'; end if;
  perform pg_advisory_xact_lock(hashtext('park_snow:' || v_me::text));
  if v_si.cat in ('furn', 'theme') and exists (select 1 from public.park_student_furniture where student_id = v_me and item = v_si.ref) then
    raise exception '你已經有「%」了', v_si.name;
  end if;
  if public.park_snow_balance(v_me) < v_si.snow_price then raise exception '雪花結晶不夠，去滑雪或玩遊戲多收集一點吧'; end if;
  insert into public.park_snow_ledger (student_id, source, kind, amount) values (v_me, 'buy:' || p_code, 'buy', -v_si.snow_price);
  insert into public.park_student_furniture (student_id, item) values (v_me, v_si.ref) on conflict do nothing;
  return public.park_shop() || jsonb_build_object('bought', v_si.name, 'snow', public.park_snow_balance(v_me));
end;
$$;

revoke all on function public.park_snow_cap(text), public.park_snow_balance(uuid), public.park_snow_give(uuid, text, text, int, date),
  public.park_snow_sync(uuid), public.park_snow_makeups(uuid), public.park_snow_convert(uuid) from public, anon, authenticated;
grant execute on function public.park_snow_me(), public.park_snow_ski_done(int, int), public.park_snow_advent_open(int),
  public.park_snow_buy(text), public.park_snow_tree_total() to authenticated;
