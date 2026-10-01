-- =============================================================================
-- 時空冒險樂園 P2：教師入口（老師、家長、管理員的統一後台）
--
-- 一樣只「加表、加函式、加觸發器」，不改也不刪守護異世界的任何東西，
-- 英文正式站和它原本的老師後台照常可以用。
--
-- 怎麼套：Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。
-- 順序：守護異世界的 schema.sql → park_accounts.sql → 這份。
-- 守護異世界重跑 schema.sql 之後，park_accounts.sql 和這份都要再跑一次（它會收回權限）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 區域與設施
--    地圖上的位置與圖仍然在 data/park.json（美術的事），這裡管「會變的」：
--    狀態、適合年級、網址、摘要函式。管理員在後台改狀態，不用重新部署。
-- -----------------------------------------------------------------------------
create table if not exists public.park_zones (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text not null,
  subtitle    text not null default '',
  sort        int  not null default 0,
  status      text not null default 'open'
              check (status in ('open', 'trial', 'construction', 'maintenance', 'hidden')),
  description text not null default ''
);

create table if not exists public.park_facilities (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  zone        text not null references public.park_zones(code) on update cascade,
  name        text not null,
  subject     text,
  grade_min   smallint check (grade_min between 1 and 9),
  grade_max   smallint check (grade_max between 1 and 9),
  status      text not null default 'construction'
              check (status in ('open', 'trial', 'construction', 'maintenance', 'hidden')),
  url         text,                 -- 正式站網址
  url_dev     text,                 -- 測試站網址
  detail_url  text,                 -- 遊戲自己的老師細節頁（正式站）
  detail_url_dev text,              -- 同上（測試站）
  -- 全班摘要函式的名字，例如 guardian_class_summary。只有管理員改得到，
  -- 而且一定要符合 <前綴>_class_summary 的形狀（見 park_class_overview）。
  summary_fn  text check (summary_fn ~ '^[a-z][a-z0-9_]*_class_summary$'),
  description text not null default '',
  sort        int  not null default 0,
  updated_at  timestamptz not null default now(),
  check (grade_min is null or grade_max is null or grade_min <= grade_max)
);

-- 每個班開放哪些設施。
create table if not exists public.park_class_facilities (
  class_code text not null references public.classes(code) on delete cascade on update cascade,
  facility   text not null references public.park_facilities(code) on delete cascade on update cascade,
  primary key (class_code, facility)
);
create index if not exists park_class_facilities_fac on public.park_class_facilities(facility);

-- 試營運的設施可以給哪些班試玩。
create table if not exists public.park_trial_classes (
  facility   text not null references public.park_facilities(code) on delete cascade on update cascade,
  class_code text not null references public.classes(code) on delete cascade on update cascade,
  primary key (facility, class_code)
);

