-- =============================================================================
-- 時空冒險樂園：公共交誼廳＋同伴圈（後台整併第 2 期，2026-11-05 Chuck 定案）
--
-- 試玩班 TRYIT 改成「公共交誼廳」：
--   1. 不屬任何班：交誼廳不決定能玩哪些遊戲（有真的班照那個班；完全沒有班的，所有開放的遊戲都能玩，見 park_console.sql）
--   2. 註冊不用代碼：沒填代碼就進交誼廳（register_student）；/about 的 ?join=TRYIT 一樣進交誼廳
--   3. 每週一分「同伴圈」：同年級、一圈最多 30 人（25–40 的中間），同暱稱分到不同圈，一週內不換圈。
--      這週第一次打開樂園才分（不來的不佔位子），所以圈裡都是這週有來的孩子。
--   4. 寵物島「我們班的島」、班級排行看的是同伴圈，不是整個交誼廳；另外有全樂園前 50 名
--   5. 交誼廳裡暱稱可以重複（真的班才擋）
--   6. 完全沒有班的孩子（例如退出了所有班）自動放進交誼廳
--   7. （2026-11-05 14:23Z Chuck 選「家長的和學校班都加」）同伴圈不只交誼廳：每個孩子預設都加入，
--      家長可以在孩子卡片關掉／打開（park_lounge_prefs），老師可以在班級設定把整班關掉（park_class_settings.circle）；
--      家長設過就照家長的，沒設過有任何一班關掉就不加，不然就加
--
-- 守護異世界的排行榜靠主要班級（students.class_code），交誼廳的孩子主要班級還是 TRYIT，這份沒有動它。
-- 要先套 park_accounts.sql、park_teacher.sql、park_coins.sql、park_bind.sql。可以重複執行。
-- 套完要再套 park_isle.sql（拜訪看同伴圈）、park_console.sql（交誼廳不給遊戲）、park_coins.sql 的 park_class_board。
-- =============================================================================

create or replace function public.park_lounge_code()
returns text language sql immutable set search_path = public, pg_temp as $$ select 'TRYIT'::text $$;

update public.classes set name = '公共交誼廳' where code = 'TRYIT' and name = '試玩班';

-- -----------------------------------------------------------------------------
-- 1. 交誼廳裡暱稱可以重複
-- -----------------------------------------------------------------------------
drop index if exists public.students_class_nickname;
create unique index students_class_nickname on public.students (class_code, nickname)
  where class_code is not null and class_code <> 'TRYIT';

