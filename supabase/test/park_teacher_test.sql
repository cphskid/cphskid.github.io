-- 樂園 P2 教師入口的權限實測。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：park_accounts_test.sql 剛跑完（沿用它的小幫手），再跑過 park_teacher.sql。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;

create or replace function test_one(p_sql text) returns text
language plpgsql security definer as $$ declare v text; begin execute p_sql into v; return v; end $$;
grant execute on function test_one(text) to authenticated, anon;

-- 新的一組人，跟 P1 的測試資料分開
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 't2a@parktest.local'),   -- 導師 陳老師
  ('d0000000-0000-0000-0000-000000000002', 't2b@parktest.local'),   -- 英文科任 李老師
  ('d0000000-0000-0000-0000-000000000003', 't2c@parktest.local'),   -- 別班 張老師
  ('d0000000-0000-0000-0000-000000000004', 't2admin@parktest.local'),
  ('d0000000-0000-0000-0000-000000000011', null),
  ('d0000000-0000-0000-0000-000000000012', null),
  ('d0000000-0000-0000-0000-000000000013', null);
insert into public.teachers (user_id, display_name) values
  ('d0000000-0000-0000-0000-000000000001', '陳老師'),
  ('d0000000-0000-0000-0000-000000000002', '李老師'),
  ('d0000000-0000-0000-0000-000000000003', '張老師');
insert into public.teachers (user_id, display_name, is_admin) values
  ('d0000000-0000-0000-0000-000000000004', '管理員', true)
on conflict (user_id) do update set is_admin = true;

-- 守護異世界的關卡（本機沒灌 seed）
insert into public.levels (id, no, name, chapter) values
  ('t2-1', 9001, '史萊姆草原', 1), ('t2-2', 9002, '哥布林森林', 1),
  ('t2-3', 9003, '龍之谷', 2), ('t2-4', 9004, '魔王城', 2)
on conflict do nothing;

-- 開班前就存在的班（模擬守護異世界的老師後台開的）
\echo '── 現有的班自動開放守護異世界'
insert into public.classes (code, name, owner) values ('T2OLD', '舊班', 'd0000000-0000-0000-0000-000000000003');
select test_ok((select count(*) from public.park_class_facilities where class_code = 'T2OLD' and facility = 'guardian') = 1,
               '守護異世界開的新班，觸發器自動開放守護異世界');
select test_ok((select count(*) from public.park_class_facilities where class_code = 'PK1' and facility = 'guardian') = 1,
               'P1 測試留下的舊班也補上了');
set role authenticated;
select test_as('b0000000-0000-0000-0000-000000000001', false, 'parkt1@parktest.local');
select public.park_set_class_facilities('PK1', '{}');
reset role;
\i supabase/park_teacher.sql
select test_ok((select count(*) from public.park_class_facilities where class_code = 'PK1') = 0,
               '重跑不會把老師關掉的設施又打開……');
\i supabase/park_teacher.sql
select test_ok((select status from public.park_facilities where code = 'guardian') = 'open', '設施初始資料在');

set role authenticated;

\echo '── 開班'
select test_as('d0000000-0000-0000-0000-000000000001', false, 't2a@parktest.local');
select public.park_create_class('五年二班', 5, 'school') as c1 \gset
select test_ok(:'c1' ~ '^[A-HJ-NP-Z2-9]{6}$', '代碼是系統產生的 6 碼（沒有 0/O/1/I）');
select test_ok((select grade from public.park_teacher_classes() where code = :'c1') = 5, '年級記好了');
select test_ok((select facilities from public.park_teacher_classes() where code = :'c1') = '{guardian}',
               '新班預設開放「開放中」的設施（守護異世界）');
select test_denied($$select public.park_create_class('', 5, 'school')$$, '班名空白');
select test_denied($$select public.park_create_class('學校班', null, 'school')$$, '學校班沒選年級');
select test_denied($$select public.park_create_class('怪班', 3, 'party')$$, '亂填類型');
select test_ok(public.park_create_class('小明家', null, 'home') ~ '^[A-Z0-9]{6}$', '家庭班可以不選年級');
select public.park_save_class(:'c1', '五年二班（新）', 6, 'school');
select test_ok((select name || grade from public.park_teacher_classes() where code = :'c1') = '五年二班（新）6', '改班名與年級');

