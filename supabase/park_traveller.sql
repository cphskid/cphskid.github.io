-- =============================================================================
-- 時空冒險樂園：時空旅人換裝（2D 疊圖紙娃娃）
--
-- 每個學生有一個「時空旅人」：同一個身體，臉型、髮型、頭飾、上衣、褲子和鞋、手持、背後
-- 七個位置各疊一張圖（img/traveller/<code>.webp，448×600，全部跟身體對齊）。
--   臉型、髮型：大家都有，隨時可以換（男生、女生、不特別表現性別都靠這兩個）。
--   衣服配件：建角色時挑一套起始套裝（整套 4 件送你），其他的之後在樂園商店用時光幣買。
--   商店還沒開：沒有的衣服可以在換裝間「試穿」看看，但存不起來。
--
-- 一樣只「加表、加函式」，守護異世界的東西一個都不動。
--
-- 怎麼套：Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。
-- 順序：守護異世界 schema.sql → park_accounts.sql → park_teacher.sql → park_passport.sql → 這份。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------

-- 套裝：starter＝建角色時可以挑來當起始套裝的
create table if not exists public.park_wear_sets (
  code    text primary key check (code ~ '^[a-z][a-z0-9-]{1,30}$'),
  name    text not null,
  blurb   text not null default '',
  starter boolean not null default false,
  sort    int not null default 0
);

-- 衣飾。free＝每個人都有（臉型、髮型）；price＝商店價（時光幣，商店開了才用得到，null＝不賣）；
-- hides_hair＝戴上時把頭髮藏起來（例如太空頭盔）。
create table if not exists public.park_wear_items (
  code       text primary key check (code ~ '^[a-z][a-z0-9-]{1,30}$'),
  slot       text not null check (slot in ('face', 'hair', 'hat', 'top', 'bottom', 'hand', 'back')),
  name       text not null,
  set_code   text references public.park_wear_sets(code) on update cascade on delete set null,
  free       boolean not null default false,
  price      int check (price is null or price >= 0),
  hides_hair boolean not null default false,
  active     boolean not null default true,
  sort       int not null default 0
);

