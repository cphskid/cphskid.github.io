-- =============================================================================
-- 時空冒險樂園：寵物島裝扮、拜訪、今日精選島（寵物島 2.0 第 1 期，2026-10-29）
--
-- 裝扮：傢俱擺在哪、哪些收起來、島的風格（主題地面）、島名（從三組字裡各挑一個，不能自己打字）
--   存在伺服器，換手機也一樣，別人來參觀看到的也是這一份。
-- 島的風格：spring 春日花園大家都有；beach 夕陽海灘、autumn 楓葉、snow 雪夜（冬天才上架）在商店用時光幣買；
--   stars 星空要拿到臺灣島終章的章（今天的島嶼）；candy 糖果樂園是之後週末活動的獎勵。
--   買到的記在 park_student_furniture（item＝'theme-<code>'），跟傢俱同一張表。
-- 拜訪：同班同學的島隨時可以去看；別班的島從「逛逛別的島」隨機看到（2026-11-05 起）（試玩班 TRYIT 原本不列，2026-11-02 Chuck 改成也列，同班可以自己找來看）；
--   每座島每天可以留一個正面圖示（6 種），只能看、不能搬、不能打字。
-- 今日精選島：每天（臺灣時間）第一個人來看時選出 6 座：擺了 5 件以上的東西，
--   最近 7 天收到的圖示越多越容易選到，最近 14 天上過的先讓給別人。所有班級（含試玩班）一起選，只顯示暱稱和島名。
--
-- 怎麼套：Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。
-- 順序：park_pet.sql、park_coins.sql（park_today、商店）、park_passport.sql（章）之後。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------
-- layout：擺在島上的傢俱 {傢俱 id: {x, y, f}}（x、y 是島圖上的比例 0～1，f＝1 是翻面）；stored：收起來的傢俱
create table if not exists public.park_isle (
  student_id uuid primary key references public.students(id) on delete cascade,
  theme      text not null default 'spring',
  name       smallint[] not null default '{0,0,0}',
  layout     jsonb not null default '{}',
  stored     text[] not null default '{}',
  placed     int not null default 0,
  updated_at timestamptz not null default now()
);

-- 圖示：kind 0 好可愛、1 好厲害、2 好漂亮、3 好好笑、4 好有創意、5 我來過了
create table if not exists public.park_isle_reacts (
  from_id uuid not null references public.students(id) on delete cascade,
  to_id   uuid not null references public.students(id) on delete cascade,
  day     date not null,
  kind    smallint not null check (kind between 0 and 5),
  seen    boolean not null default false,
  at      timestamptz not null default now(),
  primary key (from_id, to_id, day)
);
create index if not exists park_isle_reacts_to on public.park_isle_reacts (to_id, at desc);

create table if not exists public.park_isle_featured (
  day        date not null,
  student_id uuid not null references public.students(id) on delete cascade,
  rank       smallint not null,
  primary key (day, student_id)
);

alter table public.park_isle          enable row level security;
alter table public.park_isle_reacts   enable row level security;
alter table public.park_isle_featured enable row level security;
revoke all on public.park_isle, public.park_isle_reacts, public.park_isle_featured from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. 島的風格
-- -----------------------------------------------------------------------------
create or replace function public.park_isle_themes(p_student uuid)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select array['spring']
    || coalesce((select array_agg(substr(f.item, 7) order by f.got_at) from public.park_student_furniture f
                  where f.student_id = p_student and f.item like 'theme-%'), '{}')
    || case when exists (select 1 from public.park_student_stamps s
                          where s.student_id = p_student and s.facility = 'island_pioneer' and s.stamp = 'end')
            then array['stars'] else '{}' end
    -- 2026-11-19 島嶼風格套組：三種過關／集章解鎖（其他在商店賣，下面上架）
    || case when exists (select 1 from public.park_student_stamps s
                          where s.student_id = p_student and s.facility = 'island_pioneer' and s.stamp = 'ch5')
            then array['tung'] else '{}' end
    || case when to_regclass('public.animal_progress') is not null and exists (select 1 from public.animal_progress a
                          where a.student_id = p_student and a.level = 'sky' and a.first_clear_at is not null)
            then array['moon'] else '{}' end
    || case when (select count(*) from public.park_student_stamps s where s.student_id = p_student) >= 30
            then array['cloud'] else '{}' end;
$$;