select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select public.park_create_class('英文 5-2', 5, 'school') as c2 \gset
select test_ok((select count(*) from public.park_teacher_classes()) = 1, '李老師只看到自己的班');
select test_denied(format('select public.park_save_class(%L, %L, 5, %L)', :'c1', '搶來的', 'school'), '改別人的班');
select test_denied(format('select public.park_set_class_facilities(%L, %L)', :'c1', '{guardian}'), '改別人班的開放設施');
select test_denied(format('select public.park_class_overview(%L)', :'c1'), '看別人班的總覽');

\echo '── 學生加入兩個班'
select test_as('d0000000-0000-0000-0000-000000000011', true);
select student_id is not null from public.register_student('t2_amy', 'qw78er', '艾咪', :'c1');
select public.park_join_class(:'c2');
select test_as('d0000000-0000-0000-0000-000000000012', true);
select student_id is not null from public.register_student('t2_bob', 'zx90cv', '阿寶', :'c2');
select test_as('d0000000-0000-0000-0000-000000000013', true);
select student_id is not null from public.register_student('t2_cat', 'as56df', '小貓', :'c1');
select test_one($$select id from public.students where login_id = 't2_amy'$$) as amy \gset
select test_one($$select id from public.students where login_id = 't2_bob'$$) as bob \gset
select test_one($$select id from public.students where login_id = 't2_cat'$$) as cat \gset

\echo '── 進場檢查與地圖'
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok((public.park_can_enter('guardian') ->> 'ok')::boolean, '艾咪的班有開放守護異世界：可以進');
select test_ok(not (public.park_can_enter('island_pioneer') ->> 'ok')::boolean, '施工中的設施不能進');
select test_ok((select mine from public.park_facility_list() where code = 'guardian'), '地圖：守護異世界對艾咪是開放的');

select test_as('d0000000-0000-0000-0000-000000000001', false, 't2a@parktest.local');
select test_ok(public.park_set_class_facilities(:'c1', '{}') = '{}', '陳老師把守護異世界關掉');
select test_as('d0000000-0000-0000-0000-000000000013', true);
select test_ok(not (public.park_can_enter('guardian') ->> 'ok')::boolean, '小貓（只在陳老師班）就進不去了');
select test_ok(public.park_can_enter('guardian') ->> 'reason' like '%還沒有開放%', '而且說得出原因');
select test_ok(not (select mine from public.park_facility_list() where code = 'guardian'), '地圖也標成沒開放');
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok((public.park_can_enter('guardian') ->> 'ok')::boolean, '艾咪還在李老師的英文班，照樣可以進');
select test_as('d0000000-0000-0000-0000-000000000001', false, 't2a@parktest.local');
select public.park_set_class_facilities(:'c1', '{guardian,nope}');
select test_ok((select facilities from public.park_teacher_classes() where code = :'c1') = '{guardian}', '打開回來，亂填的設施會被忽略');

reset role;
set role anon;
select test_ok((select count(*) from public.park_facility_list()) >= 3, '沒登入也看得到設施狀態（地圖用）');
select test_ok((select mine from public.park_facility_list() where code = 'guardian') is null, '沒登入時 mine 是空的');
select test_denied($$select public.park_can_enter('guardian')$$, 'anon 叫不動進場檢查');
select test_denied($$select * from public.park_teacher_classes()$$, 'anon 叫不動老師的函式');
reset role;
set role authenticated;

\echo '── 全班總覽（守護異世界的摘要）'
reset role;
select test_force(format($$insert into public.level_progress (student_id, level_id, stars, cleared_at)
  values (%L, 't2-1', 3, now()), (%L, 't2-2', 2, now())$$, :'amy', :'amy'));
select test_force(format($$insert into public.answer_events (student_id, word_id, skill, correct, game_id, at)
  select %L, w.id, 'recognize', true, 'tower', now() - interval '1 hour' from public.words w limit 1$$, :'amy'));
select test_force($$insert into public.words (id, word, level) values (90001, 'apple', 1) on conflict do nothing$$);
select test_force(format($$insert into public.answer_events (student_id, word_id, skill, correct, game_id, at)
  values (%L, 90001, 'recognize', true, 'tower', now() - interval '1 hour')$$, :'amy'));
select test_force(format($$insert into public.answer_events (student_id, word_id, skill, correct, game_id, at)
  select %L, 90001, 'recognize', g %% 3 = 0, 'tower', now() - interval '10 days' from generate_series(1, 30) g$$, :'bob'));
set role authenticated;

