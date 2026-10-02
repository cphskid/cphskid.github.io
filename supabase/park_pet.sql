-- =============================================================================
-- 時空冒險樂園：主島桌寵（一期）
--
-- 小朋友在樂園村莊養一隻桌寵：會餓、會鬧脾氣，但不會死。
--   餓的規則（規劃書「心情與飢餓」）：一天沒餵會餓、再一天生氣、7 天沒來就睡著。
--   生氣時餵飽了還要摸摸哄一下才會好；睡著的點一下叫醒，醒來是「餓了」。
-- 道具：每天主島免費領基本飼料；各島的招牌點心只從任務拿（在那個遊戲蓋到護照章就送一個）。
-- 成長：吃東西、被摸會長經驗，分幼年、成長、完全體三階段。
-- 老師：班級可以開「上課時間桌寵休息」（週一到週五 8:00–16:00，臺灣時間）。
--
-- 一樣只「加表、加函式」，守護異世界的東西一個都不動。
--
-- 怎麼套：Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。
-- 順序：守護異世界 schema.sql → park_accounts.sql → park_teacher.sql → park_passport.sql → 這份。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------

-- 桌寵的種類。starter＝一開始可以選的。圖在 img/pet/<code>.webp（正式美術 T 系列做好前先用佔位圖）。
create table if not exists public.park_pet_species (
  code    text primary key check (code ~ '^[a-z][a-z0-9-]{1,30}$'),
  name    text not null,
  series  text not null default 'animal',   -- animal / ancient / alien / robot（之後的系列）
  starter boolean not null default false,
  sort    int not null default 0
);

-- 道具。food＝基本食物，special＝各島招牌點心（facility＝從哪座島拿到）。
create table if not exists public.park_pet_items (
  code     text primary key check (code ~ '^[a-z][a-z0-9-]{1,30}$'),
  kind     text not null check (kind in ('food', 'special')),
  name     text not null,
  icon     text not null default '',        -- 正式圖示（T-10）做好前的佔位字
  xp       int  not null default 1 check (xp >= 0),
  facility text references public.park_facilities(code) on update cascade on delete set null,
  sort     int  not null default 0
);

-- 學生的桌寵。一次帶一隻（active），其他的住在窩裡。
create table if not exists public.park_pets (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  species    text not null references public.park_pet_species(code) on update cascade,
  name       text not null,
  xp         int  not null default 0 check (xp >= 0),
  active     boolean not null default true,
  fed_at     timestamptz not null default now(),   -- 上次吃飽的時間：餓不餓由它即時算
  patted_at  timestamptz,                          -- 上次被摸的時間：開不開心
  pat_xp_on  date,                                 -- 摸摸一天只長一次經驗
  sulky      boolean not null default false,       -- 生氣時被餵飽了，還在鬧脾氣（摸摸才好）
  created_at timestamptz not null default now(),
  unique (student_id, species)
);
create unique index if not exists park_pets_one_active on public.park_pets (student_id) where active;

-- 背包
create table if not exists public.park_pet_inventory (
  student_id uuid not null references public.students(id) on delete cascade,
  item       text not null references public.park_pet_items(code) on update cascade on delete cascade,
  qty        int  not null default 0 check (qty >= 0),
  primary key (student_id, item)
);

-- 發過的道具（同一個來源只發一次：每天的飼料、每個護照章的點心）
create table if not exists public.park_pet_grants (
  student_id uuid not null references public.students(id) on delete cascade,
  source     text not null,      -- daily / stamp
  key        text not null,      -- daily：日期；stamp：設施:章
  item       text not null references public.park_pet_items(code) on update cascade on delete cascade,
  qty        int  not null,
  granted_at timestamptz not null default now(),
  seen       boolean not null default false,
  primary key (student_id, source, key)
);

-- 班級設定多一欄：上課時間桌寵休息
alter table public.park_class_settings add column if not exists pet_quiet boolean not null default false;

-- -----------------------------------------------------------------------------
-- 2. 初始資料（重跑會更新名稱與數值）
-- -----------------------------------------------------------------------------
insert into public.park_pet_species (code, name, series, starter, sort) values
  ('puppy',   '小狗',   'animal', true, 1),
  ('kitten',  '小貓',   'animal', true, 2),
  ('hamster', '黃金鼠', 'animal', true, 3)
on conflict (code) do update
  set name = excluded.name, series = excluded.series, starter = excluded.starter, sort = excluded.sort;