-- 商店上架（cat 'theme'，park_coins.sql 的 park_shop／park_shop_buy 會照傢俱一樣處理：買一次、記在 park_student_furniture）
insert into public.park_shop_items (code, cat, ref, name, art, blurb, price, months, sort) values
  ('theme-beach',  'theme', 'theme-beach',  '夕陽海灘', 'img/pet/land2/s-beach.webp',  '寵物島換成椰子樹和金色沙灘', 300, null, 30),
  ('theme-autumn', 'theme', 'theme-autumn', '楓葉野餐', 'img/pet/land2/s-autumn.webp', '整座島變成紅紅黃黃的楓葉', 300, null, 31),
  ('theme-snow',   'theme', 'theme-snow',   '雪夜木屋', 'img/pet/land2/s-snow.webp',   '冬天限定：下雪的島、結冰的湖', 350, '{12,1,2}', 32),
  -- 寵物島 2.0：小屋（cat 'furn'，買了在裝扮的「小屋盆子」擺出來；小木屋一開始就有，不用買）
  ('furn-house-mushroom', 'furn', 'house-mushroom', '蘑菇屋', 'img/pet/furniture/house-mushroom.webp', '紅紅的蘑菇屋，寵物會進去睡午覺', 250, null, 40),
  ('furn-house-tree',     'furn', 'house-tree',     '樹屋',   'img/pet/furniture/house-tree.webp',     '爬梯子上去的小樹屋', 300, null, 41),
  ('furn-house-igloo',    'furn', 'house-igloo',    '雪屋',   'img/pet/furniture/house-igloo.webp',    '冬天限定：圓圓的冰磚雪屋', 280, '{12,1,2}', 42),
  -- 2026-11-19 島嶼風格套組（js/islesets.js）：七種風格在商店賣（油桐花、月球、雲朵是過關／集章解鎖），每種 6 件傢俱
  ('theme-nightmarket', 'theme', 'theme-nightmarket', '夜市燈籠', 'img/pet/land2/s-nightmarket.webp', '整座島換成「夜市燈籠」，還有 6 件同主題傢俱', 350, null, 100),
  ('theme-teahill', 'theme', 'theme-teahill', '竹林茶山', 'img/pet/land2/s-teahill.webp', '整座島換成「竹林茶山」，還有 6 件同主題傢俱', 350, null, 101),
  ('theme-coral', 'theme', 'theme-coral', '海底珊瑚', 'img/pet/land2/s-coral.webp', '整座島換成「海底珊瑚」，還有 6 件同主題傢俱', 400, null, 102),
  ('theme-dino', 'theme', 'theme-dino', '恐龍叢林', 'img/pet/land2/s-dino.webp', '整座島換成「恐龍叢林」，還有 6 件同主題傢俱', 400, null, 103),
  ('theme-future', 'theme', 'theme-future', '未來科技城', 'img/pet/land2/s-future.webp', '整座島換成「未來科技城」，還有 6 件同主題傢俱', 400, null, 104),
  ('theme-desert', 'theme', 'theme-desert', '沙漠綠洲', 'img/pet/land2/s-desert.webp', '整座島換成「沙漠綠洲」，還有 6 件同主題傢俱', 300, null, 105),
  ('theme-ranch', 'theme', 'theme-ranch', '小農牧場', 'img/pet/land2/s-ranch.webp', '整座島換成「小農牧場」，還有 6 件同主題傢俱', 300, null, 106),
  ('furn-nm-cart', 'furn', 'nm-cart', '小吃攤車', 'img/pet/furniture/nm-cart.webp', '「夜市燈籠」風格傢俱', 220, null, 200),
  ('furn-nm-lantern', 'furn', 'nm-lantern', '紅燈籠串', 'img/pet/furniture/nm-lantern.webp', '「夜市燈籠」風格傢俱', 150, null, 201),
  ('furn-nm-tea', 'furn', 'nm-tea', '珍奶攤', 'img/pet/furniture/nm-tea.webp', '「夜市燈籠」風格傢俱', 180, null, 202),
  ('furn-nm-stool', 'furn', 'nm-stool', '紅色塑膠椅桌', 'img/pet/furniture/nm-stool.webp', '「夜市燈籠」風格傢俱', 100, null, 203),
  ('furn-nm-pinball', 'furn', 'nm-pinball', '彈珠台', 'img/pet/furniture/nm-pinball.webp', '「夜市燈籠」風格傢俱', 200, null, 204),
  ('furn-nm-arch', 'furn', 'nm-arch', '霓虹拱門', 'img/pet/furniture/nm-arch.webp', '「夜市燈籠」風格傢俱', 250, null, 205),
  ('furn-tg-bench', 'furn', 'tg-bench', '花布長椅', 'img/pet/furniture/tg-bench.webp', '「油桐花小徑」風格傢俱', 150, null, 206),
  ('furn-tg-umbrella', 'furn', 'tg-umbrella', '紙傘架', 'img/pet/furniture/tg-umbrella.webp', '「油桐花小徑」風格傢俱', 120, null, 207),
  ('furn-tg-leicha', 'furn', 'tg-leicha', '擂茶桌', 'img/pet/furniture/tg-leicha.webp', '「油桐花小徑」風格傢俱', 180, null, 208),
  ('furn-tg-bridge', 'furn', 'tg-bridge', '小石橋', 'img/pet/furniture/tg-bridge.webp', '「油桐花小徑」風格傢俱', 220, null, 209),
  ('furn-tg-basket', 'furn', 'tg-basket', '油桐花籃', 'img/pet/furniture/tg-basket.webp', '「油桐花小徑」風格傢俱', 80, null, 210),
  ('furn-tg-arch', 'furn', 'tg-arch', '花拱門', 'img/pet/furniture/tg-arch.webp', '「油桐花小徑」風格傢俱', 200, null, 211),
  ('furn-tea-pavilion', 'furn', 'tea-pavilion', '竹編茶亭', 'img/pet/furniture/tea-pavilion.webp', '「竹林茶山」風格傢俱', 250, null, 212),
  ('furn-tea-table', 'furn', 'tea-table', '茶桌茶具', 'img/pet/furniture/tea-table.webp', '「竹林茶山」風格傢俱', 150, null, 213),
  ('furn-tea-fence', 'furn', 'tea-fence', '竹籬笆', 'img/pet/furniture/tea-fence.webp', '「竹林茶山」風格傢俱', 80, null, 214),
  ('furn-tea-pipe', 'furn', 'tea-pipe', '竹管流水', 'img/pet/furniture/tea-pipe.webp', '「竹林茶山」風格傢俱', 180, null, 215),
  ('furn-tea-basket', 'furn', 'tea-basket', '採茶簍', 'img/pet/furniture/tea-basket.webp', '「竹林茶山」風格傢俱', 80, null, 216),
  ('furn-tea-lamp', 'furn', 'tea-lamp', '石燈籠', 'img/pet/furniture/tea-lamp.webp', '「竹林茶山」風格傢俱', 120, null, 217),
  ('furn-cr-shellbed', 'furn', 'cr-shellbed', '貝殼床', 'img/pet/furniture/cr-shellbed.webp', '「海底珊瑚」風格傢俱', 220, null, 218),
  ('furn-cr-chair', 'furn', 'cr-chair', '珊瑚沙發', 'img/pet/furniture/cr-chair.webp', '「海底珊瑚」風格傢俱', 180, null, 219),
  ('furn-cr-jelly', 'furn', 'cr-jelly', '水母燈', 'img/pet/furniture/cr-jelly.webp', '「海底珊瑚」風格傢俱', 150, null, 220),
  ('furn-cr-chest', 'furn', 'cr-chest', '寶箱', 'img/pet/furniture/cr-chest.webp', '「海底珊瑚」風格傢俱', 200, null, 221),
  ('furn-cr-swing', 'furn', 'cr-swing', '船舵鞦韆', 'img/pet/furniture/cr-swing.webp', '「海底珊瑚」風格傢俱', 220, null, 222),
  ('furn-cr-fountain', 'furn', 'cr-fountain', '珍珠噴泉', 'img/pet/furniture/cr-fountain.webp', '「海底珊瑚」風格傢俱', 180, null, 223),
  ('furn-mn-rocket', 'furn', 'mn-rocket', '小火箭', 'img/pet/furniture/mn-rocket.webp', '「月球基地」風格傢俱', 250, null, 224),
  ('furn-house-dome', 'furn', 'house-dome', '圓頂太空艙', 'img/pet/furniture/house-dome.webp', '「月球基地」風格傢俱', 300, null, 225),
  ('furn-mn-dish', 'furn', 'mn-dish', '衛星天線', 'img/pet/furniture/mn-dish.webp', '「月球基地」風格傢俱', 150, null, 226),
  ('furn-mn-scope', 'furn', 'mn-scope', '望遠鏡', 'img/pet/furniture/mn-scope.webp', '「月球基地」風格傢俱', 180, null, 227),
  ('furn-mn-rover', 'furn', 'mn-rover', '月球車', 'img/pet/furniture/mn-rover.webp', '「月球基地」風格傢俱', 220, null, 228),
  ('furn-mn-star', 'furn', 'mn-star', '星星燈', 'img/pet/furniture/mn-star.webp', '「月球基地」風格傢俱', 100, null, 229),
  ('furn-dn-nest', 'furn', 'dn-nest', '恐龍蛋巢床', 'img/pet/furniture/dn-nest.webp', '「恐龍叢林」風格傢俱', 220, null, 230),
  ('furn-dn-bone', 'furn', 'dn-bone', '化石拱門', 'img/pet/furniture/dn-bone.webp', '「恐龍叢林」風格傢俱', 250, null, 231),
  ('furn-dn-table', 'furn', 'dn-table', '石桌石椅', 'img/pet/furniture/dn-table.webp', '「恐龍叢林」風格傢俱', 150, null, 232),
  ('furn-dn-hammock', 'furn', 'dn-hammock', '大葉吊床', 'img/pet/furniture/dn-hammock.webp', '「恐龍叢林」風格傢俱', 180, null, 233),
  ('furn-dn-egg', 'furn', 'dn-egg', '恐龍蛋', 'img/pet/furniture/dn-egg.webp', '「恐龍叢林」風格傢俱', 120, null, 234),
  ('furn-dn-slide', 'furn', 'dn-slide', '長頸龍溜滑梯', 'img/pet/furniture/dn-slide.webp', '「恐龍叢林」風格傢俱', 250, null, 235),
  ('furn-cl-sofa', 'furn', 'cl-sofa', '雲朵沙發', 'img/pet/furniture/cl-sofa.webp', '「雲朵天空」風格傢俱', 200, null, 236),
  ('furn-cl-balloon', 'furn', 'cl-balloon', '熱氣球鞦韆', 'img/pet/furniture/cl-balloon.webp', '「雲朵天空」風格傢俱', 250, null, 237),
  ('furn-cl-lamp', 'furn', 'cl-lamp', '金星路燈', 'img/pet/furniture/cl-lamp.webp', '「雲朵天空」風格傢俱', 120, null, 238),
  ('furn-cl-rainbow', 'furn', 'cl-rainbow', '彩虹溜滑梯', 'img/pet/furniture/cl-rainbow.webp', '「雲朵天空」風格傢俱', 250, null, 239),
  ('furn-cl-bed', 'furn', 'cl-bed', '羽毛枕床', 'img/pet/furniture/cl-bed.webp', '「雲朵天空」風格傢俱', 180, null, 240),
  ('furn-cl-vane', 'furn', 'cl-vane', '風向風車', 'img/pet/furniture/cl-vane.webp', '「雲朵天空」風格傢俱', 100, null, 241),
  ('furn-ft-chair', 'furn', 'ft-chair', '懸浮椅', 'img/pet/furniture/ft-chair.webp', '「未來科技城」風格傢俱', 200, null, 242),
  ('furn-ft-robot', 'furn', 'ft-robot', '機器人充電座', 'img/pet/furniture/ft-robot.webp', '「未來科技城」風格傢俱', 220, null, 243),
  ('furn-ft-holo', 'furn', 'ft-holo', '全息投影燈', 'img/pet/furniture/ft-holo.webp', '「未來科技城」風格傢俱', 180, null, 244),
  ('furn-ft-bench', 'furn', 'ft-bench', '太陽能長椅', 'img/pet/furniture/ft-bench.webp', '「未來科技城」風格傢俱', 150, null, 245),
  ('furn-house-pod', 'furn', 'house-pod', '膠囊小屋', 'img/pet/furniture/house-pod.webp', '「未來科技城」風格傢俱', 300, null, 246),
  ('furn-ft-drone', 'furn', 'ft-drone', '無人機快遞箱', 'img/pet/furniture/ft-drone.webp', '「未來科技城」風格傢俱', 150, null, 247),
  ('furn-house-tent', 'furn', 'house-tent', '條紋帳篷', 'img/pet/furniture/house-tent.webp', '「沙漠綠洲」風格傢俱', 280, null, 248),
  ('furn-ds-cactus', 'furn', 'ds-cactus', '陶盆仙人掌', 'img/pet/furniture/ds-cactus.webp', '「沙漠綠洲」風格傢俱', 80, null, 249),
  ('furn-ds-saddle', 'furn', 'ds-saddle', '駱駝鞍座墊', 'img/pet/furniture/ds-saddle.webp', '「沙漠綠洲」風格傢俱', 120, null, 250),
  ('furn-ds-carpet', 'furn', 'ds-carpet', '編織地毯', 'img/pet/furniture/ds-carpet.webp', '「沙漠綠洲」風格傢俱', 150, null, 251),
  ('furn-ds-jar', 'furn', 'ds-jar', '陶罐噴泉', 'img/pet/furniture/ds-jar.webp', '「沙漠綠洲」風格傢俱', 180, null, 252),
  ('furn-ds-palm', 'furn', 'ds-palm', '棕櫚樹', 'img/pet/furniture/ds-palm.webp', '「沙漠綠洲」風格傢俱', 120, null, 253),
  ('furn-house-barn', 'furn', 'house-barn', '紅色穀倉', 'img/pet/furniture/house-barn.webp', '「小農牧場」風格傢俱', 300, null, 254),
  ('furn-rc-hay', 'furn', 'rc-hay', '圓乾草堆', 'img/pet/furniture/rc-hay.webp', '「小農牧場」風格傢俱', 100, null, 255),
  ('furn-rc-mill', 'furn', 'rc-mill', '小風車', 'img/pet/furniture/rc-mill.webp', '「小農牧場」風格傢俱', 200, null, 256),
  ('furn-rc-milk', 'furn', 'rc-milk', '牛奶桶水槽', 'img/pet/furniture/rc-milk.webp', '「小農牧場」風格傢俱', 120, null, 257),
  ('furn-rc-scarecrow', 'furn', 'rc-scarecrow', '稻草人', 'img/pet/furniture/rc-scarecrow.webp', '「小農牧場」風格傢俱', 100, null, 258),
  ('furn-rc-cart', 'furn', 'rc-cart', '蔬菜推車', 'img/pet/furniture/rc-cart.webp', '「小農牧場」風格傢俱', 150, null, 259)