-- 各支「同一班暱稱不能重複」的檢查，遇到交誼廳就跳過。這些函式分散在守護異世界和樂園的好幾份 SQL，
-- 這裡直接改資料庫裡的定義（重套原檔之後要再套這份）。已經改過的不會再改。
do $$
declare r record; v_def text; v_new text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.proname in ('register_student', 'student_join_class', 'park_join_class', 'park_move_primary',
                                'park_set_student_nickname', 'student_set_nickname', 'teacher_set_student_nickname',
                                'teacher_add_student', 'park_take_from_home', 'park_remove_from_class') loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def,
      '(s2?)\.class_code = (v_code|m\.class_code) and (s2?)\.nickname = v_nick',
      '\1.class_code = \2 and \2 <> ''TRYIT'' and \3.nickname = v_nick', 'g');
    -- 註冊沒填代碼 → 交誼廳
    if r.proname = 'register_student' then
      v_new := replace(v_new, 'v_code  text := upper(btrim(coalesce(p_class_code, '''')));',
                              'v_code  text := coalesce(nullif(upper(btrim(coalesce(p_class_code, ''''))), ''''), ''TRYIT'');');
    end if;
    if v_new <> v_def then
      execute v_new;
      raise notice '交誼廳：改了 %', r.proname;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. 完全沒有班的孩子放進交誼廳（現在有的先補，之後退出最後一班的也補）
-- -----------------------------------------------------------------------------
insert into public.park_class_members (class_code, student_id)
select 'TRYIT', s.id from public.students s
 where not exists (select 1 from public.park_class_members m where m.student_id = s.id)
on conflict do nothing;

create or replace function public.park_lounge_catch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.students s where s.id = old.student_id)
     and not exists (select 1 from public.park_class_members m where m.student_id = old.student_id) then
    insert into public.park_class_members (class_code, student_id) values ('TRYIT', old.student_id) on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists park_lounge_catch on public.park_class_members;
create trigger park_lounge_catch after delete on public.park_class_members
  for each row execute function public.park_lounge_catch();

-- -----------------------------------------------------------------------------
-- 3. 同伴圈
-- -----------------------------------------------------------------------------
create table if not exists public.park_lounge_circles (
  week       date not null,              -- 那週的星期一（臺灣時間）
  student_id uuid not null references public.students(id) on delete cascade,
  grade      smallint not null,          -- 0＝還沒填年級
  no         smallint not null,          -- 同年級第幾圈，從 1 開始
  at         timestamptz not null default now(),
  primary key (week, student_id)
);
create index if not exists park_lounge_circles_ring on public.park_lounge_circles (week, grade, no);
alter table public.park_lounge_circles enable row level security;   -- 只透過下面的函式讀寫

create or replace function public.park_lounge_week()
returns date language sql stable set search_path = public, pg_temp as $$
  select (public.park_week_start() at time zone 'Asia/Taipei')::date;
$$;

-- 誰在同伴圈：家長設過照家長；沒設過，所在的班（交誼廳除外）有一班關掉就不加；不然加
create table if not exists public.park_lounge_prefs (
  student_id uuid primary key references public.students(id) on delete cascade,
  on_       boolean not null,
  by_user   uuid,
  at        timestamptz not null default now()
);
alter table public.park_lounge_prefs enable row level security;
alter table public.park_class_settings add column if not exists circle boolean not null default true;

create or replace function public.park_lounge_on(p_student uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.on_ from public.park_lounge_prefs p where p.student_id = p_student),
                  not exists (select 1 from public.park_class_members m
                                join public.park_class_settings st on st.class_code = m.class_code
                               where m.student_id = p_student and m.class_code <> 'TRYIT' and not st.circle));
$$;

-- 家長：這個孩子要不要加入同伴圈（只有確認過的監護人）
create or replace function public.park_lounge_set_kid(p_student uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.park_is_guardian(p_student) then raise exception '只有孩子的爸媽可以設定'; end if;
  insert into public.park_lounge_prefs (student_id, on_, by_user) values (p_student, coalesce(p_on, true), auth.uid())
  on conflict (student_id) do update set on_ = excluded.on_, by_user = excluded.by_user, at = now();
  if not coalesce(p_on, true) then   -- 關掉：這週的圈馬上退出
    delete from public.park_lounge_circles c where c.student_id = p_student and c.week = public.park_lounge_week();
  end if;
  perform public.park_log('lounge_kid', null, (select st.nickname from public.students st where st.id = p_student), jsonb_build_object('on', p_on));
  return coalesce(p_on, true);
end;
$$;

create or replace function public.park_lounge_kid(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.park_is_guardian(p_student) then raise exception '只有孩子的爸媽可以看'; end if;
  return jsonb_build_object('on', public.park_lounge_on(p_student),
                            'set', exists (select 1 from public.park_lounge_prefs p where p.student_id = p_student));
end;
$$;

-- 老師：整班要不要加入同伴圈（家長設過的孩子照家長）
create or replace function public.park_class_set_circle(p_code text, p_on boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  insert into public.park_class_settings as s (class_code, circle) values (v_code, coalesce(p_on, true))
  on conflict (class_code) do update set circle = excluded.circle, updated_at = now();
  if not coalesce(p_on, true) then
    delete from public.park_lounge_circles c
     using public.park_class_members m
     where m.class_code = v_code and c.student_id = m.student_id and c.week = public.park_lounge_week()
       and not public.park_lounge_on(m.student_id);
  end if;
  perform public.park_log('class_circle', v_code, null, jsonb_build_object('on', p_on));
  return coalesce(p_on, true);
end;
$$;

-- 一圈收到幾個人就開下一圈（Chuck：25–40 人）
create or replace function public.park_lounge_size()
returns int language sql immutable set search_path = public, pg_temp as $$ select 30 $$;

-- 分圈：要加入同伴圈（park_lounge_on）、這週還沒分的才分。回傳 (grade, no)；不在交誼廳回 null
create or replace function public.park_lounge_assign(p_student uuid)
returns smallint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_week date := public.park_lounge_week(); v_no smallint; v_grade smallint; v_nick text;
begin
  if p_student is null then return null; end if;
  select c.no into v_no from public.park_lounge_circles c where c.week = v_week and c.student_id = p_student;
  if v_no is not null then return v_no; end if;
  if not public.park_lounge_on(p_student) then return null; end if;
  v_grade := coalesce((select g.grade from public.park_student_grades g where g.student_id = p_student), 0);
  v_nick := lower(coalesce((select s.nickname from public.students s where s.id = p_student), ''));
  perform pg_advisory_xact_lock(hashtext('park_lounge:' || v_week || ':' || v_grade));
  -- 還沒滿、沒有人跟我同暱稱的圈，挑最滿的（把圈填滿，不要每圈都只有幾個人）
  select c.no into v_no
    from public.park_lounge_circles c join public.students s on s.id = c.student_id
   where c.week = v_week and c.grade = v_grade
   group by c.no
  having count(*) < public.park_lounge_size()
     and not bool_or(lower(coalesce(s.nickname, '')) = v_nick)
   order by count(*) desc, c.no
   limit 1;
  if v_no is null then
    select coalesce(max(c.no), 0) + 1 into v_no from public.park_lounge_circles c where c.week = v_week and c.grade = v_grade;
  end if;
  insert into public.park_lounge_circles (week, student_id, grade, no) values (v_week, p_student, v_grade, v_no)
  on conflict do nothing;
  return v_no;
end;
$$;

-- 跟我同一圈的人（這週、含自己）
create or replace function public.park_lounge_ring(p_student uuid)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select b.student_id from public.park_lounge_circles a
    join public.park_lounge_circles b on b.week = a.week and b.grade = a.grade and b.no = a.no
   where a.week = public.park_lounge_week() and a.student_id = p_student
     and public.park_lounge_on(b.student_id);
$$;

-- 「同學」：真的班（不含交誼廳）的同學＋這週同伴圈的人。寵物島拜訪、名片都用這個
create or replace function public.park_mates(p_student uuid)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select b.student_id from public.park_class_members a
    join public.park_class_members b on b.class_code = a.class_code
   where a.student_id = p_student and a.class_code <> 'TRYIT' and b.student_id <> p_student
  union
  select r from public.park_lounge_ring(p_student) r where r <> p_student;
$$;

-- 孩子打開樂園時叫（這週第一次來就分圈）：{lounge, grade, no, size, real}；不在交誼廳 {lounge:false}
create or replace function public.park_lounge_me()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_no smallint;
begin
  if v_me is null then return jsonb_build_object('lounge', false); end if;
  v_no := public.park_lounge_assign(v_me);
  if v_no is null then return jsonb_build_object('lounge', false); end if;
  return (select jsonb_build_object('lounge', true, 'grade', c.grade, 'no', c.no,
                                    'real', not public.park_no_real_class(v_me),   -- 還有真的班（拜訪清單叫「我們班」）
                                    'size', (select count(*) from public.park_lounge_ring(v_me)))
            from public.park_lounge_circles c where c.week = public.park_lounge_week() and c.student_id = v_me);
end;
$$;

-- 管理員：交誼廳這週的樣子 {members, this_week, grades:[{grade, circles:[{no, n}]}], weeks:[{week, kids, circles}]}
create or replace function public.park_lounge_admin()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_week date := public.park_lounge_week();
begin
  if not public.is_admin() then raise exception '只有管理員可以看交誼廳'; end if;
  return jsonb_build_object(
    'members', (select count(*) from public.park_class_members m where m.class_code = 'TRYIT'),
    'only', (select count(*) from public.park_class_members m where m.class_code = 'TRYIT'
               and not exists (select 1 from public.park_class_members o where o.student_id = m.student_id and o.class_code <> 'TRYIT')),
    'this_week', (select count(*) from public.park_lounge_circles c where c.week = v_week),
    'off', (select count(*) from public.students s where not public.park_lounge_on(s.id)),
    'week', v_week,
    'size', public.park_lounge_size(),
    'grades', coalesce((select jsonb_agg(jsonb_build_object('grade', g.grade, 'circles', g.circles) order by g.grade) from (
        select x.grade, jsonb_agg(jsonb_build_object('no', x.no, 'n', x.n) order by x.no) circles
          from (select c.grade, c.no, count(*) n from public.park_lounge_circles c where c.week = v_week group by 1, 2) x
         group by x.grade) g), '[]'::jsonb),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', w.week, 'kids', w.kids, 'circles', w.circles) order by w.week desc) from (
        select c.week, count(*) kids, count(distinct (c.grade, c.no)) circles
          from public.park_lounge_circles c where c.week > v_week - 56 group by c.week) w), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. 權限
-- -----------------------------------------------------------------------------
revoke all on function public.park_lounge_assign(uuid), public.park_lounge_ring(uuid), public.park_mates(uuid),
  public.park_lounge_catch() from public, anon, authenticated;
grant execute on function public.park_lounge_me(), public.park_lounge_admin(), public.park_lounge_set_kid(uuid, boolean),
  public.park_lounge_kid(uuid), public.park_class_set_circle(text, boolean) to authenticated;
revoke all on function public.park_lounge_on(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. 守護異世界的排行榜也看同伴圈（2026-11-05 14:43Z Chuck）
-- -----------------------------------------------------------------------------
-- 守護異世界的排行（class_leaderboard、本週之星 class_weekly_stars、wk_ok）照主要班級算。主要班級是交誼廳的孩子
-- 原本跟整個交誼廳（上千人）一起比，改成只跟這週同伴圈的人比。老師、管理員看交誼廳還是看全部。
-- 這幾支在守護異世界 repo 的 schema.sql，這裡直接改資料庫裡的定義（重套 schema.sql 之後要再套這份）。
-- 同伴圈是孩子打開樂園時分的（park_lounge_me）；這週還沒分到的孩子先只看到自己。
create or replace function public.park_peers(p_code text)
returns setof uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if p_code = 'TRYIT' and v_me is not null
     and exists (select 1 from public.students s where s.id = v_me and s.class_code = 'TRYIT') then
    return query select r from public.park_lounge_ring(v_me) r
                 union select v_me;
  else
    return query select s.id from public.students s where s.class_code = p_code;
  end if;
end;
$$;
revoke all on function public.park_peers(text) from public, anon, authenticated;

do $$
declare r record; v_def text; v_new text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.proname in ('wk_ok', 'class_weekly_stars', 'class_leaderboard') loop
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    v_new := replace(v_new, 'where s.class_code = p_code and ae.correct',
                            'where s.id in (select public.park_peers(p_code)) and ae.correct');
    v_new := replace(v_new, 'on s.id = sa.student_id and s.class_code = v_code',
                            'on s.id = sa.student_id and s.id in (select public.park_peers(v_code))');
    v_new := replace(v_new, 'on os.id = o.student_id and os.class_code = v_code',
                            'on os.id = o.student_id and os.id in (select public.park_peers(v_code))');
    v_new := replace(v_new, 'on s.id = rs.student_id and s.class_code = v_code',
                            'on s.id = rs.student_id and s.id in (select public.park_peers(v_code))');
    v_new := replace(v_new, 'join target t on t.code = s.class_code',
                            'join target t on s.id in (select public.park_peers(t.code))');
    if v_new <> v_def then
      execute v_new;
      raise notice '同伴圈：改了 %', r.proname;
    end if;
  end loop;
end $$;
