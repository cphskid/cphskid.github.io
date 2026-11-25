-- =============================================================================
-- 樂園共用問卷（2026-11-25，第一份：時光實驗室留言本）
-- =============================================================================
--
-- Chuck：問卷以後可能常態做，所以做成通用的。開一份新問卷＝在 park_surveys 加一筆，不用改程式。
--   孩子畫面：js/survey.js（樂園共用，任何設施都能叫出來；孩子畫面不叫「問卷」，每份自己取名字）
--   後台：teacher.html → 管理 → 問卷（只有管理員看；2026-11-25 Chuck 決定老師不看）
--
-- 一份問卷（park_surveys）：
--   code       代碼，例如 lab-v1。想再問一輪就開 lab-v2（重新收、重新給一次幣）
--   facility   放在哪個設施（time_lab…），勳章也掛在這個設施底下
--   title      孩子看到的名字（例如「實驗室留言本」）
--   thanks     送出後滴答說的話
--   questions  題目 jsonb 陣列，每題 { id, type, q, goal?, optional?, ... }：
--                face   點表情 1～5（5＝超好玩）
--                pick   點選項：options [{id,label,icon?}]，或 from:'<名字>'＝由遊戲提供（例如玩過的實驗）；
--                       multi:true 可多選、max 最多幾個；extra [{id,label,icon}] 接在 from 的選項後面
--                yesno  先點有／沒有；then { type:'pick', ... } 選「有」才接著問
--                text   打字，max 最多幾個字（預設 100），通常 optional:true
--   reward     第一次寫完給幾個時光幣（帳本 source＝'survey:<code>'，一個帳號只會入帳一次）
--   stamp      寫完蓋的勳章代碼（park_stamps 裡 facility＋code 要先有），null＝不給勳章
--   gate_fn    誰可以寫：'<名字>_survey_gate'(student uuid) returns boolean；null＝都可以
--   locked     還不能寫時滴答說的話
--   min_secs   比這個秒數更快送出的，照收、照給幣，但統計預設不算（不懲罰孩子）
--   opens_at / closes_at  開放期間（null＝不限）；active＝false 整份收起來
--
-- 函式：
--   park_survey_get(code)                           學生：題目、能不能寫、我寫過的答案
--   park_survey_submit(code, answers, text, secs, device, names)  學生：送出（可以改，幣只給第一次）
--   park_survey_stamps(student, facility)           各設施的 *_earned_stamps 接上來用
--   park_survey_admin_list() / park_survey_admin(code)  管理員：問卷列表／一份的所有作答
--
-- 套用順序：park_coins.sql → park_passport.sql → 這份 → 各設施（park_lab.sql 會登記實驗室留言本）。重跑沒關係。

