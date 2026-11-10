-- =============================================================================
-- 時光實驗室（設施 time_lab，2026-11-06 第一期）
-- =============================================================================
--
-- 一間可以左右橫移的實驗室（lab/）：書櫃裡的互動書（每本三章）、牆上的工具。
-- 工具要在時光祕境島過關才點亮（讀 animal_progress），書一開始就能讀。
--
--   lab_track(item, stars)   學生：讀完一章（item＝章的代碼，stars＝這次幾顆星）。只有這一支能寫。
--   lab_me()                 學生：我讀完哪些章、幾顆星，祕境島過了哪幾關（點亮工具用）
--   lab_coin_sources(uuid)   樂園時光幣：每章第一次讀完 10、一本三章都讀完再 20、每個實驗第一次做完 5
--   lab_earned_stamps(uuid)  護照勳章：四本書各一枚、整個書櫃讀完、全部三星、12 個實驗都做完
--
-- 第二期（2026-11-10）：牆上的工具點開是「實驗」，item＝'x-<工具>'（x-forest…），清單在 lab_exps()；
-- 工具要在時光祕境島過關才算數（need＝祕境島關卡代碼），鏡子、噴水瓶一開始就能做（need 空）。
--
-- 章的代碼由前端決定（feed、band…），只有「哪幾章算一本書」寫在 lab_books()；之後加書改這裡。
-- 套用順序：park_coins.sql → park_passport.sql → park_animal.sql → 這份（重跑沒關係）

create table if not exists public.lab_progress (
  student_id     uuid not null references public.students(id) on delete cascade,
  item           text not null check (item ~ '^[a-z][a-z0-9-]{1,30}$'),
  stars          smallint not null default 0 check (stars between 0 and 3),
  plays          int not null default 0,
  first_done_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (student_id, item)
);
alter table public.lab_progress enable row level security;
revoke all on public.lab_progress from public, anon, authenticated;

-- 書櫃上的書：書代碼 → 三章。前端 src/data/books.ts 要跟這裡一樣。
create or replace function public.lab_books()
returns table (book text, name text, items text[])
language sql immutable as $$
  values ('animal', '動物本領圖鑑', array['feed', 'survive', 'ants']),
         ('sound',  '聲音與光之書', array['band', 'quiet', 'light']),
         ('sky',    '天空觀測書',   array['shadow', 'planets', 'north']),
         ('fire',   '火與鐵之書',   array['lab', 'fire', 'spot']);
$$;

-- 實驗：item → 要先過哪一關（祕境島 animal_progress.level）。前端 src/ui/App.tsx 的 EXPS 要跟這裡一樣。
create or replace function public.lab_exps()
returns table (item text, need text)
language sql immutable as $$
  values ('x-forest', 'forest'), ('x-nest', 'nest'), ('x-harbor', 'harbor'), ('x-town', 'town'),
         ('x-sky', 'sky'), ('x-pond', 'pond'), ('x-beacon', 'beacon'), ('x-stage', 'stage'),
         ('x-stars', 'stars'), ('x-storm', 'storm'), ('x-mirror', null), ('x-spray', null);
$$;

create or replace function public.lab_track(p_item text, p_stars int default 0)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me   uuid := public.current_student_id();
  v_item text := lower(btrim(coalesce(p_item, '')));
  v_st   smallint := least(greatest(coalesce(p_stars, 0), 0), 3);
begin
  if v_me is null then return; end if;
  if not exists (select 1 from public.lab_books() b where v_item = any (b.items))
     and not exists (select 1 from public.lab_exps() e where e.item = v_item
                      and (e.need is null or exists (select 1 from public.animal_progress a
                            where a.student_id = v_me and a.level = e.need and a.first_clear_at is not null)))
  then return; end if;
  insert into public.lab_progress as p (student_id, item, stars, plays) values (v_me, v_item, v_st, 1)
  on conflict (student_id, item) do update
    set stars = greatest(p.stars, excluded.stars), plays = p.plays + 1, updated_at = now();
end;
$$;

create or replace function public.lab_me()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'done', coalesce((select jsonb_object_agg(p.item, p.stars) from public.lab_progress p
                       where p.student_id = public.current_student_id()), '{}'::jsonb),
    'animal', case when to_regclass('public.animal_progress') is null then '[]'::jsonb else
      coalesce((select jsonb_agg(a.level) from public.animal_progress a
                 where a.student_id = public.current_student_id() and a.first_clear_at is not null), '[]'::jsonb) end);
$$;

-- ---------- 時光幣 ----------
insert into public.park_coin_rates (code, amount, note) values
  ('lab_chapter', 10, '時光實驗室：互動書每章第一次讀完'),
  ('lab_book',    20, '時光實驗室：一本書三章都讀完'),
  ('lab_exp',      5, '時光實驗室：每個實驗第一次做完')