insert into public.park_pet_items (code, kind, name, icon, xp, facility, sort) values
  ('kibble',      'food',    '時光飼料',     '🥣', 1, null,             1),
  ('magic-fruit', 'special', '異世界魔法果', '🍎', 5, 'guardian',       2),
  ('rice-ball',   'special', '八堡圳米糰',   '🍙', 5, 'island_pioneer', 3)
on conflict (code) do update
  set kind = excluded.kind, name = excluded.name, icon = excluded.icon, xp = excluded.xp,
      facility = excluded.facility, sort = excluded.sort;

-- -----------------------------------------------------------------------------
-- 3. 讀取規則：目錄大家都看得到；桌寵與背包只有本人看得到。寫入一律走函式。
-- -----------------------------------------------------------------------------
alter table public.park_pet_species   enable row level security;
alter table public.park_pet_items     enable row level security;
alter table public.park_pets          enable row level security;
alter table public.park_pet_inventory enable row level security;
alter table public.park_pet_grants    enable row level security;

revoke all on public.park_pet_species, public.park_pet_items, public.park_pets,
              public.park_pet_inventory, public.park_pet_grants from anon, authenticated;
grant select on public.park_pet_species, public.park_pet_items to anon, authenticated;
grant select on public.park_pets, public.park_pet_inventory to authenticated;

drop policy if exists park_pet_species_read on public.park_pet_species;
create policy park_pet_species_read on public.park_pet_species for select to anon, authenticated using (true);
drop policy if exists park_pet_items_read on public.park_pet_items;
create policy park_pet_items_read on public.park_pet_items for select to anon, authenticated using (true);
drop policy if exists park_pets_read on public.park_pets;
create policy park_pets_read on public.park_pets for select to authenticated
  using (student_id = public.current_student_id());
drop policy if exists park_pet_inventory_read on public.park_pet_inventory;
create policy park_pet_inventory_read on public.park_pet_inventory for select to authenticated
  using (student_id = public.current_student_id());

-- -----------------------------------------------------------------------------
-- 4. 小幫手（不開給人直接叫）
-- -----------------------------------------------------------------------------

-- 經驗 → 階段：0 幼年、12 成長、40 完全體
create or replace function public.park_pet_stage(p_xp int)
returns int language sql immutable set search_path = public, pg_temp as $$
  select case when p_xp >= 40 then 3 when p_xp >= 12 then 2 else 1 end;
$$;

-- 這個學生現在是不是「上課時間桌寵休息」：任何一個班開了，週一到週五 8:00–16:00（臺灣時間）
create or replace function public.park_pet_quiet(p_student uuid, p_at timestamptz default now())
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select extract(isodow from p_at at time zone 'Asia/Taipei') between 1 and 5
     and (p_at at time zone 'Asia/Taipei')::time >= time '08:00'
     and (p_at at time zone 'Asia/Taipei')::time <  time '16:00'
     and exists (select 1 from public.park_class_members m
                   join public.park_class_settings s on s.class_code = m.class_code
                  where m.student_id = p_student and s.pet_quiet);
$$;

-- 桌寵現在的狀態：asleep 睡著 / angry 生氣 / hungry 餓了 / happy 開心 / normal 普通
create or replace function public.park_pet_mood(p public.park_pets, p_at timestamptz default now())
returns text language sql stable set search_path = public, pg_temp as $$
  select case
    when p_at - p.fed_at >= interval '7 days' then 'asleep'
    when p_at - p.fed_at >= interval '2 days' then 'angry'
    when p_at - p.fed_at >= interval '1 day'  then 'hungry'
    when p.sulky then 'angry'
    when p.patted_at is not null and p_at - p.patted_at < interval '6 hours' then 'happy'
    else 'normal' end;
$$;

create or replace function public.park_pet_json(p public.park_pets)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'species', p.species, 'name', p.name, 'active', p.active,
    'xp', p.xp, 'stage', public.park_pet_stage(p.xp),
    'next_xp', case public.park_pet_stage(p.xp) when 1 then 12 when 2 then 40 else null end,
    'mood', public.park_pet_mood(p), 'fed_at', p.fed_at,
    'sulky', p.sulky and now() - p.fed_at < interval '1 day');   -- 吃飽了還在鬧脾氣（要摸摸）
$$;

