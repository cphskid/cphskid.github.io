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
  slot       text not null check (slot in ('face', 'expr', 'hair', 'mask', 'hat', 'top', 'bottom', 'hand', 'back')),
  name       text not null,
  set_code   text references public.park_wear_sets(code) on update cascade on delete set null,
  free       boolean not null default false,
  price      int check (price is null or price >= 0),
  hides_hair boolean not null default false,
  active     boolean not null default true,
  sort       int not null default 0
);
-- months：本月限定，只在那幾個月上架（1～12，null＝常駐）。下架後買過的照樣能穿。
alter table public.park_wear_items add column if not exists months smallint[];
-- 2026-11-28 加兩個位置：expr 表情（疊在臉上，免費）、mask 臉飾（面罩、面具，可以跟帽子一起戴）
alter table public.park_wear_items drop constraint if exists park_wear_items_slot_check;
alter table public.park_wear_items add constraint park_wear_items_slot_check
  check (slot in ('face', 'expr', 'hair', 'mask', 'hat', 'top', 'bottom', 'hand', 'back'));
-- 聖誕活動（2026-11-28）：snow_price＝也能用雪花結晶換（park_snow.sql 的 park_snow_buy）；snow_only＝只能用雪花換
alter table public.park_wear_items add column if not exists snow_price int;
alter table public.park_wear_items add column if not exists snow_only boolean not null default false;

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
  ('tw',     '台灣潮',   '黑熊棒球帽、客家花布襯衫、寬短褲配拖鞋，手上一杯黑糖珍奶。', true, 3),
  ('witch',   '小巫師',     '萬聖節限定：星星尖帽、星月巫師袍，再騎一支掃帚。', false, 11),
  ('pumpkin', '南瓜騎士',   '萬聖節限定：南瓜帽、南瓜騎士服，提一盞南瓜燈去要糖。', false, 12),
  ('vampire', '小吸血鬼',   '萬聖節限定：紅領披風小禮服、黑皮鞋，背上一對蝙蝠翅膀。', false, 13),
  -- 常駐商店套裝（2026-11-28，配寵物島的島嶼風格）
  ('ocean',   '海底探險家', '浮潛蛙鏡、潛水衣配蛙鞋，背一個海龜殼背包。', false, 21),
  ('space',   '月球小隊員', '星星天線、太空衣配月球靴，再背一台小火箭背包。', false, 22),
  ('safari',  '恐龍探險隊', '探險帽、多口袋背心配登山靴，後面還拖著一條恐龍尾巴。', false, 23),
  ('farm',    '小農夫',     '紅頭巾、格子襯衫吊帶褲配雨鞋，提一籃新鮮雞蛋。', false, 24),
  -- 聖誕（11～12 月限定，時光幣或雪花結晶都能換）
  ('santa',    '聖誕老公公', '聖誕限定：聖誕帽、毛邊紅外套和靴子，背一大袋禮物。', false, 31),
  ('reindeer', '小麋鹿',     '聖誕限定：麋鹿角髮箍、鈴鐺毛毛衣和麋鹿蹄靴。', false, 32),
  ('elf',      '聖誕小精靈', '聖誕限定：鈴鐺尖帽、綠色小精靈服、條紋褲襪，拿一根大拐杖糖。', false, 33),
  ('cozy',     '暖暖冬日',   '聖誕限定：毛球毛帽、聖誕毛衣配圍巾、雪靴，捧一杯熱可可。', false, 34)
on conflict (code) do update set name = excluded.name, blurb = excluded.blurb, starter = excluded.starter, sort = excluded.sort;

insert into public.park_wear_items (code, slot, name, set_code, free, price, sort) values
  ('face-girl',     'face',   '女孩',           null,     true, null, 1),
  ('face-boy',      'face',   '男孩',           null,     true, null, 2),
  ('hair-crop',     'hair',   '紋理短髮',       null,     true, null, 1),
  ('hair-wolf',     'hair',   '狼尾',           null,     true, null, 2),
  ('hair-wavy',     'hair',   '長捲髮',         null,     true, null, 3),
  ('hair-pony',     'hair',   '高馬尾',         null,     true, null, 4),
  ('hair-school',   'hair',   '學生短髮',       null,     true, null, 5),
  ('hair-bob',      'hair',   '妹妹頭',         null,     true, null, 6),
  ('hair-spiky',    'hair',   '運動刺刺頭',     null,     true, null, 7),
  ('hair-twin',     'hair',   '綁兩邊',         null,     true, null, 8),
  ('hair-comma',    'hair',   '韓系逗號瀏海',   null,     true, null, 9),
  ('hair-buns',     'hair',   '雙丸子頭',       null,     true, null, 10),
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
  ('back-drone',    'back',   '小無人機',       'tech',   false, 120, 1),
  -- 常駐頭飾：不屬於套裝，商店單賣
  ('hat-bow',       'hat',    '蝴蝶結髮夾',     null,     false, 40, 21),
  ('hat-cat',       'hat',    '貓耳髮箍',       null,     false, 50, 22),
  ('hat-glasses',   'hat',    '圓框眼鏡',       null,     false, 50, 23),
  ('hat-phones',    'hat',    '耳罩耳機',       null,     false, 60, 24),
  ('hat-straw',     'hat',    '草編遮陽帽',     null,     false, 60, 25),
  ('hat-goggles',   'hat',    '時空飛行護目鏡', null,     false, 70, 26)