on conflict (code) do update
  set cat = excluded.cat, ref = excluded.ref, name = excluded.name, art = excluded.art, blurb = excluded.blurb,
      price = excluded.price, months = excluded.months, sort = excluded.sort;

-- 2026-11-19 聖誕活動「雪花聖誕村」：11/25 開賣、12/31 下架（之前先預告；麋鹿雪橇不在這裡，之後用雪花結晶換）
insert into public.park_shop_items (code, cat, ref, name, art, blurb, price, months, sort, sale_from, sale_to) values
  ('theme-xmas',        'theme', 'theme-xmas',   '雪花聖誕村', 'img/pet/land2/s-xmas.webp',        '聖誕限定：雪地、拐杖糖邊框、結冰的湖', 400, null, 500, '2026-11-25', '2026-12-31'),
  ('furn-xm-tree',      'furn',  'xm-tree',      '聖誕樹',     'img/pet/furniture/xm-tree.webp',      '聖誕限定傢俱', 250, null, 501, '2026-11-25', '2026-12-31'),
  ('furn-house-ginger', 'furn',  'house-ginger', '薑餅屋',     'img/pet/furniture/house-ginger.webp', '聖誕限定小屋，夥伴會進去睡', 250, null, 502, '2026-11-25', '2026-12-31'),
  ('furn-xm-gifts',     'furn',  'xm-gifts',     '禮物堆',     'img/pet/furniture/xm-gifts.webp',     '聖誕限定傢俱', 120, null, 503, '2026-11-25', '2026-12-31'),
  ('furn-xm-fireplace', 'furn',  'xm-fireplace', '暖暖壁爐',   'img/pet/furniture/xm-fireplace.webp', '聖誕限定傢俱', 200, null, 504, '2026-11-25', '2026-12-31'),
  ('furn-xm-lamp',      'furn',  'xm-lamp',      '拐杖糖路燈', 'img/pet/furniture/xm-lamp.webp',      '聖誕限定傢俱', 120, null, 505, '2026-11-25', '2026-12-31'),
  ('furn-xm-snowman',   'furn',  'xm-snowman',   '雪人',       'img/pet/furniture/xm-snowman.webp',   '聖誕限定傢俱', 150, null, 506, '2026-11-25', '2026-12-31'),
  ('furn-xm-arch',      'furn',  'xm-arch',      '花圈拱門',   'img/pet/furniture/xm-arch.webp',      '聖誕限定傢俱', 180, null, 507, '2026-11-25', '2026-12-31')
