-- 樂園桌寵（一期）的實測。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：P2、P4 的測試剛跑完（沿用它們的小幫手和學生），再跑過 park_pet.sql。
--   艾咪（…11）蓋過守護異世界的章和島嶼開拓者第五章；阿寶（…12）一個章都沒有。
--   兩個人都在李老師（…02）的英文 5-2。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
select test_one($$select id from public.students where login_id = 't2_amy'$$) as amy \gset
select test_one($$select id from public.students where login_id = 't2_bob'$$) as bob \gset
select test_one($$select code from public.classes where name = '英文 5-2'$$) as c2 \gset

\echo '── 初始資料'
select test_ok((select count(*) from public.park_pet_species where starter) = 3, '一開始可以選三隻：小狗、小貓、黃金鼠');
select test_ok((select facility from public.park_pet_items where code = 'rice-ball') = 'island_pioneer', '八堡圳米糰從島嶼開拓者拿');
\i supabase/park_pet.sql
select test_ok((select count(*) from public.park_pet_items) = 3, '重跑不會多出東西');

set role authenticated;

\echo '── 領養'
select test_as('d0000000-0000-0000-0000-000000000012', true);
select public.park_pet_me() as s \gset
select test_ok(jsonb_array_length(:'s'::jsonb -> 'pets') = 0, '阿寶還沒有桌寵');
select test_ok((:'s'::jsonb -> 'inventory' ->> 'kibble')::int = 3, '一打開就領到今天的 3 份飼料');
select test_ok(jsonb_array_length(:'s'::jsonb -> 'granted') = 1, '而且告訴畫面拿到了什麼');
select test_ok(jsonb_array_length(public.park_pet_me() -> 'granted') = 0, '同一天再打開不會再發');
select test_denied($$select public.park_pet_adopt('dragon', '小龍')$$, '不能領沒有的種類');
select test_denied($$select public.park_pet_adopt('puppy', '小白癡')$$, '名字也會過濾不雅字');
select test_denied($$select public.park_pet_adopt('puppy', '一二三四五六七八九')$$, '名字最多 8 個字');
select public.park_pet_adopt('hamster', '') as s \gset
select test_ok(:'s'::jsonb -> 'pets' -> 0 ->> 'name' = '黃金鼠', '沒取名就用種類的名字');
select test_ok(:'s'::jsonb -> 'pets' -> 0 ->> 'mood' = 'normal', '剛領養：普通');
select test_ok((:'s'::jsonb -> 'pets' -> 0 ->> 'stage')::int = 1, '剛領養：幼年');
select test_denied($$select public.park_pet_adopt('random', '再一隻')$$, '只能領第一隻');
select test_ok((public.park_pet_rename('豆豆') -> 'pets' -> 0 ->> 'name') = '豆豆', '可以改名');

\echo '── 隨機'
select test_as('d0000000-0000-0000-0000-000000000011', true);
select public.park_pet_adopt('random', '阿花') as s \gset
select test_ok(:'s'::jsonb -> 'pets' -> 0 ->> 'species' in ('puppy', 'kitten', 'hamster'), '選隨機：從三隻裡挑一隻');

\echo '── 護照章送點心'
select public.park_pet_me() as s \gset
select test_ok((:'s'::jsonb -> 'inventory' ->> 'rice-ball')::int = 1, '艾咪蓋過八堡圳的章：送一個米糰');
select test_ok((:'s'::jsonb -> 'inventory' ->> 'magic-fruit')::int >= 1, '蓋過守護異世界的章：送魔法果');
select test_ok((select count(*) from jsonb_array_elements(:'s'::jsonb -> 'granted') g where g ->> 'source' = 'stamp') >= 2, '畫面知道是蓋章送的');
select test_ok(jsonb_array_length(public.park_pet_me() -> 'granted') = 0, '同一個章不會送第二次');

\echo '── 餵食'
select test_denied($$select public.park_pet_feed('kibble')$$, '剛領養是飽的：3 小時內不吃飼料');
select public.park_pet_feed('rice-ball') as s \gset
select test_ok((:'s'::jsonb -> 'pets' -> 0 ->> 'xp')::int = 5, '點心隨時都吃，長 5 點經驗');
select test_ok(not (:'s'::jsonb -> 'inventory' ? 'rice-ball'), '米糰吃掉了');
select test_denied($$select public.park_pet_feed('rice-ball')$$, '背包裡沒有就不能餵');
select test_denied($$select public.park_pet_feed('nope')$$, '沒有這種食物');