on conflict (code) do update set slot = excluded.slot, name = excluded.name, set_code = excluded.set_code,
  free = excluded.free, price = excluded.price, sort = excluded.sort;

-- 萬聖節（10 月限定）
insert into public.park_wear_items (code, slot, name, set_code, free, price, months, sort) values
  ('hat-witch',      'hat',    '星星巫師帽',   'witch',   false, 80,  '{10}', 11),
  ('top-witch',      'top',    '星月巫師袍',   'witch',   false, 120, '{10}', 11),
  ('hand-broom',     'hand',   '小掃帚',       'witch',   false, 70,  '{10}', 11),
  ('hat-pumpkin',    'hat',    '南瓜帽',       'pumpkin', false, 80,  '{10}', 12),
  ('top-pumpkin',    'top',    '南瓜騎士服',   'pumpkin', false, 120, '{10}', 12),
  ('hand-lantern',   'hand',   '南瓜燈糖果桶', 'pumpkin', false, 70,  '{10}', 12),
  ('top-vampire',    'top',    '紅領披風禮服', 'vampire', false, 120, '{10}', 13),
  ('bottom-vampire', 'bottom', '黑長褲皮鞋',   'vampire', false, 90,  '{10}', 13),
  ('back-bat',       'back',   '蝙蝠翅膀',     'vampire', false, 100, '{10}', 13)
on conflict (code) do update set slot = excluded.slot, name = excluded.name, set_code = excluded.set_code,
  free = excluded.free, price = excluded.price, months = excluded.months, sort = excluded.sort;

-- 常駐商店套裝（2026-11-28）
insert into public.park_wear_items (code, slot, name, set_code, free, price, sort) values
  ('hat-snorkel',     'hat',    '浮潛蛙鏡',       'ocean',  false, 60,  21),
  ('top-ocean',       'top',    '短袖潛水衣',     'ocean',  false, 100, 21),
  ('bottom-ocean',    'bottom', '潛水短褲配蛙鞋', 'ocean',  false, 80,  21),
  ('back-shell',      'back',   '海龜殼背包',     'ocean',  false, 100, 21),
  ('hat-antenna',     'hat',    '星星天線髮箍',   'space',  false, 60,  22),
  ('top-space',       'top',    '太空衣',         'space',  false, 110, 22),
  ('bottom-space',    'bottom', '太空褲月球靴',   'space',  false, 90,  22),
  ('back-jetpack',    'back',   '小火箭背包',     'space',  false, 120, 22),
  ('hat-safari',      'hat',    '探險帽',         'safari', false, 60,  23),
  ('top-safari',      'top',    '探險背心',       'safari', false, 100, 23),
  ('bottom-safari',   'bottom', '工作短褲登山靴', 'safari', false, 80,  23),
  ('back-dinotail',   'back',   '恐龍尾巴',       'safari', false, 120, 23),
  ('hat-bandana',     'hat',    '紅花頭巾',       'farm',   false, 50,  24),
  ('top-farm',        'top',    '格子襯衫吊帶褲', 'farm',   false, 100, 24),
  ('bottom-farm',     'bottom', '吊帶褲配雨鞋',   'farm',   false, 80,  24),
  ('hand-basket',     'hand',   '一籃雞蛋',       'farm',   false, 60,  24)
on conflict (code) do update set slot = excluded.slot, name = excluded.name, set_code = excluded.set_code,
  free = excluded.free, price = excluded.price, sort = excluded.sort;

