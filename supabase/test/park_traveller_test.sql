-- 時空旅人換裝的實測。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：P2、P4、桌寵的測試剛跑完（沿用艾咪…11、阿寶…12、李老師…02），再跑過 park_traveller.sql。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
select test_one($$select id from public.students where login_id = 't2_amy'$$) as amy \gset
select test_one($$select id from public.students where login_id = 't2_bob'$$) as bob \gset

\echo '── 初始資料'
select test_ok((select count(*) from public.park_wear_sets where starter) = 3, '三套起始套裝可以挑');
select test_ok((select count(*) from public.park_wear_items where free) = 6, '臉型 2 種＋髮型 4 種人人都有');
\i supabase/park_traveller.sql
select test_ok((select count(*) from public.park_wear_items) = 18, '重跑不會多出東西');

set role authenticated;

\echo '── 建角色'
select test_as('d0000000-0000-0000-0000-000000000012', true);
select public.park_traveller_me() as s \gset
select test_ok(not (:'s'::jsonb ->> 'created')::boolean, '阿寶還沒有旅人');
select test_ok(jsonb_array_length(:'s'::jsonb -> 'owned') = 0, '衣櫃是空的');
select test_denied($$select public.park_traveller_save('{"hair":"hair-crop"}')$$, '還沒建角色不能換裝');
select test_denied($$select public.park_traveller_create('', 'hair-crop', 'space')$$, '不能挑沒有的套裝');
select test_denied($$select public.park_traveller_create('', 'hat-cap', 'tw')$$, '髮型位置放帽子不行');
select test_denied($$select public.park_traveller_create('face-elf', 'hair-crop', 'tw')$$, '沒有的臉型不行');
select test_denied($$select public.park_traveller_create('', '', 'tw')$$, '一定要有髮型');
select public.park_traveller_create('face-boy', 'hair-wolf', 'tw') as s \gset
select test_ok((:'s'::jsonb ->> 'created')::boolean, '建好了');
select test_ok(:'s'::jsonb -> 'look' ->> 'top' = 'top-floral', '起始套裝直接穿上：花布襯衫');
select test_ok(:'s'::jsonb -> 'look' ->> 'hand' = 'hand-tea', '手上拿珍奶');
select test_ok(:'s'::jsonb -> 'look' -> 'back' = 'null'::jsonb, '台灣潮沒有背飾：空著');
select test_ok(:'s'::jsonb -> 'look' ->> 'face' = 'face-boy', '臉型照選的');
select test_ok(jsonb_array_length(:'s'::jsonb -> 'owned') = 4, '衣櫃裡有整套 4 件');
select test_denied($$select public.park_traveller_create('', 'hair-crop', 'street')$$, '只能建一次');

\echo '── 換裝'
select public.park_traveller_save('{"face":null,"hair":"hair-pony","hat":null,"top":"top-floral","bottom":"bottom-shorts","hand":null,"back":null}') as s \gset
select test_ok(:'s'::jsonb -> 'look' ->> 'hair' = 'hair-pony', '髮型隨時可以換');
select test_ok(:'s'::jsonb -> 'look' -> 'hand' = 'null'::jsonb, '可以空手');
select test_ok(:'s'::jsonb -> 'look' -> 'face' = 'null'::jsonb, '臉型可以換回中性');
select test_ok((select look ->> 'hat' is null from public.park_travellers where student_id = :'bob'), '帽子拿掉存起來了');
select test_denied($$select public.park_traveller_save('{"hair":"hair-crop","top":"top-tech"}')$$, '沒買的衣服存不起來');
select test_denied($$select public.park_traveller_save('{"hair":"hair-crop","top":"bottom-shorts"}')$$, '褲子不能當上衣');
select test_denied($$select public.park_traveller_save('{"hair":"hair-crop","wings":"x"}')$$, '沒有的位置不行');
select test_denied($$select public.park_traveller_save('{"top":"top-floral"}')$$, '不能光頭');
select test_denied($$select public.park_traveller_save('"hair-crop"')$$, '格式不對擋掉');
select test_ok((select look ->> 'hair' from public.park_travellers where student_id = :'bob') = 'hair-pony', '失敗的不會改到');

\echo '── 別人的旅人、直接寫表一律擋掉'
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok(not (public.park_traveller_me() ->> 'created')::boolean, '艾咪看到的是自己（還沒建）');
select test_ok((select count(*) from public.park_travellers) = 0, '看不到阿寶的旅人');
select test_ok((select count(*) from public.park_student_wear) = 0, '也看不到阿寶的衣櫃');
select test_denied(format($$insert into public.park_student_wear (student_id, item) values (%L, 'top-tech')$$, :'amy'), '學生直接塞衣服');
select test_denied(format($$update public.park_travellers set look = '{}' where student_id = %L$$, :'bob'), '學生直接改別人的穿搭');
select test_denied(format('select public.park_wear_check(%L, %L)', :'amy', '{"hair":"hair-crop"}'), '內部檢查函式叫不動');
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select test_ok(public.park_traveller_me() is null, '老師叫旅人回空的');
select test_denied($$select public.park_traveller_create('', 'hair-crop', 'tw')$$, '老師不能建旅人');
reset role;
