-- =============================================================================
-- 時空冒險樂園：後台整併第 1 期（2026-11-05「規劃管理介面整併與權限分層」）
--
-- 1. 家長設的優先（第 2 期：公共交誼廳不算班，沒有真的班就全部開放的遊戲都能玩）：孩子有「監護人開的家庭班」時，開放哪些遊戲照那個家庭班；沒有才是所有班的聯集
-- 2. 寵物島每天可以玩幾分鐘（班級設定，開班預設不限）：家長有設照家長，沒設取各班最嚴的
-- 3. 管理員看全站測驗卷（每張卷每個孩子的作答用原本的 park_quiz_report，管理員本來就看得到）
--
-- 要先套 park_teacher.sql、park_parent.sql、park_pet.sql、park_playlog.sql、park_quiz.sql。可以重複執行。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 家長的家庭班
-- -----------------------------------------------------------------------------
-- 確認過的監護人才算（status 欄位在 park_bind.sql 也會加，這裡先加好，兩份誰先套都可以）
alter table public.park_guardians add column if not exists status text not null default 'active';
-- 孩子所在的班裡，由他的監護人開的家庭班（有好幾個取最早開的）。沒有就是 null。
create or replace function public.park_home_class_of(p_student uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select m.class_code
    from public.park_class_members m
    join public.classes c on c.code = m.class_code
    join public.park_class_settings s on s.class_code = m.class_code and s.kind = 'home'
    join public.park_guardians g on g.student_id = m.student_id and g.guardian = c.owner and g.status = 'active'
   where m.student_id = p_student
   order by c.created_at nulls last, c.code
   limit 1;
$$;

-- 決定「開放哪些遊戲」要看的班：有家長的家庭班就只看那一班，不然看他所有的班。
-- 公共交誼廳（TRYIT，park_lounge.sql）不算：交誼廳不決定能玩什麼
create or replace function public.park_rule_classes(p_student uuid)
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.park_home_class_of(p_student), m.class_code)
    from public.park_class_members m
   where m.student_id = p_student and m.class_code <> 'TRYIT'
   group by 1;
$$;

-- 沒有真的班（只在交誼廳、或什麼班都沒有）：所有開放的遊戲都能玩
create or replace function public.park_no_real_class(p_student uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from public.park_class_members m where m.student_id = p_student and m.class_code <> 'TRYIT');
$$;