select test_as('d0000000-0000-0000-0000-000000000001', false, 't2a@parktest.local');
select public.park_class_overview(:'c1') as ov1 \gset
select test_ok(jsonb_array_length((:'ov1')::jsonb -> 'students') = 2, '陳老師的班：艾咪、小貓兩個人');
select test_ok(((:'ov1')::jsonb -> 'games' -> 0 ->> 'code') = 'guardian', '有一欄守護異世界');
select test_ok(((:'ov1')::jsonb -> 'games' -> 0 -> 'rows' -> :'amy' ->> 'progress')::int = 50, '艾咪過了 4 關中的 2 關：50%');
select test_ok(((:'ov1')::jsonb -> 'games' -> 0 -> 'rows' -> :'amy' ->> 'status') like '%哥布林森林%', '狀態寫出最遠過到哪一關');
select test_ok(not ((:'ov1')::jsonb -> 'games' -> 0 -> 'rows' -> :'amy' ->> 'attention')::boolean, '艾咪剛玩過，不用注意');
select test_ok(((:'ov1')::jsonb -> 'games' -> 0 -> 'rows' -> :'cat' ->> 'reason') = '還沒玩過', '小貓還沒玩過，標出來');

select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select public.park_class_overview(:'c2') as ov2 \gset
select test_ok(jsonb_array_length((:'ov2')::jsonb -> 'students') = 2, '李老師的英文班：阿寶（主要）＋艾咪（另外加入）');
select test_ok(((:'ov2')::jsonb -> 'games' -> 0 -> 'rows' -> :'amy' ->> 'progress')::int = 50,
               '科任老師也看得到非主要班級學生的英文進度');
select test_ok(((:'ov2')::jsonb -> 'games' -> 0 -> 'rows' -> :'bob' ->> 'reason') like '%天沒玩了', '阿寶 10 天沒玩，標出來');
select test_ok((select bool_or(not (s ->> 'primary')::boolean) from jsonb_array_elements((:'ov2')::jsonb -> 'students') s),
               '名單分得出誰是另外加入的');
select test_ok((select count(*) from public.guardian_class_summary(:'c1')) = 0, '直接叫摘要函式看別人的班：一個人都拿不到');

\echo '── 一個遊戲的摘要壞掉不影響其他'
reset role;
insert into public.park_facilities (code, zone, name, status, summary_fn) values
  ('t2_broken', 'castle', '壞掉的遊戲', 'open', 'broken_class_summary') on conflict do nothing;
insert into public.park_class_facilities values (:'c2', 't2_broken');
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select public.park_class_overview(:'c2') as ov3 \gset
select test_ok((select g ->> 'error' from jsonb_array_elements((:'ov3')::jsonb -> 'games') g where g ->> 'code' = 't2_broken')
               like '%還沒裝到資料庫%', '沒裝摘要函式的遊戲顯示原因');
select test_ok((select (g -> 'rows') ? :'amy' from jsonb_array_elements((:'ov3')::jsonb -> 'games') g where g ->> 'code' = 'guardian'),
               '守護異世界那欄照常');
reset role;
delete from public.park_facilities where code = 't2_broken';
set role authenticated;

\echo '── 重設密碼（任何一班的老師都可以）'
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
reset role;
select test_force(format($$update public.students set failed_attempts = 5, locked_until = now() + interval '10 minutes' where id = %L$$, :'amy'));
set role authenticated;
select public.park_reset_password(:'amy', 'mn34kl');
select test_ok((select count(*) from public.park_audit where action = 'reset_password') = 0,
               '一般老師讀不到操作紀錄表');
select test_denied(format('select public.park_reset_password(%L, %L)', :'cat', 'mn34kl'), '李老師重設不是他班上的小貓');
select test_denied(format('select public.park_reset_password(%L, %L)', :'amy', '123456'), '連號密碼照樣擋');
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok((select error from public.login_student('t2_amy', 'mn34kl')) is null, '艾咪用新密碼登得進去（也解鎖了）');
select test_denied(format('select public.park_reset_password(%L, %L)', :'bob', 'mn34kl'), '學生重設別人的密碼');

\echo '── 改暱稱'
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select test_ok(public.park_set_student_nickname(:'amy', '艾咪咪') = '艾咪咪', '科任老師幫艾咪改暱稱');
select test_as('d0000000-0000-0000-0000-000000000001', false, 't2a@parktest.local');
select test_denied(format('select public.park_set_student_nickname(%L, %L)', :'cat', '艾咪咪'),
                   '小貓的主要班級裡已經有艾咪咪');