-- 學生的旅人：look＝現在穿什麼 {"face":null,"hair":"hair-crop","hat":null,...}
create table if not exists public.park_travellers (
  student_id  uuid primary key references public.students(id) on delete cascade,
  look        jsonb not null default '{}',
  starter_set text references public.park_wear_sets(code) on update cascade on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 學生擁有的衣飾（free 的不用記）。source：starter 起始套裝 / shop 商店 / event 活動 / story 遊戲裡拿到
create table if not exists public.park_student_wear (
  student_id uuid not null references public.students(id) on delete cascade,
  item       text not null references public.park_wear_items(code) on update cascade on delete cascade,
  source     text not null default 'starter',
  got_at     timestamptz not null default now(),
  primary key (student_id, item)
);

-- -----------------------------------------------------------------------------
-- 2. 初始資料（重跑會更新名字和價錢，不會多出東西）
-- -----------------------------------------------------------------------------
insert into public.park_wear_sets (code, name, blurb, starter, sort) values
  ('street', '韓系街頭', '漁夫帽、牛仔外套配帽T、工裝寬褲老爹鞋，再拿一台底片相機。', true, 1),
  ('tech',   '科技機能', 'AR 眼鏡、會發光的機能外套和鞋子，還有一台跟著你飛的小無人機。', true, 2),
  ('tw',     '台灣潮',   '黑熊棒球帽、客家花布襯衫、寬短褲配拖鞋，手上一杯黑糖珍奶。', true, 3)
on conflict (code) do update set name = excluded.name, blurb = excluded.blurb, starter = excluded.starter, sort = excluded.sort;

insert into public.park_wear_items (code, slot, name, set_code, free, price, sort) values
  ('face-girl',     'face',   '女孩',           null,     true, null, 1),
  ('face-boy',      'face',   '男孩',           null,     true, null, 2),
  ('hair-crop',     'hair',   '紋理短髮',       null,     true, null, 1),
  ('hair-wolf',     'hair',   '狼尾',           null,     true, null, 2),
  ('hair-wavy',     'hair',   '長捲髮',         null,     true, null, 3),
  ('hair-pony',     'hair',   '高馬尾',         null,     true, null, 4),
  ('hat-bucket',    'hat',    '燈芯絨漁夫帽',   'street', false, 60, 1),
  ('hat-visor',     'hat',    'AR 眼鏡',        'tech',   false, 60, 2),
  ('hat-cap',       'hat',    '黑熊棒球帽',     'tw',     false, 60, 3),
  ('top-street',    'top',    '牛仔外套配帽T',  'street', false, 100, 1),
  ('top-tech',      'top',    '發光機能外套',   'tech',   false, 100, 2),
  ('top-floral',    'top',    '客家花布襯衫',   'tw',     false, 100, 3),
  ('bottom-wide',   'bottom', '工裝寬褲老爹鞋', 'street', false, 80, 1),
  ('bottom-tech',   'bottom', '機能褲發光鞋',   'tech',   false, 80, 2),
  ('bottom-shorts', 'bottom', '寬短褲配拖鞋',   'tw',     false, 80, 3),
  ('hand-camera',   'hand',   '底片相機',       'street', false, 50, 1),
  ('hand-tea',      'hand',   '黑糖珍奶',       'tw',     false, 50, 2),
  ('back-drone',    'back',   '小無人機',       'tech',   false, 120, 1)
on conflict (code) do update set slot = excluded.slot, name = excluded.name, set_code = excluded.set_code,
  free = excluded.free, price = excluded.price, sort = excluded.sort;

-- -----------------------------------------------------------------------------
-- 3. 讀取規則：目錄大家都看得到；自己的旅人和衣櫃只有本人看得到。寫入一律走函式。
-- -----------------------------------------------------------------------------
alter table public.park_wear_sets    enable row level security;
alter table public.park_wear_items   enable row level security;
alter table public.park_travellers   enable row level security;
alter table public.park_student_wear enable row level security;

revoke all on public.park_wear_sets, public.park_wear_items, public.park_travellers, public.park_student_wear
  from anon, authenticated;
grant select on public.park_wear_sets, public.park_wear_items to anon, authenticated;
grant select on public.park_travellers, public.park_student_wear to authenticated;

drop policy if exists park_wear_sets_read on public.park_wear_sets;
create policy park_wear_sets_read on public.park_wear_sets for select to anon, authenticated using (true);
drop policy if exists park_wear_items_read on public.park_wear_items;
create policy park_wear_items_read on public.park_wear_items for select to anon, authenticated using (true);
drop policy if exists park_travellers_read on public.park_travellers;
create policy park_travellers_read on public.park_travellers for select to authenticated
  using (student_id = public.current_student_id());
drop policy if exists park_student_wear_read on public.park_student_wear;
create policy park_student_wear_read on public.park_student_wear for select to authenticated
  using (student_id = public.current_student_id());

-- -----------------------------------------------------------------------------
-- 4. 小幫手（不開給人直接叫）
-- -----------------------------------------------------------------------------

-- 這件是不是他的（free 的人人都有）
create or replace function public.park_wear_owns(p_student uuid, p_item text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.park_wear_items i where i.code = p_item and i.active and i.free)
      or exists (select 1 from public.park_student_wear w where w.student_id = p_student and w.item = p_item);
$$;

-- 檢查一套穿搭，回傳整理好的 look（七個位置都有 key，沒穿的是 null）。不合規就丟出看得懂的錯誤。
create or replace function public.park_wear_check(p_student uuid, p_look jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_out jsonb := '{"face":null,"hair":null,"hat":null,"top":null,"bottom":null,"hand":null,"back":null}';
        k text; v text; v_slot text;
begin
  if p_look is null or jsonb_typeof(p_look) <> 'object' then raise exception '穿搭的資料不對'; end if;
  for k, v in select * from jsonb_each_text(p_look) loop
    if not v_out ? k then raise exception '沒有「%」這個位置', k; end if;
    if v is null or v = '' then continue; end if;
    select i.slot into v_slot from public.park_wear_items i where i.code = v and i.active;
    if v_slot is null then raise exception '沒有這件衣服'; end if;
    if v_slot <> k then raise exception '這件不能穿在這個位置'; end if;
    if not public.park_wear_owns(p_student, v) then
      raise exception '「%」還不是你的，商店開張後就能買', (select name from public.park_wear_items where code = v);
    end if;
    v_out := jsonb_set(v_out, array[k], to_jsonb(v));
  end loop;
  if v_out ->> 'hair' is null then raise exception '要選一個髮型'; end if;
  return v_out;
end;
$$;

create or replace function public.park_traveller_state(p_student uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'created', t.student_id is not null,
    'look', t.look,
    'starter_set', t.starter_set,
    'owned', coalesce((select jsonb_agg(w.item order by w.got_at, w.item) from public.park_student_wear w
                        where w.student_id = p_student), '[]'))
    from (select p_student as id) me
    left join public.park_travellers t on t.student_id = me.id;
$$;

-- -----------------------------------------------------------------------------
-- 5. 給樂園畫面叫的
-- -----------------------------------------------------------------------------

-- 我的旅人：{created, look, starter_set, owned:[...]}。不是學生回傳 null。
create or replace function public.park_traveller_me()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then return null; end if;
  return public.park_traveller_state(v_me);
end;
$$;

-- 建角色：挑臉型、髮型和一套起始套裝（整套送你、直接穿上）。只能建一次，之後用換裝。
create or replace function public.park_traveller_create(p_face text, p_hair text, p_set text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_look jsonb;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if exists (select 1 from public.park_travellers where student_id = v_me) then
    raise exception '你已經有時空旅人了，去換裝間換衣服吧';
  end if;
  if not exists (select 1 from public.park_wear_sets s where s.code = p_set and s.starter) then
    raise exception '要挑一套起始套裝';
  end if;
  insert into public.park_student_wear (student_id, item, source)
    select v_me, i.code, 'starter' from public.park_wear_items i
     where i.set_code = p_set and i.active and not i.free
    on conflict do nothing;
  v_look := jsonb_build_object('face', nullif(p_face, ''), 'hair', p_hair);
  select v_look || coalesce(jsonb_object_agg(i.slot, i.code), '{}') into v_look
    from public.park_wear_items i where i.set_code = p_set and i.active and not i.free;
  v_look := public.park_wear_check(v_me, v_look);
  insert into public.park_travellers (student_id, look, starter_set) values (v_me, v_look, p_set);
  return public.park_traveller_state(v_me);
end;
$$;

-- 換裝：整套 look 一起存。沒有的衣服不能存（試穿只在畫面上）。
create or replace function public.park_traveller_save(p_look jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_look jsonb;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if not exists (select 1 from public.park_travellers where student_id = v_me) then
    raise exception '先建立你的時空旅人';
  end if;
  v_look := public.park_wear_check(v_me, p_look);
  update public.park_travellers set look = v_look, updated_at = now() where student_id = v_me;
  return public.park_traveller_state(v_me);
end;
$$;

-- 老師名單上的大頭（頭像就是旅人，全班總覽用）：只有這個班的老師看得到
create or replace function public.park_class_looks(p_code text)
returns table (student_id uuid, look jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.student_id, t.look
    from public.park_class_members m
    join public.park_travellers t on t.student_id = m.student_id
   where m.class_code = upper(btrim(coalesce(p_code, '')))
     and public.is_teacher_of(m.class_code);
$$;

-- -----------------------------------------------------------------------------
-- 6. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_wear_owns(uuid, text), public.park_wear_check(uuid, jsonb), public.park_traveller_state(uuid),
  public.park_traveller_me(), public.park_traveller_create(text, text, text), public.park_traveller_save(jsonb),
  public.park_class_looks(text)
  from public, anon, authenticated;
grant execute on function
  public.park_traveller_me(), public.park_traveller_create(text, text, text), public.park_traveller_save(jsonb),
  public.park_class_looks(text)
  to authenticated;
