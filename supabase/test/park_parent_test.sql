-- 爸媽任務與監護人的實測。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：前面的測試都跑完（沿用 test_ok / test_denied / test_as），再跑過 park_parent.sql。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
insert into auth.users (id, email) values
  ('e6000000-0000-0000-0000-000000000001', 'mom@parktest.local'),
  ('e6000000-0000-0000-0000-000000000002', 'dad@parktest.local'),
  ('e6000000-0000-0000-0000-000000000003', 'aunt@parktest.local'),
  ('e6000000-0000-0000-0000-000000000004', 'school@parktest.local'),
  ('e6000000-0000-0000-0000-000000000011', null),
  ('e6000000-0000-0000-0000-000000000012', null);
insert into public.teachers (user_id, display_name) values
  ('e6000000-0000-0000-0000-000000000001', '小安媽媽'), ('e6000000-0000-0000-0000-000000000002', '小安爸爸'),
  ('e6000000-0000-0000-0000-000000000003', '阿姨'), ('e6000000-0000-0000-0000-000000000004', '林老師');
insert into public.classes (code, name, owner) values ('PAR1', '五年一班', 'e6000000-0000-0000-0000-000000000004');
insert into public.park_class_settings (class_code, grade, kind) values ('PAR1', 5, 'school') on conflict do nothing;
insert into public.students (id, login_id, pw_hash, nickname, class_code) values
  ('e6100000-0000-0000-0000-000000000011', 'par_a', 'x', '小安', 'PAR1');
insert into public.park_class_members (class_code, student_id) values ('PAR1', 'e6100000-0000-0000-0000-000000000011') on conflict do nothing;
insert into public.student_links (user_id, student_id) values
  ('e6000000-0000-0000-0000-000000000011', 'e6100000-0000-0000-0000-000000000011');

set role authenticated;

\echo '── 孩子先玩：拿家長碼'
select test_as('e6000000-0000-0000-0000-000000000011', true);
select public.park_parent_code() ->> 'code' as code \gset
select test_ok(length(:'code') = 6, '拿到 6 碼家長碼');
select test_ok(public.park_parent_code() ->> 'code' = :'code', '還沒用過就沿用同一組');
select test_ok(not (public.park_parent_me() ->> 'linked')::boolean, '還沒連起來');
select test_denied($$select public.park_parent_redeem('ABCDEF')$$, '孩子不能自己兌換');
select test_denied($$select * from public.park_guardians$$, '不能直接讀監護人表');

\echo '── 媽媽兌換家長碼'
select test_as('e6000000-0000-0000-0000-000000000001', false, 'mom@parktest.local');
select test_denied($$select public.park_parent_redeem('ZZZZZZ')$$, '亂打的碼不行');
select public.park_parent_redeem(:'code') ->> 'home' as home \gset
select test_ok((select s.kind from public.park_class_settings s where s.class_code = :'home') = 'home', '自動開家庭班');
select test_ok(public.is_teacher_of(:'home'), '媽媽是家庭班的開班者');
select test_ok(public.park_parent_redeem(:'code') ->> 'home' = :'home', '同一個人再兌一次沒關係');
select test_ok(jsonb_array_length(public.park_parent_kids()) = 1, '孩子在等你：1 個孩子');
select test_denied($$select public.park_parent_goal('e6100000-0000-0000-0000-000000000011', 'fly')$$, '沒有的目標不行');
select public.park_parent_goal('e6100000-0000-0000-0000-000000000011', 'days3');
select test_denied($$select public.park_parent_goal('e6100000-0000-0000-0000-000000000011', 'min60')$$, '一週只能訂一次目標');
select public.park_parent_view('e6100000-0000-0000-0000-000000000011');
select public.park_parent_sticker('e6100000-0000-0000-0000-000000000011', 'great');
select test_denied($$select public.park_parent_sticker('e6100000-0000-0000-0000-000000000011', 'bad')$$, '沒有的貼紙不行');
select public.park_parent_sticker('e6100000-0000-0000-0000-000000000011', 'love');
select public.park_parent_sticker('e6100000-0000-0000-0000-000000000011', 'cheer');
select test_denied($$select public.park_parent_sticker('e6100000-0000-0000-0000-000000000011', 'play')$$, '一天最多 3 張');
select public.park_parent_sign('e6100000-0000-0000-0000-000000000011');
select test_denied($$select public.park_parent_sign('e6100000-0000-0000-0000-000000000011')$$, '一週簽一次');

