-- 遊玩紀錄的實測。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：前面的測試都跑完（沿用 test_ok / test_denied / test_as / test_one 和管理員 d…04），再跑過 park_playlog.sql。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-000000000001', 'play-t@parktest.local'),
  ('f0000000-0000-0000-0000-000000000002', 'play-other@parktest.local'),
  ('f0000000-0000-0000-0000-000000000011', null),
  ('f0000000-0000-0000-0000-000000000012', null);
insert into public.teachers (user_id, display_name) values
  ('f0000000-0000-0000-0000-000000000001', '遊玩老師'), ('f0000000-0000-0000-0000-000000000002', '別班老師');
insert into public.classes (code, name, owner) values
  ('PLAY1', '遊玩班', 'f0000000-0000-0000-0000-000000000001'),
  ('PLAY2', '別班', 'f0000000-0000-0000-0000-000000000002');
insert into public.students (id, login_id, pw_hash, nickname, class_code) values
  ('f1000000-0000-0000-0000-000000000011', 'play_a', 'x', '小遊', 'PLAY1'),
  ('f1000000-0000-0000-0000-000000000012', 'play_b', 'x', '小戲', 'PLAY2');
insert into public.park_class_members (class_code, student_id) values
  ('PLAY1', 'f1000000-0000-0000-0000-000000000011'), ('PLAY2', 'f1000000-0000-0000-0000-000000000012')
on conflict do nothing;
insert into public.student_links (user_id, student_id) values
  ('f0000000-0000-0000-0000-000000000011', 'f1000000-0000-0000-0000-000000000011'),
  ('f0000000-0000-0000-0000-000000000012', 'f1000000-0000-0000-0000-000000000012');
insert into public.words (id, word, zh, pos, theme, level) select 99001, 'apple', '蘋果', 'n', 'food', 1 where not exists (select 1 from public.words) on conflict do nothing;
-- 守護異世界的舊資料：一場塔防 3 題（答對 2 題）、10 分鐘
insert into public.answer_events (student_id, word_id, skill, correct, ms, combo, game_id, level_id, at, session_id, ord)
select 'f1000000-0000-0000-0000-000000000011', w.id, 'listen', x.ok, 1000, 0, 'tower-defense', 't2-2',
       now() - interval '1 hour' + x.m * interval '5 minutes', 'f2000000-0000-0000-0000-000000000001', x.m
  from (values (0, true), (1, false), (2, true)) x(m, ok), (select min(id) id from public.words) w;

set role authenticated;

\echo '── 學生：進場、心跳、換地方'
select test_as('f0000000-0000-0000-0000-000000000011', true);
select public.park_play_start('island_pioneer', 'ch3', '第三章 大航海時代') as a \gset
select test_ok(:'a' is not null, '進場拿到編號');
select test_ok(public.park_play_beat(:'a'), '心跳成功');
select test_ok(public.park_play_start('island_pioneer', 'ch3') = :'a'::bigint, '剛離開又回到同一個地方：接著用同一筆');
select public.park_play_start('island_pioneer', 'map') as b \gset
select test_ok(:'b'::bigint <> :'a'::bigint, '換地方是新的一筆');
select test_ok(not public.park_play_beat(:'a'), '舊的那筆已經收尾，心跳不會把它復活');
select test_ok(public.park_play_beat(:'b', true), '離開');
select test_ok(not public.park_play_beat(:'b'), '離開後不能再心跳');
select test_ok(public.park_play_start('moon_base', 'x') is null, '沒有的遊戲不記');
select test_ok(public.park_play_start('park', 'gate', '樂園大廳') is not null, '樂園大廳可以記');
select test_denied($$select * from public.park_play_log$$, '學生不能直接讀表');
select test_denied($$select * from public.park_student_activity('f1000000-0000-0000-0000-000000000011')$$, '學生不能看時間軸');

\echo '── 別人的編號不能心跳'
select test_as('f0000000-0000-0000-0000-000000000012', true);
select test_ok(not public.park_play_beat(:'a'), '別人的那筆動不了');
select test_ok(public.park_play_start('guardian', 'enter', '守護異世界') is not null, '別班學生進守護異世界');

\echo '── 老師：時間軸、最後在玩'
reset role;
update public.park_play_log set started_at = started_at - interval '20 minutes' where id = :'a';
set role authenticated;
select test_as('f0000000-0000-0000-0000-000000000001', false, 'play-t@parktest.local');
select test_ok((select count(*) from public.park_student_activity('f1000000-0000-0000-0000-000000000011')) = 4,
  '時間軸 4 筆：島嶼兩趟、樂園大廳、守護異世界舊的那一場');
select test_ok((select seconds from public.park_student_activity('f1000000-0000-0000-0000-000000000011')
                 where place = 'ch3') >= 1200, '第三章那趟算到 20 分鐘');
select test_ok((select label || '|' || note || '|' || seconds from public.park_student_activity('f1000000-0000-0000-0000-000000000011')
                 where kind = 'level') = '塔防 第 9002 關「哥布林森林」|3 題，答對 67%|600', '守護異世界的舊資料變成一場');
select test_ok((select game from public.park_class_last_play('PLAY1')) = '樂園大廳', '最後在玩：樂園大廳');
select test_denied($$select * from public.park_student_activity('f1000000-0000-0000-0000-000000000012')$$, '別班學生的時間軸看不到');
select test_denied($$select * from public.park_class_last_play('PLAY2')$$, '別班的最後在玩看不到');
select test_denied($$select public.park_admin_activity(7)$$, '老師不能看全站動態');
reset role;
select test_ok((select last_active from public.park_class_last_active('PLAY1')) > now() - interval '1 minute', '最後活動時間也算遊玩紀錄');
set role authenticated;

\echo '── 管理員：全站動態'
select test_as('d0000000-0000-0000-0000-000000000004', false, 't2admin@parktest.local');
select public.park_admin_activity(7) as s \gset
select test_ok((:'s'::jsonb ->> 'players')::int >= 2, '這 7 天至少兩個人來玩');
select test_ok(jsonb_array_length(:'s'::jsonb -> 'daily') = 7, '每天一格，7 格');
select test_ok((select bool_or(x ->> 'game' = '守護異世界') from jsonb_array_elements(:'s'::jsonb -> 'games') x), '各遊戲有守護異世界');
select test_ok((select bool_or(x ->> 'label' = '第三章 大航海時代') from jsonb_array_elements(:'s'::jsonb -> 'top') x), '熱門有第三章');
select test_ok((select bool_or(x ->> 'label' = '大地圖') from jsonb_array_elements(:'s'::jsonb -> 'top') x) is not true, '熱門不算大地圖');
select test_ok(jsonb_array_length(:'s'::jsonb -> 'recent') >= 4, '最近動態有東西');
select test_ok(:'s'::jsonb ->> 'log_since' is not null, '知道從哪天開始記錄');
select test_ok((select count(*) from public.park_student_activity('f1000000-0000-0000-0000-000000000012')) >= 1, '管理員每班都看得到');
reset role;