on conflict (code) do update
  set cat = excluded.cat, ref = excluded.ref, name = excluded.name, art = excluded.art, blurb = excluded.blurb,
      price = excluded.price, months = excluded.months, sort = excluded.sort, sale_from = excluded.sale_from, sale_to = excluded.sale_to;

-- -----------------------------------------------------------------------------
-- 3. 誰可以看誰的島
-- -----------------------------------------------------------------------------
-- 不算「同班」的班（看不到同學的島）。原本是試玩班 TRYIT；2026-11-02 Chuck：試玩班也開放同班互看，現在沒有班被排除。
-- 之後要再關掉某個班，把代碼寫回這裡就好。
create or replace function public.park_isle_open_class(p_code text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select false;
$$;

-- 同學＝真的班的同學＋這週同伴圈的人（公共交誼廳不算整班，park_lounge.sql 的 park_mates）
create or replace function public.park_isle_classmate(p_me uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.park_mates(p_me) x(sid) where x.sid = p_other);
$$;

-- 「逛逛別的島」會出現的島：擺了 5 件以上、30 天內動過（2026-11-05 Chuck：要能跨班拜訪，家庭班只有 1、2 個人）
create or replace function public.park_isle_explorable(p_student uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.park_isle i
                  where i.student_id = p_student and i.placed >= 5 and i.updated_at > now() - interval '30 days');
$$;

-- 同班、今天昨天上過精選、「逛逛別的島」會出現的島，或是來我的島留過圖示的人
create or replace function public.park_isle_can_see(p_me uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_me = p_other or public.park_isle_classmate(p_me, p_other)
      or exists (select 1 from public.park_isle_featured f
                  where f.student_id = p_other and f.day >= public.park_today() - 1)
      or public.park_isle_explorable(p_other)
      -- 來過我的島、留過圖示的人，我可以回去看他的島（2026-11-06 Chuck：看到來拜訪的人可以連到他的島）
      or exists (select 1 from public.park_isle_reacts r where r.from_id = p_other and r.to_id = p_me);
$$;

-- 收到的圖示，6 種各幾個（全部時間）
create or replace function public.park_isle_love(p_student uuid)
returns int[] language sql stable security definer set search_path = public, pg_temp as $$
  select array[count(*) filter (where kind = 0), count(*) filter (where kind = 1), count(*) filter (where kind = 2),
               count(*) filter (where kind = 3), count(*) filter (where kind = 4), count(*) filter (where kind = 5)]::int[]
    from public.park_isle_reacts where to_id = p_student;
$$;

-- 一座島的卡片（清單用）：{id, nickname, name, theme, placed, love, pet, layout}
-- layout：清單縮圖要畫出這座島真的擺了什麼（2026-11-05 Chuck：縮圖要看得到裝潢，點進去才會動）
create or replace function public.park_isle_card(p_student uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', st.id, 'nickname', st.nickname,
           'name', coalesce(to_jsonb(i.name), '[0,0,0]'::jsonb), 'theme', coalesce(i.theme, 'spring'),
           'placed', coalesce(i.placed, 0), 'love', to_jsonb(public.park_isle_love(st.id)),
           'layout', coalesce(i.layout, '{}'::jsonb),
           'pet', (select jsonb_build_object('species', p.species, 'stage', public.park_pet_stage(p.xp))
                     from public.park_pets p where p.student_id = st.id order by p.active desc, p.id limit 1))
    from public.students st left join public.park_isle i on i.student_id = st.id
   where st.id = p_student;
$$;

-- -----------------------------------------------------------------------------
-- 4. 自己的島
-- -----------------------------------------------------------------------------
-- {saved, theme, name, layout, stored, themes, inbox:[{id, nickname, kind, at, has}], featured}
create or replace function public.park_isle_me()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_i public.park_isle;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  select * into v_i from public.park_isle where student_id = v_me;
  return jsonb_build_object(
    'saved', v_i.student_id is not null,
    'theme', coalesce(v_i.theme, 'spring'), 'name', coalesce(to_jsonb(v_i.name), '[0,0,0]'::jsonb),
    'layout', coalesce(v_i.layout, '{}'::jsonb), 'stored', coalesce(to_jsonb(v_i.stored), '[]'::jsonb),
    'themes', to_jsonb(public.park_isle_themes(v_me)),
    'love', to_jsonb(public.park_isle_love(v_me)),
    'inbox', coalesce((select jsonb_agg(jsonb_build_object('id', r.from_id, 'nickname', st.nickname, 'kind', r.kind, 'at', r.at,
                                                           'has', exists (select 1 from public.park_isle i where i.student_id = r.from_id)) order by r.at desc)
                         from (select * from public.park_isle_reacts where to_id = v_me and not seen order by at desc limit 20) r
                         join public.students st on st.id = r.from_id), '[]'::jsonb),
    'featured', exists (select 1 from public.park_isle_featured where student_id = v_me and day = public.park_today()));
end;
$$;

-- 自己的島收到的圖示明細：{love:[6 種各幾個], visitors:幾個不同的人, recent:[{id, nickname, kind, at, has（有沒有島）}] 最近 30 個}
-- 2026-11-06 Chuck：寵物島要看得到大家按了多少讚、累積了哪些圖示
create or replace function public.park_isle_fans()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  return jsonb_build_object(
    'love', to_jsonb(public.park_isle_love(v_me)),
    'visitors', (select count(distinct from_id) from public.park_isle_reacts where to_id = v_me),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', r.from_id, 'nickname', st.nickname, 'kind', r.kind, 'at', r.at,
                                                            'has', exists (select 1 from public.park_isle i where i.student_id = r.from_id)) order by r.at desc)
                          from (select * from public.park_isle_reacts where to_id = v_me order by at desc limit 30) r
                          join public.students st on st.id = r.from_id), '[]'::jsonb));