-- 發道具：每天的免費飼料（背包最多放 9 份）、每個護照章送那座島的招牌點心。回傳這次新發的。
create or replace function public.park_pet_grant(p_student uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_day text := to_char(now() at time zone 'Asia/Taipei', 'YYYY-MM-DD'); v_have int; v_n int; v_out jsonb;
begin
  -- 每天 3 份飼料，背包裡已經很多就少發一點（不囤）
  if not exists (select 1 from public.park_pet_grants g
                  where g.student_id = p_student and g.source = 'daily' and g.key = v_day) then
    select coalesce(sum(qty), 0) into v_have from public.park_pet_inventory
     where student_id = p_student and item = 'kibble';
    v_n := least(3, greatest(0, 9 - v_have));
    insert into public.park_pet_grants (student_id, source, key, item, qty, seen)
    values (p_student, 'daily', v_day, 'kibble', v_n, v_n = 0);
  end if;

  -- 每個護照章送一個那座島的點心（以前蓋的章也補送）
  insert into public.park_pet_grants (student_id, source, key, item, qty)
  select p_student, 'stamp', x.facility || ':' || x.stamp, i.code, 1
    from public.park_student_stamps x
    join public.park_pet_items i on i.facility = x.facility and i.kind = 'special'
   where x.student_id = p_student
  on conflict do nothing;

  -- 還沒放進背包的（seen = false）放進去，並回傳給畫面說「拿到了什麼」
  with fresh as (
    update public.park_pet_grants g set seen = true
     where g.student_id = p_student and not g.seen
    returning g.source, g.key, g.item, g.qty
  )
  select coalesce(jsonb_agg(jsonb_build_object('source', f.source, 'key', f.key, 'item', f.item, 'qty', f.qty)
                            order by f.source, f.key), '[]'::jsonb)
    into v_out from fresh f;
  insert into public.park_pet_inventory as v (student_id, item, qty)
  select p_student, e ->> 'item', sum((e ->> 'qty')::int)
    from jsonb_array_elements(v_out) e group by e ->> 'item'
  on conflict (student_id, item) do update set qty = v.qty + excluded.qty;
  return v_out;
end;
$$;

-- 畫面要的一整包
create or replace function public.park_pet_state(p_student uuid, p_granted jsonb default '[]')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'pets', coalesce((select jsonb_agg(public.park_pet_json(p) order by p.active desc, p.created_at)
                        from public.park_pets p where p.student_id = p_student), '[]'::jsonb),
    'inventory', coalesce((select jsonb_object_agg(v.item, v.qty)
                             from public.park_pet_inventory v where v.student_id = p_student and v.qty > 0), '{}'::jsonb),
    'species', (select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'series', s.series, 'starter', s.starter)
                                 order by s.sort) from public.park_pet_species s),
    'items', (select jsonb_agg(jsonb_build_object('code', i.code, 'kind', i.kind, 'name', i.name, 'icon', i.icon, 'xp', i.xp,
                                                  'facility', i.facility,
                                                  'facility_name', (select f.name from public.park_facilities f where f.code = i.facility))
                               order by i.sort) from public.park_pet_items i),
    'quiet', public.park_pet_quiet(p_student),
    'granted', p_granted);
$$;

