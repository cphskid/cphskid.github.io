-- 樂園 P4 護照與頭像的權限實測。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：park_accounts_test.sql、park_teacher_test.sql 剛跑完（沿用它們的小幫手和學生），再跑過 park_passport.sql。
--   P2 測試跑完時，艾咪（…11）和阿寶（…12）都在李老師的英文班，小貓（…13）沒有班。
--   艾咪在守護異世界過了 t2-1（三星）、t2-2，也就是第一章全破；阿寶一關都還沒過。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
select test_one($$select id from public.students where login_id = 't2_amy'$$) as amy \gset
select test_one($$select id from public.students where login_id = 't2_bob'$$) as bob \gset
select test_one($$select id from public.students where login_id = 't2_cat'$$) as cat \gset
select test_one($$select code from public.classes where name = '英文 5-2'$$) as c2 \gset

\echo '── 初始資料'
select test_ok((select count(*) from public.park_stamps where facility = 'guardian') = 8, '守護異世界 8 個章');
select test_ok((select count(*) from public.park_stamps where facility = 'island_pioneer' and active) = 1, '島嶼開拓者只有第五章開放');
select test_ok((select count(*) from public.park_rewards where kind = 'avatar' and need_stamps = 0 and need_page is null) = 12, '一開始 12 個頭像可以選');
select test_ok((select stamps_fn from public.park_facilities where code = 'guardian') = 'guardian_earned_stamps', '守護異世界登記了「該拿到哪些章」');
update public.park_stamps set active = true where facility = 'island_pioneer' and code = 'ch1';
\i supabase/park_passport.sql
select test_ok((select active from public.park_stamps where facility = 'island_pioneer' and code = 'ch1'), '重跑不會把開放過的章又關起來');
update public.park_stamps set active = false where facility = 'island_pioneer' and code = 'ch1';

set role authenticated;

\echo '── 守護異世界：回樂園自動補蓋'
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok((public.park_my_profile() ->> 'stamps')::int = 2, '艾咪過了第一章：自動蓋了「第一次過關」和「草地城堡全破」');
select test_ok(jsonb_array_length(public.park_my_profile() -> 'unseen') = 2, '兩個都是還沒看過的新章');
select test_ok(public.park_my_profile() ->> 'frame' = 'plain', '還沒選過框：預設木頭框');
select test_ok(not (public.park_award_stamp('guardian', 'clear5') ->> 'ok')::boolean, '只過 2 關，叫函式也蓋不到「過了 5 關」');
select test_ok(public.park_award_stamp('guardian', 'clear5') ->> 'reason' like '%條件%', '而且說得出原因');
select test_ok((public.park_award_stamp('guardian', 'first') ->> 'new') = 'false', '已經有的章再蓋一次：不算新的');
select test_ok(not (public.park_award_stamp('guardian', 'nope') ->> 'ok')::boolean, '沒登記的章蓋不上去');

\echo '── 島嶼開拓者：遊戲過關時叫 park_award_stamp'
select test_ok(not (public.park_award_stamp('island_pioneer', 'ch5') ->> 'ok')::boolean, '施工中的遊戲不能蓋章');
select test_as('d0000000-0000-0000-0000-000000000004', false, 't2admin@parktest.local');
select public.park_admin_set_facility('island_pioneer', 'open', 3, 6);
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select public.park_set_class_facilities(:'c2', '{guardian,island_pioneer}');
select test_as('d0000000-0000-0000-0000-000000000011', true);
select public.park_award_stamp('island_pioneer', 'ch5') as r \gset
select test_ok((:'r'::jsonb ->> 'ok')::boolean and (:'r'::jsonb ->> 'new')::boolean, '開放之後，過完第五章蓋得到');
select test_ok(:'r'::jsonb -> 'unlocked' @> '[{"code":"sheep"},{"code":"sky"}]', '第 3 個章：解鎖綿羊和天空框，回傳給遊戲');
select test_ok(not (public.park_award_stamp('island_pioneer', 'ch1') ->> 'ok')::boolean, '還沒開放的章（第一章）蓋不上去');

\echo '── 換頭像'
select test_ok(public.park_set_avatar('sheep', 'sky') ->> 'avatar' = 'sheep', '選剛解鎖的綿羊＋天空框');
select test_ok(public.park_set_avatar(null, 'plain') = '{"avatar": "sheep", "frame": "plain"}', '只換框，頭像不變');
select test_denied($$select public.park_set_avatar('tiger', null)$$, '還沒解鎖的老虎（要 10 個章）');
select test_denied($$select public.park_set_avatar(null, 'gold')$$, '還沒蓋滿一頁的金框');
select test_denied($$select public.park_set_avatar('nope', null)$$, '沒有的頭像');
select test_denied($$select public.park_set_avatar('gold', null)$$, '把框當頭像');