\echo '── 別人不行'
select test_as('e6000000-0000-0000-0000-000000000004', false, 'school@parktest.local');
select test_denied($$select public.park_parent_sticker('e6100000-0000-0000-0000-000000000011', 'great')$$, '學校老師不是監護人，不能送貼紙');
select public.park_parent_view('e6100000-0000-0000-0000-000000000011');
select test_ok(jsonb_array_length(public.park_parent_kids()) = 0, '學校老師沒有自己的孩子');
select test_denied($$select public.park_parent_redeem('$$ || :'code' || $$')$$, '用過的碼別人不能再用');

\echo '── 孩子領獎'
select test_as('e6000000-0000-0000-0000-000000000011', true);
select public.park_parent_me() as me \gset
select test_ok((:'me'::jsonb ->> 'linked')::boolean, '連起來了');
select test_ok(jsonb_array_length(:'me'::jsonb -> 'fresh') = 4, '一次跳出：神秘蛋、看過冒險、貼紙傢俱、聯絡簿');
select test_ok((select count(*) from public.park_pets p where p.student_id = 'e6100000-0000-0000-0000-000000000011') = 1, '神秘蛋孵出一隻夥伴');
select test_ok((select count(*) from public.park_student_furniture f where f.student_id = 'e6100000-0000-0000-0000-000000000011' and f.item = 'family-bench') = 1, '拿到親子長椅');
select test_ok((public.park_coins_me() ->> 'balance')::int = 130, '看過冒險 100＋聯絡簿 30');
select test_ok(jsonb_array_length(:'me'::jsonb -> 'stickers') = 3, '看得到 3 張貼紙');
select test_ok(jsonb_array_length(public.park_parent_me() -> 'fresh') = 0, '再打開不會重發');
select test_ok(not (public.park_parent_me() -> 'goal' ->> 'met')::boolean, '本週目標還沒達成');

\echo '── 達成目標'
reset role;
insert into public.park_play_log (student_id, facility, place, started_at, last_seen)
select 'e6100000-0000-0000-0000-000000000011', 'guardian', 'enter', d, d + interval '20 minutes'
  from (values (public.park_week_start() + interval '1 hour'), (public.park_week_start() + interval '1 day 1 hour'),
               (public.park_week_start() + interval '2 days 1 hour')) v(d)
 where d <= now();
select (now() >= public.park_week_start() + interval '2 days 1 hour') as late \gset
set role authenticated;
select test_as('e6000000-0000-0000-0000-000000000011', true);
select case when :'late'::boolean
  then test_ok((public.park_parent_me() -> 'goal' ->> 'met')::boolean, '來玩 3 天，目標達成')
  else test_ok(true, '（今天是週一或週二，跳過目標達成）') end;

\echo '── 爸媽幫孩子開帳號'
select test_as('e6000000-0000-0000-0000-000000000002', false, 'dad@parktest.local');
select test_denied($$select public.park_parent_create_child('x', 'abc12345', '小寶')$$, '帳號太短不行');
select public.park_parent_create_child('par_baby', 'abc12345', '小寶') ->> 'student' as baby \gset
select test_ok((select s.class_code from public.students s where s.id = :'baby') is not null, '孩子開在家庭班');
select test_ok(jsonb_array_length(public.park_parent_kids()) = 1, '爸爸看到自己開的孩子');
select test_denied($$select public.park_parent_create_child('par_baby', 'abc12345', '小寶二')$$, '帳號重複不行');

\echo '── 一個孩子最多 2 位監護人'
select test_as('e6000000-0000-0000-0000-000000000011', true);
reset role;
update public.park_parent_codes set used_at = now() where student_id = 'e6100000-0000-0000-0000-000000000011';
set role authenticated;
select public.park_parent_code() ->> 'code' as code2 \gset
select test_as('e6000000-0000-0000-0000-000000000002', false, 'dad@parktest.local');
select test_ok(public.park_parent_redeem(:'code2') is not null, '爸爸也連上（第 2 位）');
select test_ok(jsonb_array_length(public.park_parent_kids()) = 2, '爸爸有 2 個孩子');
select test_as('e6000000-0000-0000-0000-000000000011', true);
reset role;
update public.park_parent_codes set used_at = now() where student_id = 'e6100000-0000-0000-0000-000000000011';
set role authenticated;
select public.park_parent_code() ->> 'code' as code3 \gset
select test_as('e6000000-0000-0000-0000-000000000003', false, 'aunt@parktest.local');
select test_denied($$select public.park_parent_redeem('$$ || :'code3' || $$')$$, '第 3 位不行');
reset role;
