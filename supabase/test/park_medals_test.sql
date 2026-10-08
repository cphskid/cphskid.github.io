-- 成就勳章（2026-10-08）：分類、島嶼開拓者每章 5 格、代表勳章與展示櫃、名片、勳章解鎖的頭像框。
-- 只在本機跑（tools/test/db.sh，要給 ISLAND_REPO）。前提：park_passport_test.sql 跑完（島嶼開拓者已開放、
-- 英文 5-2 班有艾咪…11、阿寶…12；小貓…13 沒有班），再跑過島嶼開拓者的 island_pioneer.sql。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
select test_one($$select code from public.classes where name = '英文 5-2'$$) as c2 \gset
select test_one($$select id from public.students where login_id = 't2_amy'$$) as amy \gset
select test_one($$select id from public.students where login_id = 't2_bob'$$) as bob \gset
select test_one($$select id from public.students where login_id = 't2_cat'$$) as cat \gset
-- 這份測試要：艾咪、阿寶在英文 5-2，而且這班只有他們兩個
delete from public.park_class_members where class_code = :'c2' and student_id not in (:'amy', :'bob');
insert into public.park_class_members (class_code, student_id) values
  (:'c2', :'amy'), (:'c2', :'bob') on conflict do nothing;
delete from public.park_class_members where student_id = :'cat';

\echo '── 勳章目錄'
select test_ok((select count(*) from public.park_stamps where facility = 'island_pioneer' and era = 'past') = 2 + 8 * 5 + 1, '過去篇：序章 2 格＋八章各 5 格＋時光守護者');
select test_ok((select count(*) from public.park_stamps where facility = 'island_pioneer' and era = 'now' and not active) = 2, '現在篇先佔位，即將開放');
select test_ok((select count(distinct kind) from public.park_stamps where facility = 'island_pioneer' and grp = 'ch2') = 5, '第二章有通關、收集、精通、劇情、彩蛋');
select test_ok((select kind from public.park_stamps where facility = 'guardian' and code = 'stars20') = 'master', '守護異世界的章也分好類');
select test_ok((select count(*) from public.park_rewards where kind = 'frame') = 12, '頭像框 12 種');

set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000004', false, 't2admin@parktest.local');
select public.park_admin_set_facility('island_pioneer', 'open', 3, 6);
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select public.park_set_class_facilities(:'c2', '{guardian,island_pioneer}');
select test_as('d0000000-0000-0000-0000-000000000011', true);

\echo '── 島嶼開拓者：從存檔算出該拿到的勳章'
select public.island_save('ch2', '{"v":1,"reached":6,"stars":3,"done":true,"picks":{"seed":0,"fawn":1,"trader":0},
  "cards":["a","b","c","d","e","f","g","h","i","j","k","l"]}');
select public.island_save('medals', '{"v":1,"endings":["ch2:fawn1-seed0-trader0"],"chal":[],"eggs":["ch2","pro","ch1"]}');
select public.park_my_profile() as prof \gset
select test_ok(exists (select 1 from public.park_student_stamps where student_id = public.current_student_id() and stamp = 'ch2-card'), '圖鑑 12 張：收集勳章');
select test_ok(not exists (select 1 from public.park_student_stamps where student_id = public.current_student_id() and stamp = 'ch2-star'), '三顆星但⭐⭐⭐再挑戰沒過：還不是精通');
select test_ok(not exists (select 1 from public.park_student_stamps where student_id = public.current_student_id() and stamp = 'ch2-end'), '只看過一種結局：還沒有劇情勳章');
select test_ok(exists (select 1 from public.park_student_stamps where student_id = public.current_student_id() and stamp = 'ch2-egg'), '找到時光碎片：彩蛋勳章');
select test_ok(not exists (select 1 from public.park_student_stamps where student_id = public.current_student_id() and stamp = 'pro'), '序章沒有玩到最後：沒有序章勳章');
select public.island_save('medals', '{"v":1,"endings":["ch2:fawn1-seed0-trader0","ch2:fawn0-seed0-trader0","pro:done1"],"chal":["ch2:hunt"],"eggs":["ch2","pro","ch1"]}');
select test_ok(public.park_award_stamp('island_pioneer', 'ch2-star') ->> 'reason' is null, '再挑戰過了：遊戲叫函式馬上蓋到精通');
select test_ok((public.park_award_stamp('island_pioneer', 'ch2-end') ->> 'new')::boolean, '看過兩種結局：劇情勳章');
select test_ok((public.park_award_stamp('island_pioneer', 'pro') ->> 'ok')::boolean, '序章玩到最後：序章勳章');
select test_ok(not (public.park_award_stamp('island_pioneer', 'past') ->> 'ok')::boolean, '還沒全破：蓋不到時光守護者');
select test_ok(not (public.park_award_stamp('island_pioneer', 'v-village') ->> 'ok')::boolean, '現在篇還沒開放：蓋不上去');