-- 取名：1 到 8 個字，跟暱稱一樣過濾不雅字
create or replace function public.park_pet_name_ok(p_name text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if v = '' or length(v) > 8 then raise exception '名字要 1 到 8 個字'; end if;
  if public.nickname_problem(v) is not null then raise exception '這個名字不能用，換一個'; end if;
  return v;
end;
$$;

-- 現在帶在身邊的那隻（上課時間休息中就不能互動）
create or replace function public.park_pet_mine(p_student uuid)
returns public.park_pets language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.park_pets;
begin
  if p_student is null then raise exception '請先登入學生帳號'; end if;
  select * into v from public.park_pets p where p.student_id = p_student and p.active for update;
  if v.id is null then raise exception '你還沒有桌寵'; end if;
  if public.park_pet_quiet(p_student) then raise exception '現在是上課時間，桌寵在休息，放學再來玩'; end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. 給樂園畫面叫的
-- -----------------------------------------------------------------------------

-- 打開桌寵：順便發今天的飼料和護照章的點心
create or replace function public.park_pet_me()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_g jsonb;
begin
  if v_me is null then return null; end if;
  v_g := public.park_pet_grant(v_me);
  return public.park_pet_state(v_me, v_g);
end;
$$;

-- 領養：p_species 給 null 或 'random' 就從一開始的三隻隨機挑。只有第一隻能這樣領。
create or replace function public.park_pet_adopt(p_species text, p_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_sp text; v_name text;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if exists (select 1 from public.park_pets p where p.student_id = v_me) then raise exception '你已經有桌寵了'; end if;
  if p_species is null or p_species = 'random' then
    select s.code into v_sp from public.park_pet_species s where s.starter order by random() limit 1;
  else
    select s.code into v_sp from public.park_pet_species s where s.code = p_species and s.starter;
  end if;
  if v_sp is null then raise exception '沒有這種桌寵'; end if;
  v_name := public.park_pet_name_ok(coalesce(nullif(btrim(p_name), ''), (select name from public.park_pet_species where code = v_sp)));
  insert into public.park_pets (student_id, species, name) values (v_me, v_sp, v_name);
  return public.park_pet_state(v_me);
end;
$$;

-- 餵食：飼料吃飽了就不吃（3 小時內餵過），點心隨時都吃
create or replace function public.park_pet_feed(p_item text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := public.current_student_id();
  v public.park_pets;
  v_i public.park_pet_items;
  v_mood text;
  v_left int;
begin
  v := public.park_pet_mine(v_me);
  v_mood := public.park_pet_mood(v);
  if v_mood = 'asleep' then raise exception '牠在睡覺，先點一下叫醒牠'; end if;
  select * into v_i from public.park_pet_items i where i.code = p_item;
  if v_i.code is null then raise exception '沒有這種食物'; end if;
  if v_i.kind = 'food' and now() - v.fed_at < interval '3 hours' then raise exception '牠吃飽了，等一下再餵'; end if;
  update public.park_pet_inventory set qty = qty - 1
   where student_id = v_me and item = p_item and qty > 0
  returning qty into v_left;
  if v_left is null then raise exception '背包裡沒有了'; end if;
  update public.park_pets
     set fed_at = now(), xp = xp + v_i.xp,
         sulky = (v_mood = 'angry')        -- 餓到生氣：吃飽了還在鬧脾氣
   where id = v.id;
  return public.park_pet_state(v_me) || jsonb_build_object('did', 'feed', 'was', v_mood, 'xp', v_i.xp);
end;
$$;

-- 摸摸：睡著的叫醒（醒來是餓的）；鬧脾氣的哄好；平常會變開心，一天長一次經驗
create or replace function public.park_pet_pat()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := public.current_student_id();
  v public.park_pets;
  v_mood text;
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_xp int := 0;
begin
  v := public.park_pet_mine(v_me);
  v_mood := public.park_pet_mood(v);
  if v_mood = 'asleep' then
    update public.park_pets set fed_at = now() - interval '1 day', sulky = false where id = v.id;
  elsif v_mood in ('angry', 'hungry') and not v.sulky then
    null;   -- 餓的時候不給摸，要先餵
  else
    if v.pat_xp_on is distinct from v_today then v_xp := 1; end if;
    update public.park_pets
       set patted_at = now(), sulky = false, xp = xp + v_xp, pat_xp_on = v_today
     where id = v.id;
  end if;
  return public.park_pet_state(v_me) || jsonb_build_object('did', 'pat', 'was', v_mood, 'xp', v_xp);
end;
$$;

create or replace function public.park_pet_rename(p_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_name text;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  v_name := public.park_pet_name_ok(p_name);
  update public.park_pets set name = v_name where student_id = v_me and active;
  if not found then raise exception '你還沒有桌寵'; end if;
  return public.park_pet_state(v_me);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. 給老師後台叫的：上課時間桌寵休息
-- -----------------------------------------------------------------------------
create or replace function public.park_pet_class_quiet(p_code text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  return coalesce((select s.pet_quiet from public.park_class_settings s where s.class_code = v_code), false);
end;
$$;

create or replace function public.park_pet_set_class_quiet(p_code text, p_quiet boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  insert into public.park_class_settings as s (class_code, pet_quiet) values (v_code, coalesce(p_quiet, false))
  on conflict (class_code) do update set pet_quiet = excluded.pet_quiet, updated_at = now();
  return coalesce(p_quiet, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_pet_stage(int), public.park_pet_quiet(uuid, timestamptz),
  public.park_pet_mood(public.park_pets, timestamptz), public.park_pet_json(public.park_pets),
  public.park_pet_grant(uuid), public.park_pet_state(uuid, jsonb), public.park_pet_name_ok(text),
  public.park_pet_mine(uuid), public.park_pet_me(), public.park_pet_adopt(text, text),
  public.park_pet_feed(text), public.park_pet_pat(), public.park_pet_rename(text),
  public.park_pet_class_quiet(text), public.park_pet_set_class_quiet(text, boolean)
  from public, anon, authenticated;
grant execute on function
  public.park_pet_me(), public.park_pet_adopt(text, text), public.park_pet_feed(text),
  public.park_pet_pat(), public.park_pet_rename(text),
  public.park_pet_class_quiet(text), public.park_pet_set_class_quiet(text, boolean)
  to authenticated;