end;
$$;

create or replace function public.park_isle_seen()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.park_isle_reacts set seen = true where to_id = public.current_student_id() and not seen;
$$;

-- 存島：主題要有、島名每組 0～19、傢俱最多 40 件（id 只能英數和 -）、座標夾在 0～1
create or replace function public.park_isle_save(p_theme text, p_name int[], p_layout jsonb, p_stored text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_layout jsonb := '{}'; v_k text; v_v jsonb; v_items jsonb := '[]'; v_e jsonb;
        v_eggs jsonb := '{}'; v_furn int := 0; v_build int := 0;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if not (coalesce(p_theme, 'spring') = any(public.park_isle_themes(v_me))) then raise exception '還沒拿到這個島的風格'; end if;
  if coalesce(array_length(p_name, 1), 0) <> 3 or exists (select 1 from unnest(p_name) n where n is null or n < 0 or n > 19) then
    raise exception '島名要從選單挑';
  end if;
  if jsonb_typeof(coalesce(p_layout, '{}')) <> 'object' then raise exception '擺放資料不對'; end if;
  if p_layout ->> 'v' = '2' then
    -- 寵物島 2.0：{ v: 2, items: [[id, i, j, f], …] }，28×28 格；傢俱最多 60 件、圍籬小路（s- 開頭）最多 150 格
    if jsonb_typeof(p_layout -> 'items') <> 'array' then raise exception '擺放資料不對'; end if;
    for v_e in select * from jsonb_array_elements(p_layout -> 'items') loop
      if jsonb_typeof(v_e) <> 'array' or jsonb_array_length(v_e) <> 4 or (v_e ->> 0) !~ '^[a-z][a-z0-9-]{1,30}$'
         or jsonb_typeof(v_e -> 1) <> 'number' or jsonb_typeof(v_e -> 2) <> 'number'
         or (v_e ->> 1)::numeric not between 0 and 27 or (v_e ->> 2)::numeric not between 0 and 27 then continue; end if;
      if (v_e ->> 0) like 's-%' then v_build := v_build + 1; else v_furn := v_furn + 1; end if;
      v_items := v_items || jsonb_build_array(jsonb_build_array(v_e ->> 0, (v_e ->> 1)::int, (v_e ->> 2)::int, case when (v_e ->> 3) = '1' then 1 else 0 end));
    end loop;
    if v_furn > 60 or v_build > 150 then raise exception '島上放太多東西了'; end if;
    -- 2026-11-10：蛋的位置 eggs＝{ adopt 或種類: [i, j] }（問題回報 #58：蛋可以搬），最多 30 顆，不算傢俱數
    if jsonb_typeof(p_layout -> 'eggs') = 'object' then
      for v_k, v_v in select * from jsonb_each(p_layout -> 'eggs') limit 30 loop
        if v_k !~ '^[a-z][a-z0-9-]{1,30}$' or jsonb_typeof(v_v) <> 'array' or jsonb_array_length(v_v) <> 2
           or jsonb_typeof(v_v -> 0) <> 'number' or jsonb_typeof(v_v -> 1) <> 'number'
           or (v_v ->> 0)::numeric not between 0 and 27 or (v_v ->> 1)::numeric not between 0 and 27 then continue; end if;
        v_eggs := v_eggs || jsonb_build_object(v_k, jsonb_build_array((v_v ->> 0)::int, (v_v ->> 1)::int));
      end loop;
    end if;
    v_layout := jsonb_build_object('v', 2, 'items', v_items);
    if v_eggs <> '{}'::jsonb then v_layout := v_layout || jsonb_build_object('eggs', v_eggs); end if;
  else
    for v_k, v_v in select * from jsonb_each(coalesce(p_layout, '{}')) loop
      if v_k !~ '^[a-z][a-z0-9-]{1,30}$' or jsonb_typeof(v_v -> 'x') <> 'number' or jsonb_typeof(v_v -> 'y') <> 'number' then continue; end if;
      v_layout := v_layout || jsonb_build_object(v_k, jsonb_build_object(
        'x', round(least(1, greatest(0, (v_v ->> 'x')::numeric)), 3),
        'y', round(least(1, greatest(0, (v_v ->> 'y')::numeric)), 3),
        'f', case when (v_v ->> 'f') = '1' then 1 else 0 end));
    end loop;
    v_furn := (select count(*) from jsonb_object_keys(v_layout));
    if v_furn > 40 then raise exception '島上放太多東西了'; end if;
  end if;
  insert into public.park_isle as i (student_id, theme, name, layout, stored, placed, updated_at)
  values (v_me, coalesce(p_theme, 'spring'), p_name::smallint[], v_layout,
          coalesce((select array_agg(s) from unnest(p_stored) s where s ~ '^[a-z][a-z0-9-]{1,30}$' limit 60), '{}'),
          v_furn, now())
  on conflict (student_id) do update
    set theme = excluded.theme, name = excluded.name, layout = excluded.layout, stored = excluded.stored,
        placed = excluded.placed, updated_at = now();
  return jsonb_build_object('ok', true, 'placed', v_furn);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. 拜訪
-- -----------------------------------------------------------------------------
-- 同班同學的島（還沒打開過寵物島的不列）：[{卡片}]，最近改過的排前面，最多 120 座
create or replace function public.park_isle_class()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  return coalesce((select jsonb_agg(public.park_isle_card(x.sid) order by x.up desc nulls last) from (
    select x.sid, i.updated_at as up
      from public.park_mates(v_me) x(sid)
      join public.park_isle i on i.student_id = x.sid   -- 打開過寵物島的才列
     order by up desc nulls last
     limit 120) x), '[]'::jsonb);
end;
$$;

-- 島名的字（跟 js/isle.js 的 WORDS 一樣，改那邊也要改這裡）：搜尋島名用
create or replace function public.park_isle_name_text(p_name int[])
returns text language sql immutable set search_path = public, pg_temp as $$
  select coalesce((array['星空','微風','彩虹','月光','陽光','花開','雪花','楓葉','海浪','糖果','晨霧','夕陽','雲朵','森林','螢火','春天','夏日','秋風','冬眠','魔法'])[coalesce(p_name[1], 0) + 1], '')
      || coalesce((array['貓咪','小狗','倉鼠','小熊','小鹿','石虎','藍鵲','小龍','獨角獸','蝴蝶','螞蟻','穿山甲','夥伴','旅人','勇者','探險隊','好朋友','寶貝','小精靈','小英雄'])[coalesce(p_name[2], 0) + 1], '')
      || coalesce((array['樂園','小島','秘密基地','度假村','遊樂場','花園','森林','營地','果園','城堡','小鎮','牧場','海灘','天堂','王國','農場','學院','碼頭','動物園','小屋'])[coalesce(p_name[3], 0) + 1], '');
$$;

-- 同班同學的島，一頁 12 座（2026-11-05 Chuck：要能搜尋、翻頁）
-- p_q：空白＝列打開過寵物島的同學（最近改過的排前面）；有字＝找暱稱或島名，
--   還沒打開寵物島的同學也找得到（none: true，前端顯示「還沒有島」、不能參觀）
-- 回傳 {total, page, size, rows:[卡片]}
create or replace function public.park_isle_class_page(p_q text default '', p_page int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_q text := nullif(btrim(coalesce(p_q, '')), ''); v_size int := 12;
        v_page int := greatest(coalesce(p_page, 0), 0); v_total int; v_rows jsonb;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if v_q is not null then v_q := left(v_q, 20); end if;
  with m as (
    select x.sid, st.nickname, i.updated_at as up, i.student_id is not null as has
      from public.park_mates(v_me) x(sid)
      join public.students st on st.id = x.sid
      left join public.park_isle i on i.student_id = x.sid
     where case when v_q is null then i.student_id is not null
                else strpos(lower(coalesce(st.nickname, '')), lower(v_q)) > 0
                  or (i.student_id is not null and strpos(public.park_isle_name_text(i.name), replace(replace(v_q, '・', ''), ' ', '')) > 0) end),
  pg as (select * from m order by has desc, up desc nulls last, sid offset v_page * v_size limit v_size)
  select (select count(*) from m),
         coalesce((select jsonb_agg(case when pg.has then public.park_isle_card(pg.sid)
                                         else jsonb_build_object('id', pg.sid, 'nickname', pg.nickname, 'none', true) end
                                    order by pg.has desc, pg.up desc nulls last, pg.sid) from pg), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'page', v_page, 'size', v_size, 'rows', v_rows);
end;
$$;

-- 逛逛別的島：別班的島隨機 12 座（不含自己、同班）。p_seed 換一批就 +1；同一天同一個 seed 給的一樣
-- 只給卡片（暱稱、島名、擺法、寵物），不給班級、學校、年級
create or replace function public.park_isle_explore(p_seed int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  return coalesce((select jsonb_agg(public.park_isle_card(x.student_id) order by x.k) from (
    select i.student_id, md5(i.student_id::text || ':' || coalesce(p_seed, 0) || ':' || public.park_today() || ':' || v_me) as k
      from public.park_isle i
     where i.student_id <> v_me and i.placed >= 5 and i.updated_at > now() - interval '30 days'
       and not public.park_isle_classmate(v_me, i.student_id)
     order by k limit 12) x), '[]'::jsonb);
end;
$$;

-- 今日精選：今天還沒選就先選（同一時間只有一個人在選）
create or replace function public.park_isle_featured_today()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_day date := public.park_today();
begin
  if public.current_student_id() is null and not public.is_admin() then raise exception '請先登入'; end if;
  if not exists (select 1 from public.park_isle_featured where day = v_day) then
    perform pg_advisory_xact_lock(hashtext('park_isle_featured'));
    if not exists (select 1 from public.park_isle_featured where day = v_day) then
      insert into public.park_isle_featured (day, student_id, rank)
      select v_day, c.student_id, row_number() over (order by c.recent, c.score desc)
        from (select i.student_id,
                     exists (select 1 from public.park_isle_featured f
                              where f.student_id = i.student_id and f.day > v_day - 14) as recent,
                     (select count(*) from public.park_isle_reacts r where r.to_id = i.student_id and r.day > v_day - 7)
                       + random() * 3 as score
                from public.park_isle i
               where i.placed >= 5 and i.updated_at > now() - interval '30 days') c
       order by c.recent, c.score desc
       limit 6;
    end if;
  end if;
  return coalesce((select jsonb_agg(public.park_isle_card(f.student_id) order by f.rank)
                     from public.park_isle_featured f where f.day = v_day), '[]'::jsonb);
end;
$$;

-- 參觀一座島：{卡片, theme, name, layout, pets:[{species, stage, name}], mine（今天留過的圖示或 null）}
create or replace function public.park_isle_view(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_i public.park_isle;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if not public.park_isle_can_see(v_me, p_student) then raise exception '這座島現在不能參觀'; end if;
  select * into v_i from public.park_isle where student_id = p_student;
  return public.park_isle_card(p_student) || jsonb_build_object(
    'layout', coalesce(v_i.layout, '{}'::jsonb),
    'pets', coalesce((select jsonb_agg(jsonb_build_object('species', p.species, 'stage', public.park_pet_stage(p.xp), 'name', p.name) order by p.active desc, p.id)
                        from public.park_pets p where p.student_id = p_student), '[]'::jsonb),
    'mine', (select r.kind from public.park_isle_reacts r where r.from_id = v_me and r.to_id = p_student and r.day = public.park_today()),
    -- 枯葉蝶躲在這座島（主人有枯葉蝶、不是自己的島）；found＝今天找到過了
    'hide', p_student <> v_me and exists (select 1 from public.park_pets p where p.student_id = p_student and p.species = 'leaf-butterfly'),
    'found', exists (select 1 from public.park_pet_skill_log l where l.student_id = v_me and l.skill = 'find'
                        and l.other = p_student and l.day = public.park_today()),
    -- 藍鵲：今天還沒帶過禮物
    'gift', p_student <> v_me and exists (select 1 from public.park_pets p where p.student_id = v_me and p.species = 'magpie')
            and not exists (select 1 from public.park_pet_skill_log l where l.student_id = v_me and l.skill = 'magpie' and l.day = public.park_today()));
end;
$$;

-- 藍鵲的本事：去別人的島玩，每天叼一份小點心回來（直接放進背包）。回傳 {item, name} 或 null
create or replace function public.park_isle_gift(p_student uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_day date := public.park_today(); v_i public.park_pet_items;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if p_student = v_me or not public.park_isle_can_see(v_me, p_student) then return null; end if;
  if not exists (select 1 from public.park_pets p where p.student_id = v_me and p.species = 'magpie') then return null; end if;
  perform pg_advisory_xact_lock(hashtext('park_isle_gift:' || v_me));
  if exists (select 1 from public.park_pet_skill_log l where l.student_id = v_me and l.skill = 'magpie' and l.day = v_day) then return null; end if;
  select * into v_i from public.park_pet_items i where i.code in ('apple', 'carrot', 'seeds', 'biscuit', 'fish') order by random() limit 1;
  insert into public.park_pet_skill_log (student_id, skill, day, other, item) values (v_me, 'magpie', v_day, p_student, v_i.code);
  insert into public.park_pet_inventory as v (student_id, item, qty) values (v_me, v_i.code, 1)
  on conflict (student_id, item) do update set qty = v.qty + 1;
  return jsonb_build_object('item', v_i.code, 'name', v_i.name);
end;
$$;

-- 枯葉蝶躲貓貓：在同學的島上找到假裝成葉子的枯葉蝶，找到的人 +10 時光幣（每座島每天一次），
-- 島主也 +10（每天最多 3 次）。回傳 {coins, owner}
create or replace function public.park_isle_find(p_student uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_day date := public.park_today(); v_n int; v_o int := 0;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if p_student = v_me then raise exception '自己的島不用找喔'; end if;
  if not public.park_isle_can_see(v_me, p_student) then raise exception '只能參觀同班同學或今日精選的島'; end if;
  if not exists (select 1 from public.park_pets p where p.student_id = p_student and p.species = 'leaf-butterfly') then
    raise exception '這座島沒有枯葉蝶';
  end if;
  perform pg_advisory_xact_lock(hashtext('park_isle_find:' || p_student));
  if exists (select 1 from public.park_pet_skill_log l where l.student_id = v_me and l.skill = 'find' and l.other = p_student and l.day = v_day) then
    raise exception '今天已經找到過了，明天牠會躲到別的地方';
  end if;
  insert into public.park_pet_skill_log (student_id, skill, day, other) values (v_me, 'find', v_day, p_student);
  v_n := public.park_coin_grant(v_me, 'leaf:find:' || p_student || ':' || v_day, 10, null, '找到同學島上的枯葉蝶');
  if (select count(*) from public.park_pet_skill_log l where l.student_id = p_student and l.skill = 'found' and l.day = v_day) < 3 then
    insert into public.park_pet_skill_log (student_id, skill, day, other) values (p_student, 'found', v_day, v_me);
    v_o := public.park_coin_grant(p_student, 'leaf:found:' || v_me || ':' || v_day, 10, null, '同學找到你島上的枯葉蝶');
  end if;
  return jsonb_build_object('coins', v_n, 'owner', v_o);
end;
$$;

-- 留圖示：每座島每天一個、不能留給自己
create or replace function public.park_isle_react(p_student uuid, p_kind int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if p_student = v_me then raise exception '自己的島不用按喔'; end if;
  if p_kind is null or p_kind not between 0 and 5 then raise exception '沒有這個圖示'; end if;
  if not public.park_isle_can_see(v_me, p_student) then raise exception '這座島現在不能參觀'; end if;
  insert into public.park_isle_reacts (from_id, to_id, day, kind) values (v_me, p_student, public.park_today(), p_kind)
  on conflict do nothing;
  if not found then raise exception '今天已經留過了，明天可以再來'; end if;
  return jsonb_build_object('love', to_jsonb(public.park_isle_love(p_student)), 'mine', p_kind);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_isle_themes(uuid), public.park_isle_open_class(text), public.park_isle_explorable(uuid), public.park_isle_classmate(uuid, uuid),
  public.park_isle_can_see(uuid, uuid), public.park_isle_love(uuid), public.park_isle_card(uuid),
  public.park_isle_me(), public.park_isle_seen(), public.park_isle_fans(), public.park_isle_save(text, int[], jsonb, text[]),
  public.park_isle_class(), public.park_isle_featured_today(), public.park_isle_view(uuid), public.park_isle_react(uuid, int),
  public.park_isle_class_page(text, int), public.park_isle_explore(int),
  public.park_isle_gift(uuid), public.park_isle_find(uuid)
  from public, anon, authenticated;
grant execute on function
  public.park_isle_me(), public.park_isle_seen(), public.park_isle_fans(), public.park_isle_save(text, int[], jsonb, text[]),
  public.park_isle_class(), public.park_isle_featured_today(), public.park_isle_view(uuid), public.park_isle_react(uuid, int),
  public.park_isle_class_page(text, int), public.park_isle_explore(int),
  public.park_isle_gift(uuid), public.park_isle_find(uuid)
  to authenticated;
