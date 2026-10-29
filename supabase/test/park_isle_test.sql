-- 寵物島裝扮、拜訪、今日精選的實測。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：前面的測試都跑完（艾咪 d…11、阿寶 d…12 同在英文 5-2；小貓 d…13 在別班），再跑過 park_isle.sql。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
select test_one($$select id from public.students where login_id = 't2_amy'$$) as amy \gset
select test_one($$select id from public.students where login_id = 't2_bob'$$) as bob \gset
select test_one($$select id from public.students where login_id = 't2_cat'$$) as cat \gset

\i supabase/park_isle.sql
select test_ok((select count(*) from public.park_shop_items where cat = 'theme') = 3, '商店上架三種島的風格，重跑不會多');

set role authenticated;

\echo '── 自己的島'
select test_as('d0000000-0000-0000-0000-000000000011', true);
select public.park_isle_me() as s \gset
select test_ok(not (:'s'::jsonb ->> 'saved')::boolean, '還沒存過');
select test_ok(:'s'::jsonb -> 'themes' = '["spring"]'::jsonb, '一開始只有春日花園');
select test_denied($$select public.park_isle_save('beach', array[1,2,3], '{}', '{}')$$, '沒買的風格不能用');
select test_denied($$select public.park_isle_save('spring', array[1,2], '{}', '{}')$$, '島名要三組');
select test_denied($$select public.park_isle_save('spring', array[1,2,30], '{}', '{}')$$, '島名不能超出選單');
select public.park_isle_save('spring', array[3,4,5],
  '{"bed":{"x":0.5,"y":0.7,"f":1},"slide":{"x":2,"y":-1},"pool":{"x":0.3,"y":0.6},"tent":{"x":0.8,"y":0.6},"swing":{"x":0.4,"y":0.65},"BAD ID":{"x":0.1,"y":0.1}}',
  array['lantern']) as r \gset
select test_ok((:'r'::jsonb ->> 'placed')::int = 5, '存五件，怪名字的不收');
select public.park_isle_me() as s \gset
select test_ok(:'s'::jsonb -> 'layout' -> 'slide' = '{"x": 1, "y": 0, "f": 0}'::jsonb, '座標夾在 0～1');
select test_ok((:'s'::jsonb -> 'layout' -> 'bed' ->> 'f')::int = 1, '翻面記得住');
select test_ok(:'s'::jsonb -> 'name' = '[3,4,5]'::jsonb, '島名記得住');

\echo '── 買島的風格'
reset role;
insert into public.park_coin_ledger (student_id, source, amount, note) values (:'amy', 'test:isle', 500, '測試');
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000011', true);
select public.park_shop_buy('shop', 'theme-beach') is not null;
select test_ok(public.park_isle_me() -> 'themes' ? 'beach', '買了夕陽海灘就能用');
select test_ok((select (x ->> 'owned')::boolean from jsonb_array_elements(public.park_shop() -> 'items') x where x ->> 'code' = 'theme-beach'), '商店標示已經有了');
select test_denied($$select public.park_shop_buy('shop', 'theme-beach')$$, '不能買第二次');
select test_ok((public.park_isle_save('beach', array[3,4,5], public.park_isle_me() -> 'layout', '{}') ->> 'ok')::boolean, '換成夕陽海灘');

\echo '── 拜訪同班'
select test_as('d0000000-0000-0000-0000-000000000012', true);
select test_ok(exists (select 1 from jsonb_array_elements(public.park_isle_class()) x where (x ->> 'id')::uuid = :'amy'), '阿寶看得到同班艾咪的島');
select test_ok(not exists (select 1 from jsonb_array_elements(public.park_isle_class()) x where (x ->> 'id')::uuid = :'cat'), '別班的小貓不在清單');
select public.park_isle_view(:'amy') as v \gset
select test_ok(:'v'::jsonb ->> 'theme' = 'beach' and :'v'::jsonb -> 'mine' = 'null'::jsonb, '參觀看得到主題，今天還沒留');
select test_ok((public.park_isle_react(:'amy', 2) -> 'love' ->> 2)::int = 1, '留一個好漂亮');
select test_denied(format('select public.park_isle_react(%L, 0)', :'amy'), '同一天不能再留');
select test_denied(format('select public.park_isle_react(%L, 9)', :'amy'), '沒有的圖示不行');
select test_denied(format('select public.park_isle_view(%L)', :'cat'), '別班又沒上精選：不能看');

\echo '── 收到的圖示'
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_denied(format('select public.park_isle_react(%L, 0)', :'amy'), '自己的島不用按');
select public.park_isle_me() as s \gset
select test_ok(:'s'::jsonb -> 'inbox' -> 0 ->> 'nickname' = '阿寶' and (:'s'::jsonb -> 'inbox' -> 0 ->> 'kind')::int = 2, '艾咪收到阿寶的好漂亮');
select public.park_isle_seen();
select test_ok(jsonb_array_length(public.park_isle_me() -> 'inbox') = 0, '看過就不再列');

\echo '── 今日精選'
select test_as('d0000000-0000-0000-0000-000000000013', true);
select public.park_isle_featured_today() as f \gset
select test_ok(exists (select 1 from jsonb_array_elements(:'f'::jsonb) x where (x ->> 'id')::uuid = :'amy'), '擺了 5 件的艾咪上精選');
select test_ok(jsonb_array_length(public.park_isle_featured_today()) = jsonb_array_length(:'f'::jsonb), '同一天再問是同一批');
select test_ok((public.park_isle_view(:'amy') ->> 'theme') = 'beach', '別班的小貓可以參觀精選島');
select test_ok((public.park_isle_react(:'amy', 0) -> 'love' ->> 0)::int = 1, '也可以留圖示');
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok((public.park_isle_me() ->> 'featured')::boolean, '艾咪知道自己上精選了');

\echo '── 沒登入'
select test_as(null, false);
select test_denied($$select public.park_isle_me()$$, '沒登入不能看');