-- 地圖：每個設施的狀態＋「我能不能玩」。正式開放看規則班，試營運照舊看所有的班（試玩班是管理員指定的）
create or replace function public.park_facility_list()
returns table (code text, zone text, name text, subject text, grade_min smallint, grade_max smallint,
               status text, url text, url_dev text, mine boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.code, f.zone, f.name, f.subject, f.grade_min, f.grade_max, f.status, f.url, f.url_dev,
         case when public.current_student_id() is null then null
              when f.status = 'open' then public.park_no_real_class(public.current_student_id()) or exists (
                select 1 from public.park_rule_classes(public.current_student_id()) r(code)
                  join public.park_class_facilities cf on cf.class_code = r.code and cf.facility = f.code)
              when f.status = 'trial' then exists (
                select 1 from public.park_class_members m
                  join public.park_trial_classes tc on tc.class_code = m.class_code and tc.facility = f.code
                 where m.student_id = public.current_student_id())
              else false
         end
    from public.park_facilities f
   where f.status <> 'hidden'
   order by f.sort, f.code;
$$;

create or replace function public.park_can_enter(p_facility text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_f public.park_facilities%rowtype;
  v_me uuid := public.current_student_id();
  v_home text;
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
  if public.park_no_real_class(v_me) or exists (select 1 from public.park_rule_classes(v_me) r(code)
               join public.park_class_facilities cf on cf.class_code = r.code
              where cf.facility = v_f.code) then
    return jsonb_build_object('ok', true);
  end if;
  v_home := public.park_home_class_of(v_me);
  if v_home is not null then
    return jsonb_build_object('ok', false, 'reason', '爸媽還沒有幫你打開「' || v_f.name || '」，問問爸媽吧');
  end if;
  return jsonb_build_object('ok', false, 'reason', '你的班還沒有開放「' || v_f.name || '」，請問問老師');
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. 寵物島每天可以玩幾分鐘
-- -----------------------------------------------------------------------------
alter table public.park_class_settings add column if not exists pet_daily_min smallint
  check (pet_daily_min is null or pet_daily_min between 5 and 240);

-- 這個孩子今天的寵物島上限：家長的家庭班有設就照家長；沒設取各班裡最少的；都沒設 → null（不限）
create or replace function public.park_pet_limit_of(p_student uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with home as (
    select s.pet_daily_min m from public.park_class_settings s
     where s.class_code = public.park_home_class_of(p_student) and s.pet_daily_min is not null
  ), cls as (
    select min(s.pet_daily_min) m from public.park_class_members x
      join public.park_class_settings s on s.class_code = x.class_code
     where x.student_id = p_student and s.pet_daily_min is not null
  ), lim as (
    select coalesce((select m from home), (select m from cls)) m,
           case when exists (select 1 from home) then 'home' else 'class' end by
  ), used as (
    -- 今天（臺灣時間）待在寵物島的秒數；還沒收尾的那一筆算到最後一次心跳
    select coalesce(sum(extract(epoch from (coalesce(l.ended_at, l.last_seen)
                         - greatest(l.started_at, (date_trunc('day', now() at time zone 'Asia/Taipei')) at time zone 'Asia/Taipei')))), 0)::int sec
      from public.park_play_log l
     where l.student_id = p_student and l.facility = 'park' and l.place = 'pet'
       and coalesce(l.ended_at, l.last_seen) >= (date_trunc('day', now() at time zone 'Asia/Taipei')) at time zone 'Asia/Taipei'
  )
  select jsonb_build_object('min', lim.m, 'by', case when lim.m is null then null else lim.by end,
                            'used_sec', greatest(used.sec, 0),
                            'left_sec', case when lim.m is null then null else greatest(lim.m * 60 - used.sec, 0) end)
    from lim, used;
$$;

-- 孩子自己問（寵物島打開時、每分鐘）
create or replace function public.park_pet_limit_me()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then return jsonb_build_object('min', null, 'used_sec', 0, 'left_sec', null); end if;
  return public.park_pet_limit_of(v_me);
end;
$$;

-- 老師後台「設定」：這個班的寵物島設定（上課時間休息、每天幾分鐘）
create or replace function public.park_class_config(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  return coalesce((select jsonb_build_object('pet_quiet', s.pet_quiet, 'pet_daily_min', s.pet_daily_min, 'kind', s.kind, 'circle', s.circle)
                     from public.park_class_settings s where s.class_code = v_code),
                  jsonb_build_object('pet_quiet', false, 'pet_daily_min', null, 'kind', 'school', 'circle', true));
end;
$$;

create or replace function public.park_class_set_pet_limit(p_code text, p_min int)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  if p_min is not null and (p_min < 5 or p_min > 240) then raise exception '每天可以玩 5 到 240 分鐘，或不限'; end if;
  insert into public.park_class_settings as s (class_code, pet_daily_min) values (v_code, p_min)
  on conflict (class_code) do update set pet_daily_min = excluded.pet_daily_min, updated_at = now();
  perform public.park_log('pet_limit', v_code, null, jsonb_build_object('min', p_min));
  return p_min;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. 管理員：全站測驗卷
-- -----------------------------------------------------------------------------
create or replace function public.park_quiz_admin_papers(p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception '只有管理員可以看全站的測驗卷'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'at' desc) from (
      select jsonb_build_object(
               'id', p.id, 'title', p.title, 'n', p.n, 'by', p.by_name, 'at', p.created_at,
               'hidden', p.hidden_at is not null,
               'class', p.class_code, 'class_name', c.name, 'kind', coalesce(s.kind, 'school'),
               'owner', t.display_name, 'owner_role', r.role,
               'kids', (select count(distinct q.student) from public.quiz_slot q where q.paper = p.id),
               'opened', (select count(*) from public.quiz_take k where k.paper = p.id and k.opened_at is not null),
               'done', (select count(*) from public.quiz_take k where k.paper = p.id and k.submitted_at is not null),
               'avg', (select round(avg(k.score)::numeric, 1) from public.quiz_take k where k.paper = p.id and k.submitted_at is not null)) x
        from public.quiz_paper p
        left join public.classes c on c.code = p.class_code
        left join public.park_class_settings s on s.class_code = p.class_code
        left join public.teachers t on t.user_id = c.owner
        left join public.park_staff_roles r on r.user_id = c.owner
       order by p.created_at desc
       limit least(greatest(coalesce(p_limit, 300), 1), 1000)) y), '[]');
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. 權限
-- -----------------------------------------------------------------------------
revoke all on function public.park_home_class_of(uuid), public.park_rule_classes(uuid), public.park_pet_limit_of(uuid),
  public.park_no_real_class(uuid)
  from public, anon, authenticated;
grant execute on function public.park_facility_list() to anon, authenticated;
grant execute on function public.park_can_enter(text) to anon, authenticated;
grant execute on function public.park_pet_limit_me(), public.park_class_config(text), public.park_class_set_pet_limit(text, int),
  public.park_quiz_admin_papers(int) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. 「每天玩多久」分頁版（2026-11-06 Chuck：公共交誼廳一千多人，要能找、篩、翻頁）
-- -----------------------------------------------------------------------------
-- p_q 找暱稱或帳號；p_who：came 這段時間有來玩（預設）／idle 沒來／all 全部；一頁 p_size 人（玩最久的排前面）
-- 回傳 {total, came, idle, page, size, kids:[{id, nickname, sec, days}], rows:[{student_id, day, facility, game, seconds, plays, stamps}]}
create or replace function public.park_class_days_page(p_code text, p_days int default 7, p_q text default '',
                                                       p_who text default 'came', p_page int default 0, p_size int default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_days  int := least(greatest(coalesce(p_days, 7), 1), 35);
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_q     text := lower(left(nullif(btrim(coalesce(p_q, '')), ''), 20));
  v_who   text := case when p_who in ('came', 'idle', 'all') then p_who else 'came' end;
  v_size  int := least(greatest(coalesce(p_size, 30), 5), 100);
  v_page  int := greatest(coalesce(p_page, 0), 0);
  v_ids   uuid[];
  v_out   jsonb;
begin
  if not public.is_teacher_of(v_code) then raise exception '這不是你的班'; end if;
  select array_agg(m.student_id) into v_ids from public.park_class_members m where m.class_code = v_code;
  if v_ids is null then
    return jsonb_build_object('total', 0, 'came', 0, 'idle', 0, 'page', 0, 'size', v_size, 'kids', '[]'::jsonb, 'rows', '[]'::jsonb);
  end if;
  with act as (
    select r.student_id, (r.started_at at time zone 'Asia/Taipei')::date as day, r.facility, public.park_facility_name(r.facility) as game,
           coalesce(sum(r.seconds) filter (where r.kind = 'play'), 0)::int as seconds,
           (count(*) filter (where r.kind in ('level', 'save') or (r.kind = 'play' and r.place <> 'enter')))::int as plays,
           (count(*) filter (where r.kind = 'stamp'))::int as stamps
      from public.park_activity_rows(((v_today - (v_days - 1))::timestamp at time zone 'Asia/Taipei'), v_ids) r
     where r.facility <> 'park'
     group by 1, 2, 3
  ), tot as (
    select a.student_id, sum(a.seconds)::int as sec, count(distinct a.day) filter (where a.seconds > 0 or a.plays > 0)::int as days
      from act a group by 1
  ), lst as (
    select s.id, s.nickname, coalesce(t.sec, 0) as sec, coalesce(t.days, 0) as days
      from public.students s left join tot t on t.student_id = s.id
     where s.id = any(v_ids)
       and (v_q is null or strpos(lower(s.nickname), v_q) > 0 or strpos(lower(s.login_id), v_q) > 0)
  ), f as (
    select * from lst where v_who = 'all' or (v_who = 'came') = (days > 0)
  ), pg as (
    select * from f order by sec desc, days desc, nickname, id offset v_page * v_size limit v_size
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'came', (select count(*) from lst where days > 0),
    'idle', (select count(*) from lst where days = 0),
    'page', v_page, 'size', v_size,
    'kids', coalesce((select jsonb_agg(jsonb_build_object('id', pg.id, 'nickname', pg.nickname, 'sec', pg.sec, 'days', pg.days)
                                       order by pg.sec desc, pg.days desc, pg.nickname, pg.id) from pg), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(to_jsonb(a)) from act a where a.student_id in (select id from pg)), '[]'::jsonb))
  into v_out;
  return v_out;
end;
$$;
grant execute on function public.park_class_days_page(text, int, text, text, int, int) to authenticated;