\echo '── 移出班級（只移出，不刪帳號）'
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select public.park_remove_from_class(:'c2', :'amy');
select test_ok(test_members('t2_amy') = :'c1', '艾咪移出英文班，導師班還在');
select test_ok(test_one(format('select class_code from public.students where id = %L', :'amy')) = :'c1', '主要班級不變');
select test_denied(format('select public.park_remove_from_class(%L, %L)', :'c2', :'amy'), '已經不在這班');
select test_denied(format('select public.park_remove_from_class(%L, %L)', :'c1', :'cat'), '移出別人班的學生');
-- 艾咪再加回英文班，然後導師把她移出主要班級 → 英文班升成主要班級
select test_as('d0000000-0000-0000-0000-000000000011', true);
select public.park_join_class(:'c2');
select test_as('d0000000-0000-0000-0000-000000000001', false, 't2a@parktest.local');
select public.park_remove_from_class(:'c1', :'amy');
select test_ok(test_members('t2_amy') = :'c2', '移出主要班級後只剩英文班');
select test_ok(test_one(format('select class_code from public.students where id = %L', :'amy')) = :'c2',
               '英文班升成主要班級（守護異世界排行榜跟著換）');
select test_ok(test_one(format('select count(*) from public.students where id = %L', :'amy')) = '1', '帳號還在');
select public.park_remove_from_class(:'c1', :'cat');
select test_ok(test_one(format('select coalesce(class_code, ''無'') from public.students where id = %L', :'cat')) = '無',
               '小貓沒有別的班：變成沒有班級，帳號還在');

\echo '── 管理員'
select test_ok((select count(*) from public.park_admin_facilities()) = 0, '一般老師叫管理員函式拿到空的');
select test_denied($$select public.park_admin_set_facility('guardian', 'maintenance', 3, 6)$$, '一般老師改設施狀態');
select test_as('d0000000-0000-0000-0000-000000000004', false, 't2admin@parktest.local');
select test_ok((select count(*) from public.park_admin_facilities()) >= 3, '管理員看得到所有設施');
select public.park_admin_set_facility('guardian', 'maintenance', 3, 6);
select test_as('d0000000-0000-0000-0000-000000000012', true);
select test_ok(public.park_can_enter('guardian') ->> 'reason' like '%維修%', '改成維修中，學生馬上進不去');
select test_as('d0000000-0000-0000-0000-000000000004', false, 't2admin@parktest.local');
select public.park_admin_set_facility('island_pioneer', 'trial', null, null, array[:'c2']);
select test_ok((select trials from public.park_admin_facilities() where code = 'island_pioneer') = array[:'c2'], '設定試玩班');
select test_as('d0000000-0000-0000-0000-000000000012', true);
select test_ok((public.park_can_enter('island_pioneer') ->> 'ok')::boolean, '試玩班的阿寶進得去試營運');
select test_as('d0000000-0000-0000-0000-000000000013', true);
select test_ok(not (public.park_can_enter('island_pioneer') ->> 'ok')::boolean, '不在試玩班的小貓進不去');
select test_as('d0000000-0000-0000-0000-000000000004', false, 't2admin@parktest.local');
select public.park_admin_set_facility('guardian', 'open', 3, 6);
select public.park_admin_set_facility('island_pioneer', 'construction', null, null, '{}');
select test_denied($$select public.park_admin_set_facility('guardian', 'party', 3, 6)$$, '亂填狀態');
select test_denied($$select public.park_admin_set_facility('guardian', 'open', 6, 3)$$, '年級起點比終點大');
select test_ok((select count(*) from public.park_admin_classes() where code = :'c2' and members = 2) = 1,
               '所有班級：英文班 2 人（含另外加入的）');
select test_ok((select count(*) from public.park_admin_audit(50) where action = 'set_facility') = 4, '設施變更有紀錄');
select test_ok((select count(*) from public.park_admin_audit(50) where action = 'reset_password' and actor_name = '李老師') = 1,
               '重設密碼有紀錄，看得到是誰做的');
select test_ok((select count(*) from public.park_audit) > 0, '管理員讀得到操作紀錄表');
select test_ok((public.park_can_enter('island_pioneer') ->> 'ok')::boolean, '管理員進得去施工中的設施');

\echo '── 直接寫表一律擋掉'
select test_as('d0000000-0000-0000-0000-000000000001', false, 't2a@parktest.local');
select test_denied(format('insert into public.park_class_facilities values (%L, %L)', :'c1', 'island_pioneer'), '老師直接寫開放設施表');
select test_denied($$update public.park_facilities set status = 'open'$$, '老師直接改設施表');
select test_denied($$insert into public.park_audit (action) values ('fake')$$, '老師直接寫操作紀錄');
select test_denied($$select public.park_log('fake', null, null)$$, '內部記錄函式叫不動');
select test_denied($$select public.park_teaches_student(null)$$, '內部小幫手叫不動');

\echo '── 全部通過'