create table if not exists public.park_surveys (
  code      text primary key check (code ~ '^[a-z][a-z0-9-]{1,30}$'),
  facility  text not null references public.park_facilities(code) on delete cascade on update cascade,
  title     text not null,
  thanks    text not null default '謝謝你！我們會認真看每一句話。',
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  reward    int  not null default 0 check (reward between 0 and 200),
  stamp     text,
  gate_fn   text check (gate_fn ~ '^[a-z][a-z0-9_]*_survey_gate$'),
  locked    text not null default '先去玩一玩，再回來跟我說好不好玩！',
  min_secs  int  not null default 8,
  opens_at  timestamptz,
  closes_at timestamptz,
  active    boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.park_surveys enable row level security;
revoke all on public.park_surveys from public, anon, authenticated;

create table if not exists public.park_survey_answers (
  survey     text not null references public.park_surveys(code) on delete cascade on update cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  answers    jsonb not null default '{}'::jsonb,
  names      jsonb not null default '{}'::jsonb,   -- 選項代碼 → 孩子當時看到的名字（from 的選項由遊戲給，統計要用）
  text       text,
  secs       int,
  device     text,
  edits      int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (survey, student_id)
);
alter table public.park_survey_answers enable row level security;
revoke all on public.park_survey_answers from public, anon, authenticated;

-- 這份問卷現在開著嗎
create or replace function public.park_survey_open(s public.park_surveys)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select s.active and (s.opens_at is null or s.opens_at <= now()) and (s.closes_at is null or s.closes_at > now());
$$;

-- 這個學生能不能寫（gate_fn 壞掉就當作不能，免得白送幣）
create or replace function public.park_survey_can(s public.park_surveys, p_student uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ok boolean;
begin
  if p_student is null then return false; end if;
  if s.gate_fn is null then return true; end if;
  if to_regprocedure(format('public.%I(uuid)', s.gate_fn)) is null then return false; end if;
  execute format('select public.%I($1)', s.gate_fn) into ok using p_student;
  return coalesce(ok, false);
exception when others then
  raise warning '問卷 % 的 gate_fn 出錯（%）', s.code, sqlerrm;
  return false;
end;
$$;

create or replace function public.park_survey_get(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := public.current_student_id();
  s    public.park_surveys;
  a    public.park_survey_answers;
begin
  select * into s from public.park_surveys where code = p_code;
  if not found or not public.park_survey_open(s) then return null; end if;
  if v_me is not null then select * into a from public.park_survey_answers where survey = s.code and student_id = v_me; end if;
  return jsonb_build_object(
    'code', s.code, 'title', s.title, 'thanks', s.thanks, 'questions', s.questions,
    'reward', s.reward, 'stamp', s.stamp is not null, 'locked', s.locked,
    'student', v_me is not null,
    'can', public.park_survey_can(s, v_me),
    'done', a.student_id is not null,
    'answers', a.answers, 'text', a.text);
end;
$$;

-- 送出：檢查每一題的答案長得對不對（不對的那題直接擋，前端本來就不會送）
create or replace function public.park_survey_submit(p_code text, p_answers jsonb, p_text text default null,
  p_secs int default null, p_device text default null, p_names jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me   uuid := public.current_student_id();
  s      public.park_surveys;
  q      jsonb;
  v      jsonb;
  t      text;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_first boolean;
  v_coins int := 0;
  v_max  int;
begin
  if v_me is null then raise exception '請先登入'; end if;
  select * into s from public.park_surveys where code = p_code;
  if not found or not public.park_survey_open(s) then raise exception '這份已經收起來了'; end if;
  if not public.park_survey_can(s, v_me) then raise exception '%', s.locked; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 8000 then raise exception '答案格式不對'; end if;
  if length(coalesce(p_names, '{}'::jsonb)::text) > 8000 then p_names := '{}'::jsonb; end if;

  for q in select * from jsonb_array_elements(s.questions) loop
    t := q->>'type';
    v := p_answers -> (q->>'id');
    if t = 'text' then
      v_max := coalesce((q->>'max')::int, 100);
      if v_text is not null and char_length(v_text) > v_max then v_text := left(v_text, v_max); end if;
      if v_text is null and not coalesce((q->>'optional')::boolean, false) then raise exception '還有一題沒寫：%', q->>'q'; end if;
      continue;
    end if;
    if v is null or v = 'null'::jsonb then
      if coalesce((q->>'optional')::boolean, false) then continue; end if;
      raise exception '還有一題沒點：%', q->>'q';
    end if;
    if t = 'face' then
      if jsonb_typeof(v) <> 'number' or (v)::text::int not between 1 and 5 then raise exception '表情不對'; end if;
    elsif t = 'pick' then
      if coalesce((q->>'multi')::boolean, false) then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0 then raise exception '至少選一個'; end if;
        if q ? 'max' and jsonb_array_length(v) > (q->>'max')::int then raise exception '最多選 % 個', q->>'max'; end if;
      elsif jsonb_typeof(v) <> 'string' then raise exception '選項不對';
      end if;
    elsif t = 'yesno' then
      -- false＝沒有；true 或 陣列（接著點的那些）＝有
      if jsonb_typeof(v) not in ('boolean', 'array') then raise exception '有／沒有不對'; end if;
    end if;
  end loop;

  insert into public.park_survey_answers as x (survey, student_id, answers, names, text, secs, device)
  values (s.code, v_me, p_answers, coalesce(p_names, '{}'::jsonb), v_text,
          least(greatest(coalesce(p_secs, 0), 0), 36000), left(p_device, 40))
  on conflict (survey, student_id) do update
    set answers = excluded.answers, names = x.names || excluded.names, text = excluded.text,
        secs = excluded.secs, device = excluded.device, edits = x.edits + 1, updated_at = now()
  returning (xmax = 0) into v_first;

  v_coins := public.park_coin_grant(v_me, 'survey:' || s.code, s.reward, s.facility, '寫了「' || s.title || '」');
  if s.stamp is not null then perform public.park_stamp_sync(v_me); end if;
  return jsonb_build_object('first', v_first, 'coins', v_coins, 'thanks', s.thanks,
    'top', (select coalesce(jsonb_agg(z.id), '[]'::jsonb) from (
              -- 大家最喜歡的前幾名（第一題 pick 單選的答案；只有代碼，前端配圖、取前三個認得的，不給人數）
              select a.answers ->> f.id as id from public.park_survey_answers a,
                     (select qq->>'id' as id from jsonb_array_elements(s.questions) qq
                       where qq->>'type' = 'pick' and not coalesce((qq->>'multi')::boolean, false) limit 1) f
               where a.survey = s.code and a.answers ? f.id
               group by 1 order by count(*) desc, 1 limit 6) z));
end;
$$;

-- 勳章：寫完的問卷有 stamp 就算（各設施的 *_earned_stamps union 這支）
create or replace function public.park_survey_stamps(p_student uuid, p_facility text)
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  select s.stamp from public.park_surveys s join public.park_survey_answers a on a.survey = s.code
   where a.student_id = p_student and s.facility = p_facility and s.stamp is not null;
$$;

-- ---------- 管理員 ----------
create or replace function public.park_survey_admin_list()
returns table (code text, facility text, facility_name text, title text, reward int, active boolean,
               opens_at timestamptz, closes_at timestamptz, answers bigint, with_text bigint, last_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception '只有管理員可以看'; end if;
  return query
  select s.code, s.facility, f.name, s.title, s.reward, s.active, s.opens_at, s.closes_at,
         count(a.student_id), count(a.text), max(a.updated_at)
    from public.park_surveys s join public.park_facilities f on f.code = s.facility
    left join public.park_survey_answers a on a.survey = s.code
   group by s.code, f.name order by s.created_at desc;
end;
$$;

-- 一份問卷的全部作答（統計在後台前端算）：暱稱、主要班級、年級、裝置、秒數、答案、留言
create or replace function public.park_survey_admin(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.park_surveys;
begin
  if not public.is_admin() then raise exception '只有管理員可以看'; end if;
  select * into s from public.park_surveys where code = p_code;
  if not found then raise exception '找不到這份問卷'; end if;
  return jsonb_build_object(
    'code', s.code, 'title', s.title, 'questions', s.questions, 'min_secs', s.min_secs, 'reward', s.reward,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nickname', st.nickname, 'class', st.class_code, 'class_name', c.name,
               'grade', (select g.grade from public.park_student_grades g where g.student_id = st.id),
               'answers', a.answers, 'names', a.names, 'text', a.text, 'secs', a.secs, 'device', a.device,
               'edits', a.edits, 'at', a.updated_at) order by a.updated_at desc)
        from public.park_survey_answers a join public.students st on st.id = a.student_id
        left join public.classes c on c.code = st.class_code
       where a.survey = s.code), '[]'::jsonb));
end;
$$;

revoke all on function public.park_survey_open(public.park_surveys), public.park_survey_can(public.park_surveys, uuid),
  public.park_survey_get(text), public.park_survey_submit(text, jsonb, text, int, text, jsonb),
  public.park_survey_stamps(uuid, text), public.park_survey_admin_list(), public.park_survey_admin(text)
  from public, anon, authenticated;
grant execute on function public.park_survey_get(text), public.park_survey_submit(text, jsonb, text, int, text, jsonb),
  public.park_survey_admin_list(), public.park_survey_admin(text) to authenticated;