-- 操作紀錄：重設密碼、移出班級、改設施狀態……誰在什麼時候做了什麼。
create table if not exists public.park_audit (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_name text not null default '',
  action     text not null,
  class_code text,
  target     text,                  -- 學生暱稱（帳號）、設施代碼等，給人看的
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists park_audit_at on public.park_audit(at desc);

-- 初始資料。on conflict do nothing：重跑這份不會蓋掉管理員在後台改過的狀態。
insert into public.park_zones (code, name, subtitle, sort, status, description) values
  ('village', '樂園村莊', '樂園大廳', 1, 'open', '學生在這裡登入、加入班級、換頭像和蓋護照章。'),
  ('castle',  '守護異世界', '英文', 2, 'open', '用英文單字守護異世界的城堡。'),
  ('taiwan',  '穿越吧！島嶼開拓者', '社會', 3, 'open', '穿越回不同時代的台灣，從八堡圳開始，一步步開拓這座島。'),
  ('science', '科學戰士', '自然', 4, 'construction', '自然科的島還在蓋，完成後會在這裡開放。')
on conflict (code) do nothing;

insert into public.park_facilities
  (code, zone, name, subject, grade_min, grade_max, status, url, url_dev,
   detail_url, detail_url_dev, summary_fn, description, sort) values
  ('guardian', 'castle', '守護異世界', '英文', 3, 6, 'open',
   '/gaming_english_practice/', '/gaming_english_practice/dev/',
   '/gaming_english_practice/', '/gaming_english_practice/dev/',
   'guardian_class_summary', '用英文單字守護異世界的城堡，打倒怪物、收集寶石。', 1),
  ('island_pioneer', 'taiwan', '穿越吧！島嶼開拓者', '社會', null, null, 'construction',
   null, null, null, null, null, '穿越回不同時代的台灣，從八堡圳開始，一步步開拓這座島。', 2),
  ('science_warrior', 'science', '科學戰士', '自然', null, null, 'construction',
   null, null, null, null, null, '自然科的島還在蓋，完成後會在這裡開放。', 3)
on conflict (code) do nothing;

-- 現有的班：每一班自動開放守護異世界，老師和學生不用重新設定。
-- 只在這個班「從來沒在樂園設定過」時補：老師在樂園存過開放設施，班級設定就會有一筆，
-- 之後就算全部關掉，重跑這份也不會又被打開。
insert into public.park_class_facilities (class_code, facility)
select c.code, 'guardian' from public.classes c
 where not exists (select 1 from public.park_class_facilities x where x.class_code = c.code)
   and not exists (select 1 from public.park_class_settings st where st.class_code = c.code)
on conflict do nothing;

-- 新開的班（不管是樂園開的還是守護異世界的老師後台開的）預設開放所有「開放中」的設施。
create or replace function public.park_default_class_facilities()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.park_class_facilities (class_code, facility)
  select new.code, f.code from public.park_facilities f where f.status = 'open'
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.park_default_class_facilities() from public, anon, authenticated;
drop trigger if exists park_default_class_facilities on public.classes;
create trigger park_default_class_facilities
  after insert on public.classes
  for each row execute function public.park_default_class_facilities();

-- 讀取規則：設施目錄大家都看得到（地圖要用），其他只開給相關的人；寫入一律走函式。
alter table public.park_zones            enable row level security;
alter table public.park_facilities       enable row level security;
alter table public.park_class_facilities enable row level security;
alter table public.park_trial_classes    enable row level security;
alter table public.park_audit            enable row level security;

revoke all on public.park_zones, public.park_facilities, public.park_class_facilities,
              public.park_trial_classes, public.park_audit from anon, authenticated;
grant select on public.park_zones, public.park_facilities to anon, authenticated;
grant select on public.park_class_facilities, public.park_trial_classes, public.park_audit to authenticated;

drop policy if exists park_zones_read on public.park_zones;
create policy park_zones_read on public.park_zones for select to anon, authenticated
  using (status <> 'hidden' or public.is_admin());
drop policy if exists park_facilities_read on public.park_facilities;
create policy park_facilities_read on public.park_facilities for select to anon, authenticated
  using (status <> 'hidden' or public.is_admin());
drop policy if exists park_class_facilities_read on public.park_class_facilities;
create policy park_class_facilities_read on public.park_class_facilities for select to authenticated
  using (
    public.is_teacher_of(class_code)
    or exists (select 1 from public.park_class_members m
                where m.class_code = park_class_facilities.class_code
                  and m.student_id = public.current_student_id())
  );
drop policy if exists park_trial_classes_read on public.park_trial_classes;
create policy park_trial_classes_read on public.park_trial_classes for select to authenticated
  using (public.is_admin() or public.is_teacher_of(class_code));
drop policy if exists park_audit_read on public.park_audit;
create policy park_audit_read on public.park_audit for select to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 2. 小幫手
-- -----------------------------------------------------------------------------

-- 這個學生是不是我（任何一班）的學生。管理員一律算。
-- 跟守護異世界的 is_teacher_of 不同的地方：看的是所有成員，不只主要班級，
-- 所以科任老師、家長也能幫孩子重設密碼（規劃書「重設密碼」那一段）。
create or replace function public.park_teaches_student(p_student uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin() or exists (
    select 1 from public.park_class_members m
     where m.student_id = p_student and public.is_teacher_of(m.class_code)
  );
$$;

-- 寫一筆操作紀錄
create or replace function public.park_log(p_action text, p_class text, p_target text, p_detail jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.park_audit (actor, actor_name, action, class_code, target, detail)
  values (auth.uid(),
          coalesce((select t.display_name from public.teachers t where t.user_id = auth.uid()), ''),
          p_action, p_class, p_target, coalesce(p_detail, '{}'::jsonb));
$$;

-- 啟用中的老師（含管理員）才進得了後台
create or replace function public.park_require_staff()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.active) then
    raise exception '只有老師或家長的帳號可以用這個功能';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. 地圖與進場
-- -----------------------------------------------------------------------------

-- 地圖要的：每個設施現在的狀態，以及「我的班有沒有開放」。沒登入也叫得動（只回公開資訊）。
create or replace function public.park_facility_list()
returns table (code text, zone text, name text, subject text, grade_min smallint, grade_max smallint,
               status text, url text, url_dev text, mine boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.code, f.zone, f.name, f.subject, f.grade_min, f.grade_max, f.status, f.url, f.url_dev,
         case when public.current_student_id() is null then null
              else exists (
                select 1 from public.park_class_members m
                  left join public.park_class_facilities cf
                         on cf.class_code = m.class_code and cf.facility = f.code
                  left join public.park_trial_classes tc
                         on tc.class_code = m.class_code and tc.facility = f.code
                 where m.student_id = public.current_student_id()
                   and ((f.status = 'open' and cf.facility is not null)
                     or (f.status = 'trial' and tc.facility is not null)))
         end
    from public.park_facilities f
   where f.status <> 'hidden'
   order by f.sort, f.code;
$$;

-- 遊戲一打開就問這一支（規劃書「遊戲接入規則」第 2 條）。回傳 {ok, reason}。
create or replace function public.park_can_enter(p_facility text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_f public.park_facilities%rowtype;
  v_me uuid := public.current_student_id();
begin
  select * into v_f from public.park_facilities f where f.code = p_facility;
  if v_f.code is null or v_f.status = 'hidden' then
    return jsonb_build_object('ok', false, 'reason', '找不到這個遊戲');
  end if;
  if public.is_admin() then return jsonb_build_object('ok', true); end if;
  if v_f.status = 'construction' then
    return jsonb_build_object('ok', false, 'reason', '「' || v_f.name || '」還在施工中，完成後就能玩');
  end if;
  if v_f.status = 'maintenance' then
    return jsonb_build_object('ok', false, 'reason', '「' || v_f.name || '」正在維修，請晚一點再來');
  end if;
  if exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.active) then
    return jsonb_build_object('ok', true);   -- 老師、家長可以先進去看看
  end if;
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', '請先回樂園登入');
  end if;
  if v_f.status = 'trial' then
    if exists (select 1 from public.park_class_members m
                 join public.park_trial_classes tc on tc.class_code = m.class_code
                where m.student_id = v_me and tc.facility = v_f.code) then
      return jsonb_build_object('ok', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', '「' || v_f.name || '」還在試營運，只有試玩班可以進去');
  end if;
  if exists (select 1 from public.park_class_members m
               join public.park_class_facilities cf on cf.class_code = m.class_code
              where m.student_id = v_me and cf.facility = v_f.code) then
    return jsonb_build_object('ok', true);
  end if;
  if not exists (select 1 from public.park_class_members m where m.student_id = v_me) then
    return jsonb_build_object('ok', false, 'reason', '你還沒有加入班級，請在「我的資料」輸入老師給的班級代碼');
  end if;
  return jsonb_build_object('ok', false, 'reason', '你的班還沒有開放「' || v_f.name || '」，請問問老師');
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. 老師／家長：我的班級
-- -----------------------------------------------------------------------------

create or replace function public.park_teacher_classes()
returns table (code text, name text, open boolean, grade smallint, kind text,
               members bigint, created_at timestamptz, facilities text[], trials text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select c.code, c.name, c.open, st.grade, coalesce(st.kind, 'school'),
         (select count(*) from public.park_class_members m where m.class_code = c.code),
         c.created_at,
         coalesce((select array_agg(cf.facility order by cf.facility)
                     from public.park_class_facilities cf where cf.class_code = c.code), '{}'),
         coalesce((select array_agg(tc.facility order by tc.facility)
                     from public.park_trial_classes tc where tc.class_code = c.code), '{}')
    from public.classes c
    left join public.park_class_settings st on st.class_code = c.code
    join public.teachers t on t.user_id = auth.uid() and t.active
   where c.owner = auth.uid()
   order by c.created_at;
$$;

-- 開班：代碼由系統產生（拿掉容易看錯的 0/O、1/I），上限與身分檢查沿用守護異世界的 create_class。
create or replace function public.park_create_class(p_name text, p_grade int, p_kind text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := coalesce(nullif(p_kind, ''), 'school');
  v_code text;
begin
  perform public.park_require_staff();
  if length(v_name) not between 1 and 20 then raise exception '班級名稱要 1 到 20 個字'; end if;
  if v_kind not in ('school', 'home') then raise exception '班級類型不對'; end if;
  if p_grade is not null and p_grade not between 1 and 6 then raise exception '年級要在 1 到 6 之間'; end if;
  if v_kind = 'school' and p_grade is null then raise exception '學校班請選年級'; end if;
  loop
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                                        (random() * 31)::int + 1, 1), '')
                 from generate_series(1, 6));
    exit when not exists (select 1 from public.classes c where c.code = v_code);
  end loop;
  perform public.create_class(v_code, v_name);         -- 擋停用、擋開班上限
  insert into public.park_class_settings (class_code, grade, kind)
  values (v_code, p_grade, v_kind)
  on conflict (class_code) do update set grade = excluded.grade, kind = excluded.kind, updated_at = now();
  perform public.park_log('create_class', v_code, v_name, jsonb_build_object('grade', p_grade, 'kind', v_kind));
  return v_code;
end;
$$;

-- 改班名、年級、類型
create or replace function public.park_save_class(p_code text, p_name text, p_grade int, p_kind text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := coalesce(nullif(p_kind, ''), 'school');
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  if length(v_name) not between 1 and 20 then raise exception '班級名稱要 1 到 20 個字'; end if;
  if v_kind not in ('school', 'home') then raise exception '班級類型不對'; end if;
  if p_grade is not null and p_grade not between 1 and 6 then raise exception '年級要在 1 到 6 之間'; end if;
  if v_kind = 'school' and p_grade is null then raise exception '學校班請選年級'; end if;
  update public.classes set name = v_name where code = v_code;
  insert into public.park_class_settings (class_code, grade, kind)
  values (v_code, p_grade, v_kind)
  on conflict (class_code) do update set grade = excluded.grade, kind = excluded.kind, updated_at = now();
end;
$$;

-- 這個班開放哪些設施（整包覆蓋）。
create or replace function public.park_set_class_facilities(p_code text, p_facilities text[])
returns text[] language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  -- 留一筆班級設定，當作「這班在樂園設定過了」（見最上面的初始資料）
  insert into public.park_class_settings (class_code) values (v_code) on conflict do nothing;
  delete from public.park_class_facilities where class_code = v_code;
  insert into public.park_class_facilities (class_code, facility)
  select v_code, f.code from public.park_facilities f
   where f.code = any(coalesce(p_facilities, '{}')) and f.status <> 'hidden';
  return coalesce((select array_agg(cf.facility order by cf.facility)
                     from public.park_class_facilities cf where cf.class_code = v_code), '{}');
end;
$$;

-- 全班總覽。一列一個學生（所有成員，不只主要班級），一欄一個這班有開放、而且有摘要函式的遊戲。
-- 每個遊戲的摘要函式自己也要檢查 is_teacher_of；這裡多擋一層。
-- 某個遊戲的摘要壞掉，只有那一欄顯示錯誤，其他照常。
create or replace function public.park_class_overview(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_students jsonb;
  v_games jsonb := '[]'::jsonb;
  v_rows jsonb;
  v_err text;
  f record;
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'login_id', s.login_id, 'nickname', s.nickname,
           'primary', s.class_code = v_code,
           'primary_class', s.class_code,
           'joined_at', m.joined_at,
           'locked', coalesce(s.locked_until > now(), false))
         order by s.nickname, s.login_id), '[]'::jsonb)
    into v_students
    from public.park_class_members m
    join public.students s on s.id = m.student_id
   where m.class_code = v_code;

  for f in
    select fa.code, fa.name, fa.subject, fa.status, fa.summary_fn, fa.detail_url, fa.detail_url_dev
      from public.park_facilities fa
      join public.park_class_facilities cf on cf.facility = fa.code and cf.class_code = v_code
     where fa.status <> 'hidden'
     order by fa.sort, fa.code
  loop
    v_rows := null; v_err := null;
    if f.summary_fn is null then
      v_err := '這個遊戲還沒有提供全班摘要';
    elsif not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = f.summary_fn) then
      v_err := '這個遊戲的摘要函式還沒裝到資料庫';
    else
      begin
        execute format(
          'select coalesce(jsonb_object_agg(r.student_id, to_jsonb(r) - ''student_id''), ''{}''::jsonb)
             from public.%I($1) r', f.summary_fn)
          into v_rows using v_code;
      exception when others then
        v_err := '讀取這個遊戲的進度時出錯：' || sqlerrm;
      end;
    end if;
    v_games := v_games || jsonb_build_object(
      'code', f.code, 'name', f.name, 'subject', f.subject, 'status', f.status,
      'detail_url', f.detail_url, 'detail_url_dev', f.detail_url_dev,
      'rows', coalesce(v_rows, '{}'::jsonb), 'error', v_err);
  end loop;

  return jsonb_build_object('students', v_students, 'games', v_games);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. 學生管理：重設密碼、改暱稱、移出班級
-- -----------------------------------------------------------------------------

-- 重設密碼並解鎖。學生所在任何一班的開班人都可以，每次都留紀錄。
create or replace function public.park_reset_password(p_student uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_login text; v_nick text; v_bad text;
begin
  select s.login_id, s.nickname into v_login, v_nick from public.students s where s.id = p_student;
  if v_login is null then raise exception '找不到這個學生'; end if;
  if not public.park_teaches_student(p_student) then raise exception '這不是你班上的學生'; end if;
  v_bad := public.password_problem(p_password, v_login);
  if v_bad is not null then raise exception '%', v_bad; end if;
  update public.students
     set pw_hash = extensions.crypt(lower(p_password), extensions.gen_salt('bf')),
         failed_attempts = 0, locked_until = null
   where id = p_student;
  perform public.park_log('reset_password', null, v_nick || '（' || v_login || '）');
end;
$$;

-- 改暱稱。暱稱全站共用，只在主要班級檢查重複（跟註冊一樣）。
create or replace function public.park_set_student_nickname(p_student uuid, p_nickname text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nick text := btrim(coalesce(p_nickname, ''));
  v_old text; v_login text; v_code text;
begin
  select s.nickname, s.login_id, s.class_code into v_old, v_login, v_code
    from public.students s where s.id = p_student;
  if v_login is null then raise exception '找不到這個學生'; end if;
  if not public.park_teaches_student(p_student) then raise exception '這不是你班上的學生'; end if;
  if public.nickname_problem(v_nick) is not null then
    raise exception '%', public.nickname_problem(v_nick);
  end if;
  if v_code is not null and exists (
    select 1 from public.students s
     where s.class_code = v_code and s.nickname = v_nick and s.id <> p_student
  ) then raise exception '他的主要班級已經有人叫這個暱稱了'; end if;
  update public.students set nickname = v_nick where id = p_student;
  perform public.park_log('set_nickname', null, v_old || ' → ' || v_nick || '（' || v_login || '）');
  return v_nick;
end;
$$;

-- 把學生移出這一班。**只移出，不刪帳號**（守護異世界的 teacher_remove_student 會把整個帳號刪掉）。
-- 移出的是他的主要班級時：還有別的班就把最早加入的那班升成主要班級，沒有就變成沒有班級。
create or replace function public.park_remove_from_class(p_code text, p_student uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_primary text; v_nick text; v_login text; v_next text;
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  select s.class_code, s.nickname, s.login_id into v_primary, v_nick, v_login
    from public.students s where s.id = p_student;
  if v_login is null then raise exception '找不到這個學生'; end if;
  if not exists (select 1 from public.park_class_members m
                  where m.class_code = v_code and m.student_id = p_student) then
    raise exception '他不在這一班';
  end if;

  if v_primary = v_code then
    -- 換主要班級時暱稱在新班不能撞名，撞名的班跳過
    select m.class_code into v_next
      from public.park_class_members m
     where m.student_id = p_student and m.class_code <> v_code
       and not exists (select 1 from public.students s2
                        where s2.class_code = m.class_code and s2.nickname = v_nick and s2.id <> p_student)
     order by m.joined_at
     limit 1;
    -- 觸發器會把舊的主要班級從成員表拿掉
    update public.students set class_code = v_next where id = p_student;
  end if;
  delete from public.park_class_members where class_code = v_code and student_id = p_student;
  perform public.park_log('remove_from_class', v_code, v_nick || '（' || v_login || '）',
                          jsonb_build_object('new_primary', v_next, 'was_primary', v_primary = v_code));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. 管理員
-- -----------------------------------------------------------------------------

create or replace function public.park_admin_facilities()
returns table (code text, zone text, zone_name text, name text, subject text,
               grade_min smallint, grade_max smallint, status text,
               url text, url_dev text, summary_fn text, sort int,
               classes bigint, trials text[], updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.code, f.zone, z.name, f.name, f.subject, f.grade_min, f.grade_max, f.status,
         f.url, f.url_dev, f.summary_fn, f.sort,
         (select count(*) from public.park_class_facilities cf where cf.facility = f.code),
         coalesce((select array_agg(tc.class_code order by tc.class_code)
                     from public.park_trial_classes tc where tc.facility = f.code), '{}'),
         f.updated_at
    from public.park_facilities f
    join public.park_zones z on z.code = f.zone
   where public.is_admin()
   order by f.sort, f.code;
$$;

-- 改設施狀態、適合年級、試玩班。出問題時一鍵改「維修中」，不用重新部署。
create or replace function public.park_admin_set_facility(
  p_code text, p_status text, p_grade_min int, p_grade_max int, p_trials text[] default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old public.park_facilities%rowtype;
begin
  if not public.is_admin() then raise exception '只有管理員可以做這件事'; end if;
  select * into v_old from public.park_facilities f where f.code = p_code;
  if v_old.code is null then raise exception '找不到這個設施'; end if;
  if p_status not in ('open', 'trial', 'construction', 'maintenance', 'hidden') then
    raise exception '狀態不對';
  end if;
  if p_grade_min is not null and p_grade_min not between 1 and 9
     or p_grade_max is not null and p_grade_max not between 1 and 9 then
    raise exception '年級要在 1 到 9 之間';
  end if;
  if p_grade_min is not null and p_grade_max is not null and p_grade_min > p_grade_max then
    raise exception '年級的起點不能比終點大';
  end if;
  update public.park_facilities
     set status = p_status, grade_min = p_grade_min, grade_max = p_grade_max, updated_at = now()
   where code = p_code;
  if p_trials is not null then
    delete from public.park_trial_classes where facility = p_code;
    insert into public.park_trial_classes (facility, class_code)
    select p_code, c.code from public.classes c
     where c.code = any(array(select upper(btrim(x)) from unnest(p_trials) x));
  end if;
  perform public.park_log('set_facility', null, v_old.name, jsonb_build_object(
    'from', v_old.status, 'to', p_status, 'grade_min', p_grade_min, 'grade_max', p_grade_max,
    'trials', p_trials));
end;
$$;

-- 所有班級，含年級、類型與成員數（守護異世界的 admin_list_classes 只算主要班級）。
create or replace function public.park_admin_classes()
returns table (code text, name text, open boolean, owner uuid, owner_name text, owner_active boolean,
               grade smallint, kind text, members bigint, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.code, c.name, c.open, c.owner, t.display_name, t.active, st.grade,
         coalesce(st.kind, 'school'),
         (select count(*) from public.park_class_members m where m.class_code = c.code),
         c.created_at
    from public.classes c
    left join public.teachers t on t.user_id = c.owner
    left join public.park_class_settings st on st.class_code = c.code
   where public.is_admin()
   order by c.created_at;
$$;

create or replace function public.park_admin_audit(p_limit int default 100)
returns table (at timestamptz, actor_name text, action text, class_code text, target text, detail jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.at, a.actor_name, a.action, a.class_code, a.target, a.detail
    from public.park_audit a
   where public.is_admin()
   order by a.at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- -----------------------------------------------------------------------------
-- 7. 守護異世界的全班摘要（規劃書「遊戲接入規則」第 3 條）
--    只讀守護異世界現有的表，不改它。P3 接上守護異世界時會搬進它自己的 repo。
--    欄位固定：學生、進度 0–100、最後遊玩、一句目前狀態、是否需要注意、一句原因。
-- -----------------------------------------------------------------------------
create or replace function public.guardian_class_summary(p_code text)
returns table (student_id uuid, progress int, last_played timestamptz,
               status text, attention boolean, reason text)
language sql stable security definer set search_path = public, pg_temp as $$
  with target as (select upper(btrim(coalesce(p_code, ''))) as code),
  total as (select greatest(count(*), 1) as n from public.levels),
  kids as (
    select s.id, s.locked_until
      from public.park_class_members m
      join public.students s on s.id = m.student_id
      join target t on t.code = m.class_code
     where public.is_teacher_of(t.code)
  ),
  stat as (
    select k.id, k.locked_until,
           (select count(*) from public.level_progress lp
             where lp.student_id = k.id and lp.cleared_at is not null) as cleared,
           (select l.chapter || ':' || l.no || ':' || l.name
              from public.level_progress lp join public.levels l on l.id = lp.level_id
             where lp.student_id = k.id and lp.cleared_at is not null
             order by l.no desc limit 1) as best,
           (select max(ae.at) from public.answer_events ae where ae.student_id = k.id) as last_at,
           (select round(100 * avg(case when x.correct then 1 else 0 end))::int
              from (select ae.correct from public.answer_events ae
                     where ae.student_id = k.id order by ae.at desc limit 50) x) as recent_acc,
           (select count(*) from (select 1 from public.answer_events ae
                     where ae.student_id = k.id order by ae.at desc limit 50) x) as recent_n
      from kids k
  )
  select st.id,
         least(100, round(100.0 * st.cleared / (select n from total)))::int,
         st.last_at,
         case
           when st.last_at is null then '還沒開始'
           when st.best is null then '還在挑戰第 1 關'
           else '已過第 ' || split_part(st.best, ':', 2) || ' 關「' || split_part(st.best, ':', 3)
                || '」（第' || substr('一二三四五', split_part(st.best, ':', 1)::int, 1) || '章）'
         end,
         (coalesce(st.locked_until > now(), false)
          or st.last_at is null
          or st.last_at < now() - interval '7 days'
          or (st.recent_n >= 20 and st.recent_acc < 60)),
         case
           when coalesce(st.locked_until > now(), false) then '密碼試錯太多次被鎖住了，可以幫他重設密碼'
           when st.last_at is null then '還沒玩過'
           when st.last_at < now() - interval '7 days'
             then extract(day from now() - st.last_at)::int || ' 天沒玩了'
           when st.recent_n >= 20 and st.recent_acc < 60
             then '最近 ' || st.recent_n || ' 題只答對 ' || st.recent_acc || '%'
           else null
         end
    from stat st;
$$;

-- -----------------------------------------------------------------------------
-- 8. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_teaches_student(uuid), public.park_log(text, text, text, jsonb),
  public.park_require_staff(), public.park_facility_list(), public.park_can_enter(text),
  public.park_teacher_classes(), public.park_create_class(text, int, text),
  public.park_save_class(text, text, int, text), public.park_set_class_facilities(text, text[]),
  public.park_class_overview(text), public.park_reset_password(uuid, text),
  public.park_set_student_nickname(uuid, text), public.park_remove_from_class(text, uuid),
  public.park_admin_facilities(), public.park_admin_set_facility(text, text, int, int, text[]),
  public.park_admin_classes(), public.park_admin_audit(int), public.guardian_class_summary(text)
  from public, anon, authenticated;

-- 地圖：沒登入也能看狀態
grant execute on function public.park_facility_list() to anon, authenticated;
grant execute on function
  public.park_can_enter(text),
  public.park_teacher_classes(), public.park_create_class(text, int, text),
  public.park_save_class(text, text, int, text), public.park_set_class_facilities(text, text[]),
  public.park_class_overview(text), public.park_reset_password(uuid, text),
  public.park_set_student_nickname(uuid, text), public.park_remove_from_class(text, uuid),
  public.park_admin_facilities(), public.park_admin_set_facility(text, text, int, int, text[]),
  public.park_admin_classes(), public.park_admin_audit(int), public.guardian_class_summary(text)
  to authenticated;
