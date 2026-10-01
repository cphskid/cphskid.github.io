-- 樂園 P1 帳號與多班級的權限實測。只在本機跑（tools/test/db.sh），不要貼進 Supabase。
-- 前提：已經跑過守護異世界的 00_supabase_stub.sql、schema.sql，以及 park_accounts.sql。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function test_ok(p_cond boolean, p_what text) returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice '  ✓ %', p_what;
  else raise exception '✗ 這一條不成立：%', p_what; end if;
end $$;

-- 注意：「應該被擋卻成功」的那個 raise 不能放在有 exception 的同一個區塊裡，
-- 不然它自己會被自己的 when raise_exception 接住，變成永遠通過。
create or replace function test_denied(p_sql text, p_what text) returns void
language plpgsql as $$
declare v_ok boolean := false;
begin
  begin
    execute p_sql;
  exception
    when insufficient_privilege or raise_exception or check_violation or unique_violation then
      v_ok := true;
  end;
  if not v_ok then raise exception '✗ 這個動作應該被擋掉卻成功了：%', p_what; end if;
  raise notice '  ✓ 擋下來了：%', p_what;
end $$;

create or replace function test_as(p_uid text, p_anon boolean, p_email text default null) returns void
language plpgsql as $$
begin
  perform set_config('test.uid', p_uid, false);
  perform set_config('test.jwt', json_build_object('is_anonymous', p_anon, 'email', p_email)::text, false);
end $$;

create or replace function test_force(p_sql text) returns void
language plpgsql security definer as $$ begin execute p_sql; end $$;

create or replace function test_members(p_login text) returns text
language sql security definer as $$
  select coalesce(string_agg(m.class_code, ',' order by m.class_code), '')
    from public.park_class_members m join public.students s on s.id = m.student_id
   where s.login_id = p_login;
$$;

grant execute on function test_ok(boolean, text), test_denied(text, text),
  test_as(text, boolean, text), test_members(text) to authenticated;

-- 一個「P1 之前就存在」的學生：直接寫進 students，模擬正式庫已經有的人
-- （真的上線時觸發器還不存在，所以先關掉觸發器寫入，再跑一次 park_accounts.sql 的轉移）
insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-000000000001', 'parkt1@parktest.local'),
  ('b0000000-0000-0000-0000-000000000002', 'parkt2@parktest.local'),
  ('b0000000-0000-0000-0000-000000000003', 'parkmom@parktest.local'),
  ('b0000000-0000-0000-0000-000000000011', null),
  ('b0000000-0000-0000-0000-000000000012', null),
  ('b0000000-0000-0000-0000-000000000013', null),
  ('b0000000-0000-0000-0000-000000000014', null);
insert into public.teachers (user_id, display_name) values
  ('b0000000-0000-0000-0000-000000000001', '王老師'),
  ('b0000000-0000-0000-0000-000000000002', '英文林老師'),
  ('b0000000-0000-0000-0000-000000000003', '小明媽媽');
update public.teachers set max_students = 2 where user_id = 'b0000000-0000-0000-0000-000000000003';
insert into public.classes (code, name, owner) values
  ('PK1', '五年一班', 'b0000000-0000-0000-0000-000000000001'),
  ('PK2', '英文科任', 'b0000000-0000-0000-0000-000000000002'),
  ('PK3', '家庭班',   'b0000000-0000-0000-0000-000000000003'),
  ('PK4', '關起來的班', 'b0000000-0000-0000-0000-000000000002');
update public.classes set open = false where code = 'PK4';

alter table public.students disable trigger park_sync_primary_member;
insert into public.students (id, login_id, pw_hash, nickname, class_code) values
  ('c0000000-0000-0000-0000-000000000001', 'pk_old', extensions.crypt('ab12cd', extensions.gen_salt('bf')), '老學生', 'PK1');
alter table public.students enable trigger park_sync_primary_member;

\echo '── 現有學生轉移'
select test_ok(test_members('pk_old') = '', '轉移前：老學生還沒有成員紀錄');
\i supabase/park_accounts.sql
select test_ok(test_members('pk_old') = 'PK1', '跑過 park_accounts.sql：老學生自動補上主要班級');
\i supabase/park_accounts.sql
select test_ok(test_members('pk_old') = 'PK1', '重複執行不會重複加');

set role authenticated;

\echo '── 註冊（沿用守護異世界的 register_student）'
select test_as('b0000000-0000-0000-0000-000000000011', true);
select test_ok(public.park_me() ->> 'kind' = 'guest', '剛開的平板：park_me 是訪客');
select student_id is not null from public.register_student('pk_ming', 'qw78er', '小明', 'pk1');
select test_ok(test_members('pk_ming') = 'PK1', '註冊時填的班自動成為成員（觸發器）');
select test_ok(public.park_me() ->> 'kind' = 'student', 'park_me 認得是學生');
select test_ok(public.park_me() ->> 'nickname' = '小明', 'park_me 帶回暱稱');
select test_ok(public.park_me() ->> 'primary_class' = 'PK1', 'park_me 帶回主要班級');
select test_ok(jsonb_array_length(public.park_me() -> 'classes') = 1, 'park_me 的班級清單有一班');
select test_ok(public.park_me() -> 'classes' -> 0 ->> 'owner_name' = '王老師', '班級清單帶開班人稱呼');