\echo '── 餓、生氣、睡著'
reset role;
update public.park_pets set fed_at = now() - interval '26 hours' where student_id = :'amy';
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok(public.park_pet_me() -> 'pets' -> 0 ->> 'mood' = 'hungry', '一天沒餵：餓了');
select test_ok(public.park_pet_pat() -> 'pets' -> 0 ->> 'mood' = 'hungry', '餓的時候摸摸沒有用');
select test_ok(public.park_pet_feed('kibble') -> 'pets' -> 0 ->> 'mood' = 'normal', '餵飽就好了');

reset role;
update public.park_pets set fed_at = now() - interval '3 days' where student_id = :'amy';
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok(public.park_pet_me() -> 'pets' -> 0 ->> 'mood' = 'angry', '兩天以上沒餵：生氣');
select test_ok(public.park_pet_feed('kibble') -> 'pets' -> 0 ->> 'mood' = 'angry', '生氣時餵飽了還在鬧脾氣');
select public.park_pet_pat() as s \gset
select test_ok(:'s'::jsonb -> 'pets' -> 0 ->> 'mood' = 'happy', '摸摸哄一下就開心了');
select test_ok((:'s'::jsonb ->> 'xp')::int = 1, '摸摸長 1 點經驗');
select test_ok((public.park_pet_pat() ->> 'xp')::int = 0, '同一天再摸不再長經驗');

reset role;
update public.park_pets set fed_at = now() - interval '8 days', sulky = false where student_id = :'amy';
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok(public.park_pet_me() -> 'pets' -> 0 ->> 'mood' = 'asleep', '7 天沒來：睡著了（不會死）');
select test_denied($$select public.park_pet_feed('kibble')$$, '睡著的不能餵，要先叫醒');
select test_ok(public.park_pet_pat() -> 'pets' -> 0 ->> 'mood' = 'hungry', '叫醒了：肚子餓');

\echo '── 長大'
reset role;
update public.park_pets set xp = 39 where student_id = :'amy';
update public.park_pet_inventory set qty = 2 where student_id = :'amy' and item = 'magic-fruit';
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok((public.park_pet_me() -> 'pets' -> 0 ->> 'stage')::int = 2, '12 點以上：成長期');
select test_ok((public.park_pet_feed('magic-fruit') -> 'pets' -> 0 ->> 'stage')::int = 3, '40 點以上：完全體');

\echo '── 老師：上課時間桌寵休息'
select test_denied(format('select public.park_pet_set_class_quiet(%L, true)', :'c2'), '學生不能改班級設定');
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select test_ok(not public.park_pet_class_quiet(:'c2'), '預設沒有開');
select test_ok(public.park_pet_set_class_quiet(:'c2', true), '李老師打開了');
select test_as('d0000000-0000-0000-0000-000000000001', false, 't2a@parktest.local');
select test_denied(format('select public.park_pet_set_class_quiet(%L, false)', :'c2'), '別班老師不能改');
reset role;
select test_ok(public.park_pet_quiet(:'amy', '2026-10-05 10:00+08'), '週一早上十點：休息');
select test_ok(not public.park_pet_quiet(:'amy', '2026-10-05 17:00+08'), '週一下午五點：可以玩');
select test_ok(not public.park_pet_quiet(:'amy', '2026-10-04 10:00+08'), '星期日：可以玩');
update public.park_class_settings set pet_quiet = false where class_code = :'c2';
select test_ok(not public.park_pet_quiet(:'amy', '2026-10-05 10:00+08'), '老師關掉之後上課時間也能玩');
set role authenticated;

\echo '── 別人的桌寵、直接寫表一律擋掉'
select test_as('d0000000-0000-0000-0000-000000000012', true);
select test_ok((select count(*) from public.park_pets) = 1, '阿寶只看得到自己的桌寵');
select test_ok((select count(*) from public.park_pet_inventory where student_id <> :'bob') = 0, '也看不到別人的背包');
select test_denied(format($$update public.park_pets set xp = 999 where student_id = %L$$, :'bob'), '學生直接改經驗');
select test_denied(format($$insert into public.park_pet_inventory (student_id, item, qty) values (%L, 'rice-ball', 99)$$, :'bob'), '學生直接塞點心');
select test_denied(format('select public.park_pet_grant(%L)', :'bob'), '內部發道具函式叫不動');
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select test_ok(public.park_pet_me() is null, '老師叫桌寵回空的');
select test_denied($$select public.park_pet_adopt('puppy', '老師的狗')$$, '老師不能領養');
reset role;