-- 聖誕（11～12 月限定）：時光幣或雪花結晶都能換；麋鹿角只能用雪花換。過了 12 月沒買的就不出現，買過的照樣能穿
insert into public.park_wear_items (code, slot, name, set_code, free, price, months, snow_price, snow_only, sort) values
  ('hat-santa',       'hat',    '聖誕帽',         'santa',    false, 80,  '{11,12}', 12, false, 31),
  ('top-santa',       'top',    '聖誕老公公外套', 'santa',    false, 120, '{11,12}', 18, false, 31),
  ('bottom-santa',    'bottom', '紅褲子毛邊靴',   'santa',    false, 90,  '{11,12}', 14, false, 31),
  ('back-sack',       'back',   '一大袋禮物',     'santa',    false, 100, '{11,12}', 15, false, 31),
  ('hat-antler',      'hat',    '麋鹿角髮箍',     'reindeer', false, 0,   '{11,12}', 15, true,  32),
  ('top-reindeer',    'top',    '鈴鐺麋鹿毛衣',   'reindeer', false, 120, '{11,12}', 18, false, 32),
  ('bottom-reindeer', 'bottom', '麋鹿蹄毛毛靴',   'reindeer', false, 90,  '{11,12}', 14, false, 32),
  ('hat-elf',         'hat',    '小精靈鈴鐺帽',   'elf',      false, 80,  '{11,12}', 12, false, 33),
  ('top-elf',         'top',    '小精靈綠衣',     'elf',      false, 120, '{11,12}', 18, false, 33),
  ('bottom-elf',      'bottom', '條紋褲襪捲捲鞋', 'elf',      false, 90,  '{11,12}', 14, false, 33),
  ('hand-cane',       'hand',   '大拐杖糖',       'elf',      false, 70,  '{11,12}', 10, false, 33),
  ('hat-beanie',      'hat',    '雪花毛球帽',     'cozy',     false, 80,  '{11,12}', 12, false, 34),
  ('top-sweater',     'top',    '聖誕毛衣配圍巾', 'cozy',     false, 120, '{11,12}', 18, false, 34),
  ('bottom-boots',    'bottom', '牛仔褲配雪靴',   'cozy',     false, 90,  '{11,12}', 14, false, 34),
  ('hand-cocoa',      'hand',   '熱可可',         'cozy',     false, 70,  '{11,12}', 10, false, 34),
  ('hat-earmuff',     'hat',    '毛毛耳罩',       null,       false, 60,  '{11,12}', 9,  false, 35),
  ('hand-gift',       'hand',   '聖誕禮物盒',     null,       false, 60,  '{11,12}', 9,  false, 35),
  ('back-snowwing',   'back',   '雪花結晶翅膀',   null,       false, 140, '{11,12}', 20, false, 35)
on conflict (code) do update set slot = excluded.slot, name = excluded.name, set_code = excluded.set_code,
  free = excluded.free, price = excluded.price, months = excluded.months,
  snow_price = excluded.snow_price, snow_only = excluded.snow_only, sort = excluded.sort;

-- 2026-11-28 第二批臉和頭：髮型 7、表情 5（都免費）；臉飾 6、頭紗類 3（商店）
insert into public.park_wear_items (code, slot, name, set_code, free, price, sort) values
  ('hair-hime',       'hair', '公主切長直髮',   null, true,  null, 11),
  ('hair-sidebraid',  'hair', '側邊單辮',       null, true,  null, 12),
  ('hair-braids',     'hair', '雙麻花辮',       null, true,  null, 13),
  ('hair-halfbun',    'hair', '半紮小丸子',     null, true,  null, 14),
  ('hair-curly',      'hair', '蓬蓬自然捲',     null, true,  null, 15),
  ('hair-midpart',    'hair', '中分瀏海',       null, true,  null, 16),
  ('hair-fluffy',     'hair', '蓬鬆微捲',       null, true,  null, 17),
  ('expr-grin',       'expr', '露齒大笑',       null, true,  null, 1),
  ('expr-wink',       'expr', '眨眼',           null, true,  null, 2),
  ('expr-shy',        'expr', '害羞臉紅',       null, true,  null, 3),
  ('expr-wow',        'expr', '驚訝',           null, true,  null, 4),
  ('expr-tongue',     'expr', '吐舌頭',         null, true,  null, 5),
  ('mask-robot',      'mask', '機器人 LED 面罩', null, false, 90,  41),
  ('mask-visor',      'mask', '機甲護目鏡',     null, false, 80,  42),
  ('mask-hero',       'mask', '英雄眼罩',       null, false, 60,  43),
  ('mask-butterfly',  'mask', '蝴蝶舞會面具',   null, false, 80,  44),
  ('mask-cat',        'mask', '貓咪面具',       null, false, 80,  45),
  ('mask-sparkle',    'mask', '星星亮片',       null, false, 60,  46),
  ('hat-flowerveil',  'hat',  '花冠頭紗',       null, false, 90,  27),
  ('hat-tiara',       'hat',  '公主小皇冠',     null, false, 80,  28),
  ('hat-wreath',      'hat',  '小精靈花環',     null, false, 70,  29)
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

-- 檢查一套穿搭，回傳整理好的 look（九個位置都有 key，沒穿的是 null）。不合規就丟出看得懂的錯誤。
create or replace function public.park_wear_check(p_student uuid, p_look jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_out jsonb := '{"face":null,"expr":null,"hair":null,"mask":null,"hat":null,"top":null,"bottom":null,"hand":null,"back":null}';
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
