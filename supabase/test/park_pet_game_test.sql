-- 寵物島 C 期：釣魚、澆果樹、烤點心。只在本機跑（tools/test/db.sh），接在 park_pet_egg_test.sql 後面（沿用小蛋、小殼）。
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

\echo '── 釣魚'
reset role;
delete from public.park_pets where student_id = 'e7100000-0000-0000-0000-000000000012' and species = 'leopard-cat';
set role authenticated;
select test_as('e7000000-0000-0000-0000-000000000012', true);
select test_ok(public.park_pet_fish(0) ->> 'item' is null, '沒釣到：什麼都沒有');
reset role; update public.park_pet_game_log set last_at = now() - interval '5 seconds'; set role authenticated;
select public.park_pet_fish(3) as f \gset
select test_ok(:'f'::jsonb ->> 'item' = 'fish-l' and (:'f'::jsonb -> 'inventory' ->> 'fish-l')::int = 1, '大魚進背包');
select test_ok((:'f'::jsonb ->> 'coins')::int = 2, '大魚 +2 幣');
select test_denied($$select public.park_pet_fish(1)$$, '連點太快會擋');
select test_denied($$select public.park_pet_fish(9)$$, '沒有這種魚');
reset role; update public.park_pet_game_log set coins = 9, last_at = now() - interval '5 seconds'; set role authenticated;
select test_ok((public.park_pet_fish(3) ->> 'coins')::int = 1, '一天最多 10 幣');

\echo '── 澆果樹'
select test_denied($$select public.park_pet_water('orange')$$, '島上沒有果樹不能澆');
reset role;
insert into public.park_isle (student_id, layout, placed) values ('e7100000-0000-0000-0000-000000000012',
  '{"v":2,"items":[["tree-orange",5,5,0],["oven",9,9,0]]}', 2)
on conflict (student_id) do update set layout = excluded.layout;
set role authenticated;
select public.park_pet_water('orange') as w \gset
select test_ok((:'w'::jsonb ->> 'grow')::int = 1 and (:'w'::jsonb -> 'trees' -> 'orange' ->> 'watered')::boolean, '澆一次長一階');
reset role; update public.park_pet_game_log set last_at = now() - interval '5 seconds'; set role authenticated;
select test_denied($$select public.park_pet_water('orange')$$, '一天只能澆一次');
reset role; update public.park_pet_trees set last_water = last_water - 1, grow = 2; update public.park_pet_game_log set last_at = now() - interval '5 seconds'; set role authenticated;
select test_ok((public.park_pet_water('orange') ->> 'grow')::int = 3, '澆滿 3 天結果');
select public.park_pet_harvest('orange') as h \gset
select test_ok((:'h'::jsonb -> 'reap' ->> 'n')::int = 3 and (:'h'::jsonb -> 'inventory' ->> 'fruit-orange')::int = 3, '收成 3 顆橘子');
select test_denied($$select public.park_pet_harvest('orange')$$, '收過了要再等');

\echo '── 夥伴的本事：小獨角獸、小蟻公主、黑熊'
reset role;
insert into public.park_pets (student_id, species, name, active) values
  ('e7100000-0000-0000-0000-000000000012', 'unicorn', '獨角', false),
  ('e7100000-0000-0000-0000-000000000012', 'ant-princess', '小蟻', false),
  ('e7100000-0000-0000-0000-000000000012', 'bear', '熊熊', false);
update public.park_pet_trees set last_water = last_water - 2, grow = 1; update public.park_pet_game_log set last_at = now() - interval '5 seconds';
set role authenticated;
select public.park_pet_water('orange') as w \gset
select test_ok((:'w'::jsonb ->> 'magic')::boolean and (:'w'::jsonb ->> 'grow')::int = 3, '小獨角獸讓果樹多長一階');
select test_ok((:'w'::jsonb -> 'reap' ->> 'n')::int = 4 and (:'w'::jsonb -> 'trees' -> 'orange' ->> 'grow')::int = 0, '小蟻公主自動收成，黑熊多一顆');

\echo '── 烤點心'
select test_denied($$select public.park_pet_bake('bake-apple', true)$$, '材料不夠不能烤');
select public.park_pet_bake('bake-orange', true) as b \gset
select test_ok((:'b'::jsonb -> 'inventory' ->> 'bake-orange')::int = 2 and (:'b'::jsonb -> 'inventory' ->> 'fruit-orange')::int = 5, '烤得剛剛好出兩個，用掉兩顆橘子');
reset role; update public.park_pet_game_log set last_at = now() - interval '5 seconds'; set role authenticated;
select test_ok((public.park_pet_bake('bake-orange', false) -> 'inventory' ->> 'bake-orange')::int = 3, '太早太晚也出一個');
select test_denied($$select public.park_pet_bake('bake-cake', true)$$, '沒有這個食譜');
reset role; update public.park_pets set fed_at = now() - interval '20 hours' where student_id = 'e7100000-0000-0000-0000-000000000012' and active; set role authenticated;
select public.park_pet_feed('bake-orange') as e \gset
select test_ok(exists (select 1 from jsonb_array_elements(:'e'::jsonb -> 'pets') p where (p ->> 'active')::boolean and p ->> 'buff' = 'run'), '吃了橘子小蛋糕跑得快');
reset role;