on conflict (code) do nothing;

create or replace function public.lab_coin_sources(p_student uuid)
returns table (source text, amount int, note text)
language sql stable security definer set search_path = public, pg_temp as $$
  select 'lab:ch:' || p.item, public.park_coin_rate('lab_chapter'), '時光實驗室：讀完一章'
    from public.lab_progress p where p.student_id = p_student
     and exists (select 1 from public.lab_books() b where p.item = any (b.items))
  union all
  select 'lab:x:' || substr(p.item, 3), public.park_coin_rate('lab_exp'), '時光實驗室：做完一個實驗'
    from public.lab_progress p join public.lab_exps() e on e.item = p.item where p.student_id = p_student
  union all
  select 'lab:book:' || b.book, public.park_coin_rate('lab_book'), '時光實驗室：讀完《' || b.name || '》'
    from public.lab_books() b
   where (select count(*) from public.lab_progress p where p.student_id = p_student and p.item = any (b.items))
         = cardinality(b.items);
$$;

-- ---------- 護照勳章 ----------
insert into public.park_facilities (code, zone, name, status, description, sort)
values ('time_lab', 'village', '時光實驗室', 'open', '可以左右橫移的實驗室：書櫃裡的互動書、時光祕境島過關點亮的工具。在樂園地圖上的小島進去（/lab/）。', 10)
on conflict (code) do update set name = excluded.name, description = excluded.description;

create or replace function public.lab_earned_stamps(p_student uuid)
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  select 'book-' || b.book from public.lab_books() b
   where (select count(*) from public.lab_progress p where p.student_id = p_student and p.item = any (b.items))
         = cardinality(b.items)
  union all
  select 'shelf' where (select count(*) from public.lab_progress p, public.lab_books() b
                         where p.student_id = p_student and p.item = any (b.items))
                     >= (select sum(cardinality(b.items)) from public.lab_books() b)
  union all
  select 'stars' where (select count(*) from public.lab_progress p, public.lab_books() b
                         where p.student_id = p_student and p.item = any (b.items) and p.stars = 3)
                     >= (select sum(cardinality(b.items)) from public.lab_books() b)
  union all
  select 'exps' where (select count(*) from public.lab_progress p join public.lab_exps() e on e.item = p.item
                        where p.student_id = p_student) >= (select count(*) from public.lab_exps());
$$;
update public.park_facilities
   set stamps_fn = 'lab_earned_stamps', coins_fn = 'lab_coin_sources',
       url = coalesce(url, '/lab/'), url_dev = coalesce(url_dev, '/dev/lab/'), updated_at = now()
 where code = 'time_lab';

insert into public.park_stamps (facility, code, name, hint, art, sort, kind, rarity) values
  ('time_lab', 'book-animal', '動物本領圖鑑', '讀完書櫃上的《動物本領圖鑑》三章', 'img/stamp/lab-animal.webp', 1, 'clear',   'bronze'),
  ('time_lab', 'book-sound',  '聲音與光之書', '讀完書櫃上的《聲音與光之書》三章', 'img/stamp/lab-sound.webp',  2, 'clear',   'bronze'),
  ('time_lab', 'book-sky',    '天空觀測書',   '讀完書櫃上的《天空觀測書》三章',   'img/stamp/lab-sky.webp',    3, 'clear',   'bronze'),
  ('time_lab', 'book-fire',   '火與鐵之書',   '讀完書櫃上的《火與鐵之書》三章',   'img/stamp/lab-fire.webp',   4, 'clear',   'bronze'),
  ('time_lab', 'shelf',       '書櫃讀透透',   '書櫃上的每一本書都讀完',           'img/stamp/lab-shelf.webp',  5, 'collect', 'gold'),
  ('time_lab', 'stars',       '實驗室之星',   '每一章都拿到三顆星',               'img/stamp/lab-stars.webp',  6, 'master',  'rainbow'),
  ('time_lab', 'exps',        '實驗高手',     '實驗室裡的 12 個實驗都做完',       'img/stamp/lab-exp.webp',    7, 'collect', 'gold')
on conflict (facility, code) do update set name = excluded.name, hint = excluded.hint, art = excluded.art,
  sort = excluded.sort, kind = excluded.kind, rarity = excluded.rarity;

-- ---------- 權限 ----------
revoke all on function public.lab_books(), public.lab_exps(), public.lab_track(text, int), public.lab_me(),
  public.lab_coin_sources(uuid), public.lab_earned_stamps(uuid) from public, anon, authenticated;
grant execute on function public.lab_track(text, int), public.lab_me() to authenticated;
