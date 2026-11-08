-- 寵物島 B 期：新夥伴的蛋、孵化、本事。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：park_pet.sql、park_isle.sql、park_coins.sql、park_parent.sql 都套過（沿用 test_ok / test_denied / test_as）。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
insert into auth.users (id, email) values
  ('e7000000-0000-0000-0000-000000000004', 'eggt@parktest.local'),
  ('e7000000-0000-0000-0000-000000000011', null),
  ('e7000000-0000-0000-0000-000000000012', null);
insert into public.teachers (user_id, display_name) values ('e7000000-0000-0000-0000-000000000004', '蛋老師');
insert into public.classes (code, name, owner) values ('EGG1', '蛋蛋班', 'e7000000-0000-0000-0000-000000000004');
insert into public.students (id, login_id, pw_hash, nickname, class_code) values
  ('e7100000-0000-0000-0000-000000000011', 'egg_a', 'x', '小蛋', 'EGG1'),
  ('e7100000-0000-0000-0000-000000000012', 'egg_b', 'x', '小殼', 'EGG1');
insert into public.park_class_members (class_code, student_id) values
  ('EGG1', 'e7100000-0000-0000-0000-000000000011'), ('EGG1', 'e7100000-0000-0000-0000-000000000012') on conflict do nothing;
insert into public.student_links (user_id, student_id) values
  ('e7000000-0000-0000-0000-000000000011', 'e7100000-0000-0000-0000-000000000011'),
  ('e7000000-0000-0000-0000-000000000012', 'e7100000-0000-0000-0000-000000000012');
insert into public.park_stamps (facility, code, name) values ('guardian', 'ch1', '草地城堡全破'), ('guardian', 'a-boss-slayer', '屠魔')
on conflict do nothing;
insert into public.park_student_stamps (student_id, facility, stamp) values
  ('e7100000-0000-0000-0000-000000000011', 'guardian', 'ch1'),
  ('e7100000-0000-0000-0000-000000000011', 'guardian', 'a-boss-slayer');

set role authenticated;
\echo '── 過關拿蛋：第一顆當天孵，第二顆隔天'
select test_as('e7000000-0000-0000-0000-000000000011', true);
select public.park_pet_me() as me \gset
select test_ok(:'me'::jsonb -> 'hatched' = '["dragon"]'::jsonb, '第一顆蛋（小火龍）當天就孵出來');
select test_ok(jsonb_array_length(:'me'::jsonb -> 'eggs') = 1 and :'me'::jsonb -> 'eggs' -> 0 ->> 'species' = 'unicorn', '小獨角獸的蛋還在等，明天孵');
select test_ok((select p.active from public.park_pets p where p.student_id = 'e7100000-0000-0000-0000-000000000011' and p.species = 'dragon'), '還沒有夥伴，小火龍直接住進小窩');
select test_ok(jsonb_array_length(public.park_pet_me() -> 'hatched') = 0, '再打開不會重孵');
select test_ok((select count(*) from jsonb_array_elements(:'me'::jsonb -> 'species') s where s ->> 'skill' <> '') = 12, '圖鑑 12 隻都寫了本事');
\echo '── 孵出來的新夥伴不佔領養名額'
select public.park_pet_adopt('puppy', null) ? 'adopted' as ok \gset
select test_ok(:'ok'::boolean, '有小火龍還是能領養第一隻起始夥伴');
select test_ok(not (select p.active from public.park_pets p where p.student_id = 'e7100000-0000-0000-0000-000000000011' and p.species = 'puppy'), '小狗住到寵物島（小窩已經有小火龍）');
select test_denied($$select public.park_pet_adopt('bear', null)$$, '新夥伴不能直接領養');

\echo '── 隔天'
reset role;
update public.park_pet_eggs set hatch_on = hatch_on - 1 where student_id = 'e7100000-0000-0000-0000-000000000011';
set role authenticated;
select test_as('e7000000-0000-0000-0000-000000000011', true);
select test_ok(public.park_pet_me() -> 'hatched' = '["unicorn"]'::jsonb, '隔天小獨角獸孵出來');

