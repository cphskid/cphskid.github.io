-- 樂園公告的實測。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：前面的測試都跑完（沿用 test_ok / test_denied / test_as 和管理員 d…04），再跑過 park_news.sql。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
insert into auth.users (id, email) values
  ('e5000000-0000-0000-0000-000000000001', 'news-t@parktest.local'),
  ('e5000000-0000-0000-0000-000000000002', 'news-other@parktest.local'),
  ('e5000000-0000-0000-0000-000000000011', null),
  ('e5000000-0000-0000-0000-000000000012', null);
insert into public.teachers (user_id, display_name) values
  ('e5000000-0000-0000-0000-000000000001', '王老師'), ('e5000000-0000-0000-0000-000000000002', '別班老師');
insert into public.classes (code, name, owner) values
  ('NEWS1', '五年三班', 'e5000000-0000-0000-0000-000000000001'),
  ('NEWS2', '別班', 'e5000000-0000-0000-0000-000000000002');
insert into public.students (id, login_id, pw_hash, nickname, class_code) values
  ('e5100000-0000-0000-0000-000000000011', 'news_a', 'x', '小信', 'NEWS1'),
  ('e5100000-0000-0000-0000-000000000012', 'news_b', 'x', '小鴿', 'NEWS2');
insert into public.park_class_members (class_code, student_id) values
  ('NEWS1', 'e5100000-0000-0000-0000-000000000011'), ('NEWS2', 'e5100000-0000-0000-0000-000000000012')
on conflict do nothing;
insert into public.student_links (user_id, student_id) values
  ('e5000000-0000-0000-0000-000000000011', 'e5100000-0000-0000-0000-000000000011'),
  ('e5000000-0000-0000-0000-000000000012', 'e5100000-0000-0000-0000-000000000012');
insert into public.park_zones (code, name) values ('taiwan', '臺灣島') on conflict do nothing;

set role authenticated;

\echo '── 管理員：四種都能發'
select test_as('d0000000-0000-0000-0000-000000000004', false, 't2admin@parktest.local');
select public.park_news_post(array['board','flag','balloon','letter'], '萬聖節限定開張囉！', '南瓜騎士到貨了', current_date + 7,
  '萬聖節開跑！', 'shop-month', array['taiwan']) as big \gset
select test_ok(:'big' is not null, '全站四種一起發');
select test_denied($$select public.park_news_post(array['flag'], '沒選島', '', current_date + 3)$$, '布條沒選島不行');
select test_denied($$select public.park_news_post(array['flag'], '亂選島', '', current_date + 3, null, null, array['moon'])$$, '沒有的島不行');
select test_denied($$select public.park_news_post(array['board'], '太久', '', current_date + 200)$$, '最長 120 天');
select test_denied($$select public.park_news_post(array['spam'], '亂來', '', current_date + 3)$$, '沒有的方式不行');
select public.park_news_post(array['board'], '過期的', '', current_date - 1, null, null, '{}', null, null, false, current_date - 5) as old \gset

\echo '── 老師：只能寄信給自己的班'
select test_as('e5000000-0000-0000-0000-000000000001', false, 'news-t@parktest.local');
select public.park_news_post(array['letter'], '第 5 關提前開放囉！', '這週先開給大家', current_date + 5,
  null, 'zone:castle', '{}', array['NEWS1'], '王老師', true) as letter \gset
select test_ok(:'letter' is not null, '寄信給自己班');
select test_denied($$select public.park_news_post(array['board'], '貼布告欄', '', current_date + 3, null, null, '{}', array['NEWS1'])$$, '老師不能貼布告欄');
select test_denied($$select public.park_news_post(array['letter','balloon'], '加熱氣球', '', current_date + 3, null, null, '{}', array['NEWS1'])$$, '老師不能放熱氣球');
select test_denied($$select public.park_news_post(array['letter'], '全站', '', current_date + 3)$$, '老師不能寄全站');
select test_denied($$select public.park_news_post(array['letter'], '別班', '', current_date + 3, null, null, '{}', array['NEWS2'])$$, '老師不能寄別班');
select test_ok(jsonb_array_length(public.park_news_list()) = 1, '老師後台只看到自己寄的');

\echo '── 學生：看到該看的'
select test_as('e5000000-0000-0000-0000-000000000011', true);
select test_ok((select count(*) from jsonb_array_elements(public.park_news_mine()) x where (x->>'active')::boolean) = 2, '本班學生：全站公告＋老師的信');
select test_ok((select count(*) from jsonb_array_elements(public.park_news_mine()) x where not (x->>'active')::boolean) = 1, '過期的也回（信箱、以前的公告）');
select test_ok(public.park_news_seen(:'letter', array['letter']), '看過信');
select test_ok(public.park_news_seen(:'big', array['board','flag']), '看過布告欄和布條');
select test_ok(public.park_news_seen(:'big', array['board','balloon','nope']), '再看一次（亂寫的 part 丟掉）');
select test_ok((select x->'seen' from jsonb_array_elements(public.park_news_mine()) x where (x->>'id')::bigint = :'big') @> '["board","flag","balloon"]'::jsonb, '看過的合在一起記');
select test_denied($$select * from public.park_news$$, '學生不能直接讀表');
select test_denied($$select public.park_news_post(array['letter'], '我也要', '', current_date + 3)$$, '學生不能發');
select test_denied($$select public.park_news_list()$$, '學生不能看後台列表');

select test_as('e5000000-0000-0000-0000-000000000012', true);
select test_ok((select count(*) from jsonb_array_elements(public.park_news_mine()) x where (x->>'active')::boolean) = 1, '別班學生收不到那封信');

\echo '── 沒登入：只有全站布告欄'
select set_config('test.uid', '', false);
select test_ok(jsonb_array_length(public.park_news_mine()) = 1, '沒登入只看到全站、沒過期、有布告欄的');

\echo '── 撤回'
select test_as('e5000000-0000-0000-0000-000000000002', false, 'news-other@parktest.local');
select test_ok(not public.park_news_hide(:'letter'), '別的老師不能撤回');
select test_as('e5000000-0000-0000-0000-000000000001', false, 'news-t@parktest.local');
select test_ok(public.park_news_hide(:'letter'), '寄的人可以撤回');
select test_as('e5000000-0000-0000-0000-000000000011', true);
select test_ok((select count(*) from jsonb_array_elements(public.park_news_mine()) x where (x->>'id')::bigint = :'letter') = 0, '撤回的學生就看不到');
select test_as('d0000000-0000-0000-0000-000000000004', false, 't2admin@parktest.local');
select test_ok((select (x->>'seen')::int from jsonb_array_elements(public.park_news_list()) x where (x->>'id')::bigint = :'big') = 1, '管理員看得到幾個人看過');
reset role;