\echo '── 多班級'
select test_ok((public.park_join_class('pk2') ->> 'primary')::boolean = false, '加入英文科任班，不是主要班級');
select test_ok(test_members('pk_ming') = 'PK1,PK2', '成員紀錄有兩班');
select test_ok(public.park_me() ->> 'primary_class' = 'PK1', '主要班級沒變（守護異世界排行榜照舊）');
select test_ok(public.park_me() -> 'classes' -> 0 ->> 'code' = 'PK1', '清單第一個是主要班級');
select test_ok(public.park_me() -> 'classes' -> 1 ->> 'name' = '英文科任', '看得到另外加入的班的班名');
select test_denied($$select public.park_join_class('PK2')$$, '同一班加兩次');
select test_denied($$select public.park_join_class('PK4')$$, '加入關起來的班');
select test_denied($$select public.park_join_class('NOPE')$$, '亂打的代碼');
select test_denied($$select public.park_leave_class('PK1')$$, '自己退出主要班級');
select public.park_join_class('PK3');
select public.park_leave_class('PK3');
select test_ok(test_members('pk_ming') = 'PK1,PK2', '退出家庭班之後剩兩班');
select test_denied($$select public.park_leave_class('PK3')$$, '退出不在的班');

\echo '── 暱稱只在主要班級檢查'
select test_as('b0000000-0000-0000-0000-000000000012', true);
select student_id is not null from public.register_student('pk_hua', 'zx90cv', '小明', 'PK2');
select test_ok(test_members('pk_hua') = 'PK2', '英文科任班也可以有另一個「小明」當主要班級');
select test_denied($$select * from public.register_student('pk_dup', 'zx90cv', '小明', 'PK1')$$,
                   '主要班級裡暱稱重複照樣擋');

\echo '── 人數上限算所有成員'
select public.park_join_class('PK3');                      -- 家庭班：小華（第 1 人）
select test_as('b0000000-0000-0000-0000-000000000013', true);
select student_id is not null from public.register_student('pk_mei', 'as56df', '小美', 'PK1');
select public.park_join_class('PK3');                      -- 第 2 人，滿了
select test_as('b0000000-0000-0000-0000-000000000011', true);
select test_denied($$select public.park_join_class('PK3')$$, '家庭班上限 2 人，第 3 個進不去');

\echo '── 沒有主要班級的人：第一個加入的班就是主要班級'
reset role;
select test_force($$update public.students set class_code = null where login_id = 'pk_mei'$$);
select test_ok(test_members('pk_mei') = 'PK3', '主要班級拿掉後，只剩另外加入的家庭班');
set role authenticated;
select test_as('b0000000-0000-0000-0000-000000000013', true);
select test_ok(public.park_me() ->> 'primary_class' is null, '現在沒有主要班級');
select test_ok((public.park_join_class('PK2') ->> 'primary')::boolean, '再加入一班就成為主要班級');
select test_ok(public.park_me() ->> 'primary_class' = 'PK2', 'students.class_code 也跟著設好');

\echo '── 守護異世界換班＝搬家，另外加入的班不受影響'
select test_as('b0000000-0000-0000-0000-000000000011', true);
select test_denied($$select public.student_join_class('PK4')$$, '守護異世界換到關起來的班');
reset role;
select test_force($$update public.classes set open = true where code = 'PK4'$$);
set role authenticated;
select public.student_join_class('PK4');
select test_ok(test_members('pk_ming') = 'PK2,PK4', '主要班級 PK1→PK4，科任班 PK2 還在');
select test_ok(public.park_me() ->> 'primary_class' = 'PK4', '主要班級換成 PK4');

\echo '── 換班級代碼，成員紀錄跟著走'
select test_as('b0000000-0000-0000-0000-000000000002', false, 'parkt2@parktest.local');
select public.class_regenerate_code('PK2') as newcode \gset
select test_ok(test_members('pk_hua') like '%' || :'newcode' || '%' and test_members('pk_hua') not like '%PK2%', '小華（主要班級）跟著新代碼');
select test_ok(test_members('pk_ming') like '%' || :'newcode' || '%' and test_members('pk_ming') not like '%PK2%', '小明（另外加入）也跟著新代碼');

\echo '── 誰看得到成員表'
select test_as('b0000000-0000-0000-0000-000000000011', true);
select test_ok((select count(*) from public.park_class_members) = 2, '學生只看得到自己的兩筆');
select test_as('b0000000-0000-0000-0000-000000000001', false, 'parkt1@parktest.local');
select test_ok((select count(*) from public.park_class_members where class_code = 'PK1') = 1,
               '王老師看得到自己班（PK1 剩老學生）');
select test_ok((select count(*) from public.park_class_members where class_code <> 'PK1') = 0,
               '王老師看不到別人的班');
select test_ok(public.park_me() ->> 'kind' = 'staff', '老師登入：park_me 是開班帳號');
select test_ok(public.park_me() ->> 'display_name' = '王老師', '帶回稱呼');
select test_ok((public.park_me() ->> 'class_count')::int = 1, '帶回開了幾個班');
select test_denied($$select public.park_join_class('PK1')$$, '老師不能用學生的加入班級');

\echo '── 直接寫表一律擋掉'
select test_as('b0000000-0000-0000-0000-000000000011', true);
select test_denied($$insert into public.park_class_members values ('PK1', 'c0000000-0000-0000-0000-000000000001')$$,
                   '學生直接寫成員表');
select test_denied($$delete from public.park_class_members$$, '學生直接刪成員表');
select test_denied($$insert into public.park_class_settings (class_code) values ('PK1')$$, '學生直接寫班級設定');
select test_denied($$select public.park_class_full_problem('PK1')$$, '內部小幫手叫不動');

reset role;
set role anon;
select test_denied($$select public.park_me()$$, '沒登入（anon）叫不動 park_me');
select test_denied($$select * from public.park_class_members$$, 'anon 讀不到成員表');
reset role;

\echo '── 老師刪學生，成員紀錄一起清掉'
select test_force($$delete from public.students where login_id = 'pk_ming'$$);
select test_ok(test_members('pk_ming') = '', '刪掉的學生沒有殘留成員紀錄');

\echo '── 全部通過'