\echo '── 穿山甲每天挖寶'
reset role;
insert into public.park_pets (student_id, species, name, active) values ('e7100000-0000-0000-0000-000000000011', 'pangolin', '穿山甲', false);
set role authenticated;
select test_as('e7000000-0000-0000-0000-000000000011', true);
select test_ok(exists (select 1 from jsonb_array_elements(public.park_pet_me() -> 'granted') g where g ->> 'source' = 'dig'), '穿山甲挖到一樣東西');
select test_ok(not exists (select 1 from jsonb_array_elements(public.park_pet_me() -> 'granted') g where g ->> 'source' = 'dig'), '一天只挖一次');

\echo '── 藍鵲帶禮物、枯葉蝶躲貓貓'
reset role;
insert into public.park_pets (student_id, species, name, active) values
  ('e7100000-0000-0000-0000-000000000011', 'magpie', '藍鵲', false),
  ('e7100000-0000-0000-0000-000000000012', 'leaf-butterfly', '小葉', true);
set role authenticated;
select test_as('e7000000-0000-0000-0000-000000000011', true);
select public.park_isle_view('e7100000-0000-0000-0000-000000000012') as v \gset
select test_ok((:'v'::jsonb ->> 'hide')::boolean and (:'v'::jsonb ->> 'gift')::boolean and not (:'v'::jsonb ->> 'found')::boolean, '同學的島：有枯葉蝶、藍鵲可以帶禮物');
select test_ok(public.park_isle_gift('e7100000-0000-0000-0000-000000000012') ? 'item', '藍鵲叼回一份禮物');
select test_ok(public.park_isle_gift('e7100000-0000-0000-0000-000000000012') is null, '一天只帶一次');
select test_denied($$select public.park_isle_find('e7100000-0000-0000-0000-000000000011')$$, '自己的島不能找');
select test_ok((public.park_isle_find('e7100000-0000-0000-0000-000000000012') ->> 'coins')::int = 10, '找到枯葉蝶 +10');
select test_denied($$select public.park_isle_find('e7100000-0000-0000-0000-000000000012')$$, '同一座島一天只能找一次');
select test_ok((public.park_isle_view('e7100000-0000-0000-0000-000000000012') ->> 'found')::boolean, '畫面知道今天找過了');
select test_as('e7000000-0000-0000-0000-000000000012', true);
select test_ok((public.park_coins_me() ->> 'balance')::int >= 10, '島主也 +10');
select test_denied($$select public.park_isle_find('e7100000-0000-0000-0000-000000000011')$$, '沒有枯葉蝶的島找不到');
reset role;

\echo '── 神秘蛋孵出起始夥伴也不佔領養名額（問題回報 #55）'
delete from public.park_pets where student_id = 'e7100000-0000-0000-0000-000000000012';
delete from public.park_pet_eggs where student_id = 'e7100000-0000-0000-0000-000000000012';
select public.park_pet_egg_give('e7100000-0000-0000-0000-000000000012', 'kitten', 'parent');
select public.park_pet_hatch('e7100000-0000-0000-0000-000000000012');
select test_ok((select via from public.park_pets where student_id = 'e7100000-0000-0000-0000-000000000012' and species = 'kitten') = 'egg', '神秘蛋孵出的小貓標成 egg');
set role authenticated;
select test_as('e7000000-0000-0000-0000-000000000012', true);
select test_ok((public.park_pet_me() ->> 'adopted')::int = 0, '畫面拿到 adopted = 0');
select test_ok(public.park_pet_adopt('puppy', null) ? 'adopted', '有神秘蛋的小貓，還是能領養第一隻起始夥伴');
select test_denied($$select public.park_pet_adopt('hamster', null)$$, '第二隻要等過關（名額只有 1）');
reset role;