\echo '── 護照'
select public.park_passport() as p \gset
select test_ok(jsonb_array_length(:'p'::jsonb -> 'pages') = 2, '兩頁：守護異世界、島嶼開拓者');
select test_ok((select count(*) from jsonb_array_elements(:'p'::jsonb -> 'pages' -> 0 -> 'stamps') s where s ->> 'at' is not null) = 2,
               '守護異世界那頁蓋了 2 個');
select test_ok((select count(*) from jsonb_array_elements(:'p'::jsonb -> 'pages' -> 0 -> 'stamps') s where (s ->> 'new')::boolean) = 2,
               '新章有標記');
select test_ok((select count(*) from jsonb_array_elements(:'p'::jsonb -> 'rewards') r where (r ->> 'unlocked')::boolean and r ->> 'kind' = 'avatar') = 15,
               '3 個章：12＋3 個頭像');
select public.park_passport_seen();
select test_ok(jsonb_array_length(public.park_my_profile() -> 'unseen') = 0, '看過之後就不算新章了');

reset role;
select test_force(format($$insert into public.park_student_stamps (student_id, facility, stamp)
  select %L, facility, code from public.park_stamps where facility = 'guardian' on conflict do nothing$$, :'amy'));
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok((public.park_passport() -> 'pages' -> 0 ->> 'full')::boolean, '守護異世界那頁蓋滿了');
select test_ok(public.park_set_avatar('panda-2', 'gold') ->> 'frame' = 'gold', '蓋滿一頁：解鎖耳機熊貓和金框');
select test_denied($$select public.park_set_avatar('pangolin-2', null)$$, '島嶼那頁沒蓋滿：羅盤穿山甲還不行');

\echo '── 有登記「該拿到哪些章」的設施，叫函式也要對得上'
reset role;
create or replace function public.island_earned_stamps(p_student uuid) returns setof text
language sql stable as $$ select 'ch5' where false $$;
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000012', true);
select test_ok(not (public.park_award_stamp('island_pioneer', 'ch5') ->> 'ok')::boolean, '阿寶沒過第五章，自己叫函式蓋不到');
reset role;
drop function public.island_earned_stamps(uuid);
set role authenticated;

\echo '── 誰看得到'
select test_as('d0000000-0000-0000-0000-000000000012', true);
select test_ok((select count(*) from public.park_student_stamps where student_id = :'amy') = 0, '阿寶看不到艾咪的章');
select test_ok((select count(*) from public.park_profiles where student_id = :'amy') = 0, '阿寶看不到艾咪的頭像設定');
select test_ok((select count(*) from public.park_stamps) >= 16, '章的目錄大家看得到');
select test_ok((select count(*) from public.park_class_avatars(:'c2')) = 0, '學生叫老師名單的頭像：什麼都拿不到');
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select test_ok((select avatar from public.park_class_avatars(:'c2') where student_id = :'amy') = 'panda-2', '李老師看得到班上艾咪的頭像');
select test_ok((select stamps from public.park_class_avatars(:'c2') where student_id = :'amy') = 9, '和章數');
select test_ok((select count(*) from public.park_student_stamps where student_id = :'amy') = 9, '老師讀得到自己學生的章');
select test_ok(public.park_my_profile() is null, '老師叫「我的頭像」回空的');
select test_ok(not (public.park_award_stamp('guardian', 'first') ->> 'ok')::boolean, '老師不能蓋章');
select test_as('d0000000-0000-0000-0000-000000000003', false, 't2c@parktest.local');
select test_ok((select count(*) from public.park_class_avatars(:'c2')) = 0, '別班的張老師拿不到');
select test_ok((select count(*) from public.park_student_stamps where student_id = :'amy') = 0, '也讀不到章');

reset role;
set role anon;
select test_ok((select count(*) from public.park_rewards) > 0, '沒登入也看得到頭像目錄');
select test_denied($$select public.park_passport()$$, 'anon 叫不動護照');
reset role;
set role authenticated;

\echo '── 直接寫表、叫內部函式一律擋掉'
select test_as('d0000000-0000-0000-0000-000000000012', true);
select test_denied(format($$insert into public.park_student_stamps (student_id, facility, stamp) values (%L, 'guardian', 'ch3')$$, :'bob'), '學生直接寫章');
select test_denied(format($$insert into public.park_profiles (student_id, avatar) values (%L, 'tiger')$$, :'bob'), '學生直接寫頭像');
select test_denied($$update public.park_rewards set need_stamps = 0$$, '學生改解鎖條件');
select test_denied(format('select public.park_stamp_sync(%L)', :'bob'), '內部補蓋函式叫不動');
select test_denied(format('select * from public.guardian_earned_stamps(%L)', :'amy'), '查別人該拿到哪些章');
select test_denied(format('select * from public.park_unlocked(%L)', :'amy'), '查別人解鎖了什麼');
select test_ok(public.park_my_profile() ->> 'stamps' = '0', '阿寶還沒過關：0 個章');

reset role;
select test_as('d0000000-0000-0000-0000-000000000004', false, 't2admin@parktest.local');
set role authenticated;
select public.park_admin_set_facility('island_pioneer', 'construction', null, null, '{}');
reset role;

\echo '── 全部通過'