\echo '── 勳章解鎖頭像框'
select public.park_passport() as p \gset
select test_ok((select (r ->> 'unlocked')::boolean from jsonb_array_elements(:'p'::jsonb -> 'rewards') r where r ->> 'code' = 'riddle'), '3 枚彩蛋：解鎖謎語框');
select test_ok((select not (r ->> 'unlocked')::boolean and r ->> 'need_kind' = 'egg' from jsonb_array_elements(:'p'::jsonb -> 'rewards') r where r ->> 'code' = 'egghunter'), '彩蛋獵人框要 9 枚，還沒');
select test_ok(public.park_set_avatar(null, 'riddle') ->> 'frame' = 'riddle', '換上謎語框');
select test_denied($$select public.park_set_avatar(null, 'keeper')$$, '還沒拿到時光守護者，換不了它的框');

\echo '── 代表勳章與展示櫃'
select test_ok(public.park_set_medals('island_pioneer/ch2-egg', '{island_pioneer/ch2-star,island_pioneer/ch2-card,island_pioneer/pro}') ->> 'featured' = 'island_pioneer/ch2-egg', '掛上代表勳章、排好展示櫃');
select test_denied($$select public.park_set_medals('island_pioneer/past', null)$$, '沒拿到的勳章不能掛');
select test_denied($$select public.park_set_medals(null, '{island_pioneer/ch2-egg,island_pioneer/ch2-star,island_pioneer/ch2-card,island_pioneer/pro}')$$, '展示櫃只有 3 格');
select test_ok(public.park_my_profile() -> 'featured' ->> 'rarity' = 'rainbow', '右上角的資料帶著代表勳章');
select public.park_passport() as p \gset
select test_ok(:'p'::jsonb ->> 'featured' = 'island_pioneer/ch2-egg' and jsonb_array_length(:'p'::jsonb -> 'showcase') = 3, '護照知道代表勳章和展示櫃');
select test_ok((select (x ->> 'owners')::int from jsonb_array_elements(:'p'::jsonb -> 'pages') pg, jsonb_array_elements(pg -> 'stamps') x
                 where pg ->> 'facility' = 'island_pioneer' and x ->> 'code' = 'ch2-egg') = 1, '護照上的勳章：全班有 1 個人拿到');

\echo '── 名片'
select test_as('d0000000-0000-0000-0000-000000000012', true);
select public.park_student_card(:'amy') as card \gset
select test_ok(:'card'::jsonb -> 'featured' ->> 'name' = '樹梢上的閃光', '同班的阿寶點艾咪：看得到代表勳章');
select test_ok((:'card'::jsonb -> 'featured' ->> 'owners')::int = 1 and (:'card'::jsonb -> 'featured' ->> 'classmates')::int = 2, '全班 2 人只有 1 人拿到');
select test_ok(jsonb_array_length(:'card'::jsonb -> 'showcase') = 3 and :'card'::jsonb ->> 'frame' = 'riddle', '展示櫃 3 格、頭像框');
select test_ok((select count(*) from public.park_class_featured(:'c2')) = 2, '同班同學看得到全班的代表勳章（排行榜用）');
select test_ok((select featured ->> 'code' from public.park_class_featured(:'c2') where student_id = :'amy') = 'ch2-egg', '艾咪那一列是她的代表勳章');
select test_as('d0000000-0000-0000-0000-000000000013', true);
select test_denied(format('select public.park_student_card(%L)', :'amy'), '不同班的小貓看不到艾咪的名片');
select test_ok((select count(*) from public.park_class_featured(:'c2')) = 0, '也看不到那班的代表勳章');
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select test_ok(public.park_student_card(:'amy') -> 'featured' ->> 'code' = 'ch2-egg', '老師看得到自己班學生的名片');
reset role;
