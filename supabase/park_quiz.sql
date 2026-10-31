-- =============================================================================
-- 時空冒險樂園：時光試煉島（2026-10-29「規劃家長老師新手引導與測驗卷」）
-- =============================================================================
--
-- 樂園外的一座小島：家長／老師從後台出試煉卷，孩子用同一個帳號在 /quiz/ 作答。
-- 先做社會（島嶼開拓者）和自然（時光祕境島），英文之後再加。
--
-- 資料：
--   quiz_kp      知識點（每一題都掛在一個知識點上；知識點對到課本單元和遊戲裡的地方）
--   quiz_item    題目。status：draft 待審／live 審過可以抽／off 停用／own 家長自己出的（只在自己班）
--                改了題目內容 ver 就 +1，作答紀錄記下當時的 ver
--   quiz_paper   一張試煉卷（一個班出的）；quiz_slot 記每個孩子拿到哪幾題（可以每人不同）
--   quiz_take    孩子交卷的成績、拿到的幣
--   quiz_answer  每一題怎麼答、對了幾成（got 0～1）、花幾毫秒；fix＝訂正那一次
--   quiz_flag    孩子按「這題怪怪的」
--   quiz_kp_mark 家長把某個知識點「改回要加強」（之前答對的就不算學會）
--
-- 改分規則（伺服器改，網頁看不到答案）：
--   是非、單選、誰說得對：對＝1、錯＝0
--   多選：每個選項各算一份（該勾的勾了、不該勾的沒勾），對幾份得幾成
--   分類：每張卡各算一份；填空圈選：每個空格各算一份
--   排序：每兩個相鄰的順序對，算一份
--   分數＝全部題目得分加起來 ÷ 題數 × 100（四捨五入）；只有整題全對（got=1）才算這個知識點答對一次
--
-- 時光幣（只算第一次交卷，一週最多 3 張卷給幣，少於 5 題不給）：
--   100 分 30、80～99 分 20、60～79 分 10、60 分以下 5；20 題 ×1.5、30 題 ×2
--   訂正全部改對 +5（一張卷一次）
--
-- 套用順序：park_accounts → park_teacher → park_passport → park_coins → park_news → 這份（之後重跑都可以）
-- 題庫內容在 supabase/park_quiz_bank.sql（tools/quiz-bank.mjs 產生），這份只放結構和函式。

-- ---------- 資料表 ----------
create table if not exists public.quiz_kp (
  id       text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  subject  text not null check (subject in ('soc', 'sci', 'eng')),
  place    text not null,             -- 遊戲裡的地方：pro、ch1～ch7、end、town、isles、sky、post、a-forest…
  name     text not null,
  book     text not null default '',  -- 對到課本哪個單元（給家長看）
  game     jsonb,                     -- 遊戲裡哪裡練過：{kind:'think',slot,q,a}／{kind:'town',case}／{kind:'isle',id}
  sort     int  not null default 0
);

create table if not exists public.quiz_item (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  kp          text not null references public.quiz_kp(id) on update cascade,
  kind        text not null check (kind in ('tf', 'mc', 'who', 'multi', 'order', 'cat', 'cloze')),
  level       smallint not null default 1 check (level between 1 and 3),   -- 1 記憶 2 理解 3 應用
  body        jsonb not null,
  src         text not null default '',
  ver         int  not null default 1,
  status      text not null default 'draft' check (status in ('draft', 'live', 'off', 'own')),
  owner_class text references public.classes(code) on delete cascade on update cascade,
  owner       uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  check ((status = 'own') = (owner_class is not null))
);
create index if not exists quiz_item_kp on public.quiz_item (kp);

create table if not exists public.quiz_paper (
  id          uuid primary key default gen_random_uuid(),
  class_code  text not null references public.classes(code) on delete cascade on update cascade,
  created_by  uuid,
  by_name     text not null default '',
  title       text not null check (char_length(title) between 1 and 30),
  n           int  not null check (n between 1 and 30),
  created_at  timestamptz not null default now(),
  hidden_at   timestamptz
);
create index if not exists quiz_paper_class on public.quiz_paper (class_code, created_at desc);

create table if not exists public.quiz_slot (
  paper   uuid not null references public.quiz_paper(id) on delete cascade,
  student uuid not null references public.students(id) on delete cascade,
  pos     int  not null,
  item    text not null references public.quiz_item(id) on update cascade,
  ver     int  not null,
  bucket  text not null default '',   -- 自動挑題時的理由：weak 待加強／seen 玩過還沒學會／new 還沒玩過／review 抽查／pick 家長自己選
  primary key (paper, student, pos)
);
create index if not exists quiz_slot_student on public.quiz_slot (student);

create table if not exists public.quiz_take (
  paper        uuid not null references public.quiz_paper(id) on delete cascade,
  student      uuid not null references public.students(id) on delete cascade,
  opened_at    timestamptz,
  submitted_at timestamptz,
  score        int,
  coins        int not null default 0,
  fixed_at     timestamptz,
  fix_coins    int not null default 0,
  primary key (paper, student)
);

create table if not exists public.quiz_answer (
  paper   uuid not null,
  student uuid not null,
  pos     int  not null,
  fix     boolean not null default false,
  item    text not null,
  kp      text not null,
  ver     int  not null,
  resp    jsonb,
  got     real not null default 0,
  ms      int,
  at      timestamptz not null default now(),
  primary key (paper, student, pos, fix),
  foreign key (paper, student, pos) references public.quiz_slot(paper, student, pos) on delete cascade
);
create index if not exists quiz_answer_student on public.quiz_answer (student, kp);
create index if not exists quiz_answer_item on public.quiz_answer (item, ver);

create table if not exists public.quiz_flag (
  id       bigint generated always as identity primary key,
  item     text not null references public.quiz_item(id) on update cascade on delete cascade,
  ver      int  not null,
  student  uuid references public.students(id) on delete set null,
  paper    uuid references public.quiz_paper(id) on delete set null,
  note     text not null default '' check (char_length(note) <= 200),
  at       timestamptz not null default now(),
  status   text not null default 'open' check (status in ('open', 'ok', 'wrong')),
  done_by  uuid,
  done_at  timestamptz
);

create table if not exists public.quiz_kp_mark (
  student uuid not null references public.students(id) on delete cascade,
  kp      text not null references public.quiz_kp(id) on update cascade on delete cascade,
  at      timestamptz not null default now(),
  by_user uuid,
  primary key (student, kp)
);

alter table public.quiz_kp      enable row level security;
alter table public.quiz_item    enable row level security;
alter table public.quiz_paper   enable row level security;
alter table public.quiz_slot    enable row level security;
alter table public.quiz_take    enable row level security;
alter table public.quiz_answer  enable row level security;
alter table public.quiz_flag    enable row level security;
alter table public.quiz_kp_mark enable row level security;
-- 沒有任何 policy：答案在題目裡，只能透過下面的函式讀寫
revoke all on public.quiz_kp, public.quiz_item, public.quiz_paper, public.quiz_slot, public.quiz_take,
              public.quiz_answer, public.quiz_flag, public.quiz_kp_mark from public, anon, authenticated;

-- 信鴿信可以只寄給班上幾個孩子（試煉卷、推薦去玩）。null＝整班。
alter table public.park_news add column if not exists students uuid[];

-- ---------- 題目：洗牌、去掉答案、改分、檢查 ----------
-- 同一張卷同一個孩子同一題，每次打開順序都一樣（種子＝卷＋孩子＋第幾題）
create or replace function public.quiz_perm(p_seed text, p_n int)
returns int[] language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg(i order by md5(p_seed || ':' || i)), '{}') from generate_series(0, p_n - 1) i;
$$;

-- 題目的 body（答案標在原本的順序上）：
--   tf    {q, a:true|false, why}
--   mc    {q, opts:[…], a:i, why}              who {q, says:[{n,t}], a:i, why}
--   multi {q, opts:[…], a:[i…], why}
--   order {q, steps:[照正確順序], why}
--   cat   {q, cats:[…], cards:[{t, c:i}], why}
--   cloze {q, text:'…{0}…{1}…', blanks:[{opts:[…], a:i}], why}
-- 孩子拿到的（顯示順序）：選項洗過，沒有答案和解析。
create or replace function public.quiz_public(p_kind text, p_body jsonb, p_seed text)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare v_p int[]; v_out jsonb; v_b jsonb; i int; v_blanks jsonb := '[]';
begin
  if p_kind = 'tf' then
    return jsonb_build_object('q', p_body->'q');
  elsif p_kind in ('mc', 'multi') then
    v_p := public.quiz_perm(p_seed, jsonb_array_length(p_body->'opts'));
    return jsonb_build_object('q', p_body->'q',
      'opts', (select jsonb_agg(p_body->'opts'->x order by o) from unnest(v_p) with ordinality u(x, o)));
  elsif p_kind = 'who' then
    v_p := public.quiz_perm(p_seed, jsonb_array_length(p_body->'says'));
    return jsonb_build_object('q', p_body->'q',
      'says', (select jsonb_agg(p_body->'says'->x order by o) from unnest(v_p) with ordinality u(x, o)));
  elsif p_kind = 'order' then
    v_p := public.quiz_perm(p_seed, jsonb_array_length(p_body->'steps'));
    -- 洗完剛好是正確順序就轉一格，免得不用想就對了
    if v_p = (select array_agg(g) from generate_series(0, cardinality(v_p) - 1) g) then
      v_p := v_p[2:] || v_p[1];
    end if;
    return jsonb_build_object('q', p_body->'q',
      'steps', (select jsonb_agg(p_body->'steps'->x order by o) from unnest(v_p) with ordinality u(x, o)));
  elsif p_kind = 'cat' then
    v_p := public.quiz_perm(p_seed, jsonb_array_length(p_body->'cards'));
    return jsonb_build_object('q', p_body->'q', 'cats', p_body->'cats',
      'cards', (select jsonb_agg(p_body->'cards'->x->'t' order by o) from unnest(v_p) with ordinality u(x, o)));
  elsif p_kind = 'cloze' then
    for i in 0 .. jsonb_array_length(p_body->'blanks') - 1 loop
      v_b := p_body->'blanks'->i;
      v_p := public.quiz_perm(p_seed || ':b' || i, jsonb_array_length(v_b->'opts'));
      v_blanks := v_blanks || jsonb_build_array(
        (select jsonb_agg(v_b->'opts'->x order by o) from unnest(v_p) with ordinality u(x, o)));
    end loop;
    return jsonb_build_object('q', p_body->'q', 'text', p_body->'text', 'blanks', v_blanks);
  end if;
  return v_out;
end;
$$;

-- 把孩子的作答（顯示順序）換回原本的順序：顯示的第 k 個＝原本的 perm[k]
create or replace function public.quiz_orig(p_perm int[], p_shown int)
returns int language sql immutable set search_path = public, pg_temp as $$
  select case when p_shown between 0 and cardinality(p_perm) - 1 then p_perm[p_shown + 1] end;
$$;

-- 改一題：回傳 0～1
create or replace function public.quiz_grade(p_kind text, p_body jsonb, p_seed text, p_resp jsonb)
returns real language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_p int[]; v_n int; v_ok int := 0; i int; v_a int; v_pick int[]; v_right int[]; v_seq int[];
begin
  if p_resp is null or p_resp = 'null'::jsonb then return 0; end if;
  begin
    if p_kind = 'tf' then
      return case when jsonb_typeof(p_resp) = 'boolean' and p_resp = p_body->'a' then 1 else 0 end;
    elsif p_kind in ('mc', 'who') then
      v_p := public.quiz_perm(p_seed, jsonb_array_length(p_body->case when p_kind = 'mc' then 'opts' else 'says' end));
      return case when public.quiz_orig(v_p, (p_resp #>> '{}')::int) = (p_body->>'a')::int then 1 else 0 end;
    elsif p_kind = 'multi' then
      v_n := jsonb_array_length(p_body->'opts');
      v_p := public.quiz_perm(p_seed, v_n);
      select coalesce(array_agg(distinct public.quiz_orig(v_p, x::int)), '{}') into v_pick from jsonb_array_elements_text(p_resp) x;
      select coalesce(array_agg(x::int), '{}') into v_right from jsonb_array_elements_text(p_body->'a') x;
      for i in 0 .. v_n - 1 loop
        if (i = any(v_pick)) = (i = any(v_right)) then v_ok := v_ok + 1; end if;
      end loop;
      return v_ok::real / v_n;
    elsif p_kind = 'order' then
      v_n := jsonb_array_length(p_body->'steps');
      v_p := public.quiz_perm(p_seed, v_n);
      if v_p = (select array_agg(g) from generate_series(0, v_n - 1) g) then v_p := v_p[2:] || v_p[1]; end if;
      select array_agg(public.quiz_orig(v_p, x::int) order by o) into v_seq
        from jsonb_array_elements_text(p_resp) with ordinality e(x, o);
      if v_seq is null or cardinality(v_seq) <> v_n then return 0; end if;
      for i in 1 .. v_n - 1 loop
        if v_seq[i + 1] = v_seq[i] + 1 then v_ok := v_ok + 1; end if;
      end loop;
      -- 第一個也要對（不然整串往後挪一格也能拿到大部分分數）
      return case when v_seq[1] = 0 then (v_ok + 1)::real / v_n else v_ok::real / v_n end;
    elsif p_kind = 'cat' then
      v_n := jsonb_array_length(p_body->'cards');
      v_p := public.quiz_perm(p_seed, v_n);
      for i in 0 .. v_n - 1 loop
        if (p_resp->>i)::int = (p_body->'cards'->(v_p[i + 1])->>'c')::int then v_ok := v_ok + 1; end if;
      end loop;
      return v_ok::real / v_n;
    elsif p_kind = 'cloze' then
      v_n := jsonb_array_length(p_body->'blanks');
      for i in 0 .. v_n - 1 loop
        v_p := public.quiz_perm(p_seed || ':b' || i, jsonb_array_length(p_body->'blanks'->i->'opts'));
        if public.quiz_orig(v_p, (p_resp->>i)::int) = (p_body->'blanks'->i->>'a')::int then v_ok := v_ok + 1; end if;
      end loop;
      return v_ok::real / v_n;
    end if;
  exception when others then
    return 0;   -- 格式不對就當沒答
  end;
  return 0;
end;
$$;

-- 題目格式檢查：回傳問題清單（空的＝沒問題）。家長自己出題、匯入題庫都會跑。
create or replace function public.quiz_check(p_kind text, p_body jsonb)
returns text[] language plpgsql immutable set search_path = public, pg_temp as $$
declare v_err text[] := '{}'; v_n int; v_t text; i int; v_ids int[];
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' then return array['題目是空的']; end if;
  if char_length(coalesce(p_body->>'q', '')) < 4 then v_err := v_err || '題目太短'; end if;
  if char_length(coalesce(p_body->>'q', '')) > 160 then v_err := v_err || '題目太長（160 字內）'; end if;
  if char_length(coalesce(p_body->>'why', '')) < 6 then v_err := v_err || '要寫解析（為什麼）'; end if;
  if p_body->>'q' ~ '(以上皆是|以上皆非)' then v_err := v_err || '不要用「以上皆是／皆非」'; end if;
  if p_kind = 'tf' then
    if jsonb_typeof(p_body->'a') is distinct from 'boolean' then v_err := v_err || '是非題答案要是 true／false'; end if;
  elsif p_kind in ('mc', 'multi') then
    v_n := coalesce(jsonb_array_length(p_body->'opts'), 0);
    if v_n not between 3 and 5 then v_err := v_err || '選項要 3～5 個'; end if;
    if (select count(distinct x) from jsonb_array_elements_text(p_body->'opts') x) <> v_n then v_err := v_err || '選項重複'; end if;
    if exists (select 1 from jsonb_array_elements_text(p_body->'opts') x where btrim(x) = '' or x ~ '(以上皆是|以上皆非)') then
      v_err := v_err || '選項不能是空的或「以上皆是／皆非」';
    end if;
    if p_kind = 'mc' and not ((p_body->>'a') ~ '^\d+$' and (p_body->>'a')::int < v_n) then v_err := v_err || '答案要指到一個選項'; end if;
    if p_kind = 'multi' then
      select array_agg(x::int) into v_ids from jsonb_array_elements_text(p_body->'a') x where x ~ '^\d+$';
      if v_ids is null or cardinality(v_ids) < 2 or cardinality(v_ids) >= v_n
         or exists (select 1 from unnest(v_ids) x where x >= v_n) then
        v_err := v_err || '多選答案要 2 個以上、而且不能全選';
      end if;
    end if;
  elsif p_kind = 'who' then
    v_n := coalesce(jsonb_array_length(p_body->'says'), 0);
    if v_n not between 3 and 4 then v_err := v_err || '要 3～4 個人說話'; end if;
    if not ((p_body->>'a') ~ '^\d+$' and (p_body->>'a')::int < v_n) then v_err := v_err || '答案要指到一個人'; end if;
  elsif p_kind = 'order' then
    v_n := coalesce(jsonb_array_length(p_body->'steps'), 0);
    if v_n not between 3 and 5 then v_err := v_err || '排序要 3～5 個'; end if;
  elsif p_kind = 'cat' then
    v_n := coalesce(jsonb_array_length(p_body->'cats'), 0);
    if v_n not between 2 and 4 then v_err := v_err || '分類要 2～4 類'; end if;
    if coalesce(jsonb_array_length(p_body->'cards'), 0) not between 3 and 6 then v_err := v_err || '卡片要 3～6 張'; end if;
    if exists (select 1 from jsonb_array_elements(p_body->'cards') c where not ((c->>'c') ~ '^\d+$' and (c->>'c')::int < v_n)) then
      v_err := v_err || '每張卡都要指到一類';
    end if;
  elsif p_kind = 'cloze' then
    v_n := coalesce(jsonb_array_length(p_body->'blanks'), 0);
    if v_n not between 1 and 4 then v_err := v_err || '空格要 1～4 個'; end if;
    v_t := coalesce(p_body->>'text', '');
    for i in 0 .. v_n - 1 loop
      if position('{' || i || '}' in v_t) = 0 then v_err := v_err || ('短文裡少了 {' || i || '}'); end if;
      if coalesce(jsonb_array_length(p_body->'blanks'->i->'opts'), 0) not between 2 and 4
         or not ((p_body->'blanks'->i->>'a') ~ '^\d+$' and (p_body->'blanks'->i->>'a')::int < jsonb_array_length(p_body->'blanks'->i->'opts')) then
        v_err := v_err || ('第 ' || (i + 1) || ' 個空格的選項或答案不對');
      end if;
    end loop;
  else
    v_err := v_err || '沒有這種題型';
  end if;
  return v_err;
end;
$$;

-- ---------- 遊戲裡練過什麼 ----------
-- 玩過哪些地方（島嶼的章節／現在篇地點、時光祕境島的關卡）
create or replace function public.quiz_played(p_student uuid)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_out text[] := '{}'; v_more text[];
begin
  if to_regclass('public.island_saves') is not null then
    execute $q$
      select coalesce(array_agg(distinct p), '{}') from (
        select case when s.slot = 'world' then 'pro' else s.slot end p
          from public.island_saves s
         where s.student_id = $1
           and ((s.slot ~ '^(ch[1-7]|end)$' and (coalesce((s.data->>'reached')::int, 0) > 0 or (s.data->>'done')::boolean))
             or (s.slot = 'world' and (s.data->>'prologue')::boolean)
             or (s.slot = 'town' and s.data->'solved' <> '{}'::jsonb)
             or (s.slot = 'isles' and jsonb_array_length(coalesce(s.data->'stamps', '[]')) > 0)
             or (s.slot in ('sky', 'post', 'village')))
      ) x $q$ into v_more using p_student;
    v_out := v_out || v_more;
  end if;
  if to_regclass('public.animal_progress') is not null then
    execute $q$ select coalesce(array_agg('a-' || a.level), '{}') from public.animal_progress a
                 where a.student_id = $1 and (a.best_no > 1 or a.clears > 0) $q$ into v_more using p_student;
    v_out := v_out || v_more;
  end if;
  return v_out;
end;
$$;

-- 遊戲裡第一次就答對／答錯的知識點：島嶼的「想一想」、規則小鎮第一次就判對
create or replace function public.quiz_game(p_student uuid)
returns table (kp text, ok boolean, at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('public.island_saves') is null then return; end if;
  return query execute $q$
    select k.id, (s.data->'answers'->>((k.game->>'q')::int))::int = (k.game->>'a')::int, s.updated_at
      from public.quiz_kp k
      join public.island_saves s on s.student_id = $1 and s.slot = k.game->>'slot'
     where k.game->>'kind' = 'think'
       and coalesce((s.data->'answers'->>((k.game->>'q')::int))::int, -1) >= 0
    union all
    select k.id, s.data->'solved'->>(k.game->>'case') = '2', s.updated_at
      from public.quiz_kp k
      join public.island_saves s on s.student_id = $1 and s.slot = 'town'
     where k.game->>'kind' = 'town' and s.data->'solved' ? (k.game->>'case') $q$ using p_student;
end;
$$;

-- ---------- 老師／家長 ----------
create or replace function public.quiz_require_class(p_code text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.park_require_staff();
  if not public.is_teacher_of(p_code) then raise exception '只能看自己的班'; end if;
end;
$$;

-- 題庫：知識點＋可以抽的題目（審過的＋這個班自己出的），老師看得到答案
create or replace function public.park_quiz_bank(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.quiz_require_class(p_code);
  return jsonb_build_object(
    'kps', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'subject', k.subject, 'place', k.place, 'name', k.name,
                                                          'book', k.book, 'game', k.game is not null) order by k.sort, k.id)
                       from public.quiz_kp k where k.subject <> 'eng'), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kp', i.kp, 'kind', i.kind, 'level', i.level,
                                                            'body', i.body, 'src', i.src, 'ver', i.ver, 'own', i.status = 'own')
                                         order by i.id)
                         from public.quiz_item i
                        where i.status = 'live' or (i.status = 'own' and i.owner_class = p_code)), '[]'));
end;
$$;

-- 全班的學習狀況原始資料（網頁算「學會／待加強／玩過／沒玩過」，規則見 js/quiz-core.js）
create or replace function public.park_quiz_class(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.quiz_require_class(p_code);
  return jsonb_build_object(
    'kind', coalesce((select s.kind from public.park_class_settings s where s.class_code = p_code), 'school'),
    'kids', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'nickname', st.nickname,
               'played', public.quiz_played(st.id),
               'game', coalesce((select jsonb_agg(jsonb_build_array(g.kp, g.ok, g.at)) from public.quiz_game(st.id) g), '[]'),
               'ans', coalesce((select jsonb_agg(jsonb_build_array(a.kp, a.item, a.got, a.at, a.ms) order by a.at)
                                  from public.quiz_answer a where a.student = st.id), '[]'),
               'marks', coalesce((select jsonb_object_agg(m.kp, m.at) from public.quiz_kp_mark m where m.student = st.id), '{}'))
             order by st.nickname)
        from public.park_class_members m
        join public.students st on st.id = m.student_id
       where m.class_code = p_code), '[]'));
end;
$$;

-- 出一張卷。p_plan＝[{student, items:[{item, bucket}]}]（每個孩子可以不同題）。會寄一封信鴿信給這些孩子。
create or replace function public.park_quiz_create(p_code text, p_title text, p_plan jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_kid jsonb; v_n int; v_kids uuid[] := '{}'; v_sid uuid; i int; v_item text; v_ver int;
  v_name text := coalesce((select t.display_name from public.teachers t where t.user_id = auth.uid()), '');
begin
  perform public.quiz_require_class(p_code);
  if btrim(coalesce(p_title, '')) = '' then raise exception '試煉卷要有名字'; end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'array' or jsonb_array_length(p_plan) = 0 then raise exception '要選孩子'; end if;
  if (select count(*) from public.quiz_paper p where p.class_code = p_code and p.created_at > now() - interval '1 day') >= 20 then
    raise exception '一天最多出 20 張卷';
  end if;
  select max(jsonb_array_length(k->'items')) into v_n from jsonb_array_elements(p_plan) k;
  if v_n is null or v_n < 1 or v_n > 30 then raise exception '一張卷 1～30 題'; end if;
  insert into public.quiz_paper (class_code, created_by, by_name, title, n)
  values (p_code, auth.uid(), v_name, left(btrim(p_title), 30), v_n) returning id into v_id;
  for v_kid in select * from jsonb_array_elements(p_plan) loop
    v_sid := (v_kid->>'student')::uuid;
    if not exists (select 1 from public.park_class_members m where m.class_code = p_code and m.student_id = v_sid) then
      raise exception '有孩子不在這個班';
    end if;
    if jsonb_array_length(v_kid->'items') <> v_n then raise exception '同一張卷每個孩子的題數要一樣'; end if;
    for i in 0 .. v_n - 1 loop
      v_item := v_kid->'items'->i->>'item';
      select q.ver into v_ver from public.quiz_item q
       where q.id = v_item and (q.status = 'live' or (q.status = 'own' and q.owner_class = p_code));
      if v_ver is null then raise exception '有題目不能用（可能被停用了），重新挑一次'; end if;
      insert into public.quiz_slot (paper, student, pos, item, ver, bucket)
      values (v_id, v_sid, i, v_item, v_ver, left(coalesce(v_kid->'items'->i->>'bucket', ''), 10));
    end loop;
    v_kids := v_kids || v_sid;
  end loop;
  insert into public.park_news (kinds, title, body, link, classes, students, sign, ends_on, author, author_name)
  values (array['letter'], '新的試煉卷來了', '「' || left(btrim(p_title), 30) || '」共 ' || v_n || ' 題。到時光試煉島作答，'
          || '分數越高拿到的時光幣越多；寫錯的可以訂正。', 'quiz', array[p_code], v_kids, '貓頭鷹考官',
          public.park_today() + 30, null, '時光試煉島');
  perform public.park_log('quiz_create', p_code, v_id::text, jsonb_build_object('n', v_n, 'kids', cardinality(v_kids)));
  return v_id;
end;
$$;

-- 家長自己出一題（只在自己班用）
create or replace function public.park_quiz_add_own(p_code text, p_kp text, p_kind text, p_body jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_err text[]; v_id text;
begin
  perform public.quiz_require_class(p_code);
  if not exists (select 1 from public.quiz_kp k where k.id = p_kp) then raise exception '找不到這個知識點'; end if;
  if p_kind not in ('tf', 'mc') then raise exception '自己出題先支援是非和單選'; end if;
  v_err := public.quiz_check(p_kind, p_body);
  if cardinality(v_err) > 0 then raise exception '%', array_to_string(v_err, '、'); end if;
  if (select count(*) from public.quiz_item i where i.owner_class = p_code) >= 300 then raise exception '一個班最多自己出 300 題'; end if;
  v_id := 'own-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into public.quiz_item (id, kp, kind, level, body, src, status, owner_class, owner)
  values (v_id, p_kp, p_kind, 1,
          jsonb_strip_nulls(jsonb_build_object('q', left(p_body->>'q', 160), 'opts', p_body->'opts', 'a', p_body->'a', 'why', left(p_body->>'why', 200))),
          '家長／老師自己出的題目', 'own', p_code, auth.uid());
  return v_id;
end;
$$;

-- 這個班出過的卷，每個孩子做到哪
-- 出過的卷。另外列出：這個班裡「我是監護人」的孩子在別的班寫過的卷（只能看；2026-10-30 Chuck 定：家長看得到老師的卷、
-- 老師看不到家長的；監護人關係見 park_parent.sql，補習班開的家庭班不是監護人就看不到）
create or replace function public.quiz_is_home(p_code text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select kind = 'home' from public.park_class_settings where class_code = p_code), false);
$$;

create or replace function public.park_quiz_papers(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.quiz_require_class(p_code);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'title', p.title, 'n', p.n, 'by', p.by_name, 'at', p.created_at,
             'readonly', p.class_code <> p_code,
             'from', case when p.class_code <> p_code then (select c.name from public.classes c where c.code = p.class_code) end,
             'kids', (select jsonb_agg(jsonb_build_object('id', k.student, 'nickname', st.nickname,
                                                          'opened', t.opened_at, 'done', t.submitted_at, 'score', t.score,
                                                          'coins', coalesce(t.coins, 0), 'fixed', t.fixed_at) order by st.nickname)
                        from (select distinct s.student from public.quiz_slot s where s.paper = p.id
                                and (p.class_code = p_code
                                     or (public.park_is_guardian(s.student)
                                         and s.student in (select m.student_id from public.park_class_members m where m.class_code = p_code)))) k
                        join public.students st on st.id = k.student
                        left join public.quiz_take t on t.paper = p.id and t.student = k.student))
           order by p.created_at desc)
      from public.quiz_paper p
     where p.hidden_at is null
       and (p.class_code = p_code
            or exists (select 1 from public.quiz_slot s join public.park_class_members m on m.student_id = s.student
                        where s.paper = p.id and m.class_code = p_code and public.park_is_guardian(s.student)))), '[]');
end;
$$;

-- 一張卷的分析：每個孩子每一題怎麼答（含題目、答案、解析）。網頁再對照遊戲紀錄。
-- p_via＝從自己的哪個班來看別班的卷：只看得到那個班裡、自己是監護人的孩子
drop function if exists public.park_quiz_report(uuid);
create or replace function public.park_quiz_report(p_paper uuid, p_via text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_p public.quiz_paper; v_only text;
begin
  select * into v_p from public.quiz_paper where id = p_paper;
  if v_p.id is null then raise exception '找不到這張卷'; end if;
  perform public.park_require_staff();
  if public.is_teacher_of(v_p.class_code) then v_only := null;
  elsif p_via is not null and public.is_teacher_of(p_via) and exists (
          select 1 from public.quiz_slot s join public.park_class_members m on m.student_id = s.student
           where s.paper = p_paper and m.class_code = p_via and public.park_is_guardian(s.student)) then v_only := p_via;
  else raise exception '只能看自己的班';
  end if;
  return jsonb_build_object(
    'id', v_p.id, 'title', v_p.title, 'n', v_p.n, 'at', v_p.created_at, 'class', v_p.class_code, 'readonly', v_only is not null,
    'kids', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.student, 'nickname', st.nickname, 'score', t.score, 'done', t.submitted_at, 'fixed', t.fixed_at,
               'coins', coalesce(t.coins, 0) + coalesce(t.fix_coins, 0),
               'slots', (select jsonb_agg(jsonb_build_object(
                                  'pos', s.pos, 'item', s.item, 'bucket', s.bucket, 'kp', q.kp, 'kind', q.kind, 'body', q.body,
                                  'show', public.quiz_public(q.kind, q.body, p_paper::text || ':' || s.student || ':' || s.pos),
                                  'key', public.quiz_key(q.kind, q.body, p_paper::text || ':' || s.student || ':' || s.pos),
                                  'resp', a.resp, 'got', a.got, 'ms', a.ms, 'fix', f.got) order by s.pos)
                           from public.quiz_slot s
                           join public.quiz_item q on q.id = s.item
                           left join public.quiz_answer a on a.paper = s.paper and a.student = s.student and a.pos = s.pos and not a.fix
                           left join public.quiz_answer f on f.paper = s.paper and f.student = s.student and f.pos = s.pos and f.fix
                          where s.paper = p_paper and s.student = k.student))
             order by st.nickname)
        from (select distinct s.student from public.quiz_slot s where s.paper = p_paper
                and (v_only is null or (public.park_is_guardian(s.student)
                                        and s.student in (select m.student_id from public.park_class_members m where m.class_code = v_only)))) k
        join public.students st on st.id = k.student
        left join public.quiz_take t on t.paper = p_paper and t.student = k.student), '[]'));
end;
$$;

-- 收回一張卷（還沒寫的孩子就看不到了；寫過的成績留著）
create or replace function public.park_quiz_hide(p_paper uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  select class_code into v_code from public.quiz_paper where id = p_paper;
  perform public.quiz_require_class(v_code);
  update public.quiz_paper set hidden_at = now() where id = p_paper;
end;
$$;

-- 家長把某個知識點改回「要加強」：之前答對的不算學會，之後的出題會再出
create or replace function public.park_quiz_mark(p_code text, p_student uuid, p_kp text, p_on boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.quiz_require_class(p_code);
  if not exists (select 1 from public.park_class_members m where m.class_code = p_code and m.student_id = p_student) then
    raise exception '這個孩子不在這個班';
  end if;
  if p_on then
    insert into public.quiz_kp_mark (student, kp, by_user) values (p_student, p_kp, auth.uid())
    on conflict (student, kp) do update set at = now(), by_user = auth.uid();
  else
    delete from public.quiz_kp_mark where student = p_student and kp = p_kp;
  end if;
end;
$$;

-- 「推薦去玩」：寄一封信鴿信給一個孩子，帶他去那座島
create or replace function public.park_quiz_recommend(p_code text, p_student uuid, p_body text, p_zone text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  perform public.quiz_require_class(p_code);
  if not exists (select 1 from public.park_class_members m where m.class_code = p_code and m.student_id = p_student) then
    raise exception '這個孩子不在這個班';
  end if;
  if p_zone is not null and not exists (select 1 from public.park_zones z where z.code = p_zone) then raise exception '沒有這座島'; end if;
  insert into public.park_news (kinds, title, body, link, classes, students, sign, ends_on, author, author_name)
  values (array['letter'], '考官推薦你去玩', left(coalesce(p_body, ''), 400),
          case when p_zone is not null then 'zone:' || p_zone end, array[p_code], array[p_student],
          '貓頭鷹考官', public.park_today() + 14, null, '時光試煉島')
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- 孩子 ----------
-- 我的試煉卷
create or replace function public.park_quiz_mine()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then return '[]'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'title', p.title, 'n', p.n, 'by', p.by_name, 'at', p.created_at,
             'opened', t.opened_at is not null, 'done', t.submitted_at is not null, 'score', t.score,
             'coins', coalesce(t.coins, 0) + coalesce(t.fix_coins, 0), 'fixed', t.fixed_at is not null,
             'wrong', (select count(*) from public.quiz_answer a where a.paper = p.id and a.student = v_me and not a.fix and a.got < 1))
           order by (t.submitted_at is not null), p.created_at desc)
      from public.quiz_paper p
      left join public.quiz_take t on t.paper = p.id and t.student = v_me
     where exists (select 1 from public.quiz_slot s where s.paper = p.id and s.student = v_me)
       and (p.hidden_at is null or t.submitted_at is not null)
       and p.created_at > now() - interval '180 days'), '[]');
end;
$$;

-- 打開一張卷：還沒交＝題目（沒有答案）；交了＝每題的對錯、正確答案、解析（給訂正和看結果）
create or replace function public.park_quiz_open(p_paper uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_p public.quiz_paper; v_t public.quiz_take;
begin
  if v_me is null then raise exception '要先登入'; end if;
  select * into v_p from public.quiz_paper where id = p_paper;
  if v_p.id is null or not exists (select 1 from public.quiz_slot s where s.paper = p_paper and s.student = v_me) then
    raise exception '找不到這張試煉卷';
  end if;
  insert into public.quiz_take (paper, student, opened_at) values (p_paper, v_me, now())
  on conflict (paper, student) do update set opened_at = coalesce(quiz_take.opened_at, now());
  select * into v_t from public.quiz_take where paper = p_paper and student = v_me;
  if v_t.submitted_at is null and v_p.hidden_at is not null then raise exception '這張卷已經收回了'; end if;
  return jsonb_build_object(
    'id', v_p.id, 'title', v_p.title, 'n', v_p.n, 'by', v_p.by_name,
    'done', v_t.submitted_at is not null, 'score', v_t.score, 'coins', v_t.coins, 'fix_coins', v_t.fix_coins,
    'fixed', v_t.fixed_at is not null,
    'items', (select jsonb_agg(
                jsonb_build_object('pos', s.pos, 'kind', q.kind,
                                   'show', public.quiz_public(q.kind, q.body, p_paper::text || ':' || v_me || ':' || s.pos))
                || case when v_t.submitted_at is null then '{}'::jsonb else jsonb_build_object(
                     'resp', a.resp, 'got', a.got, 'fix', f.resp, 'fix_got', f.got,
                     'key', public.quiz_key(q.kind, q.body, p_paper::text || ':' || v_me || ':' || s.pos),
                     'why', q.body->'why') end
                order by s.pos)
                from public.quiz_slot s
                join public.quiz_item q on q.id = s.item
                left join public.quiz_answer a on a.paper = s.paper and a.student = s.student and a.pos = s.pos and not a.fix
                left join public.quiz_answer f on f.paper = s.paper and f.student = s.student and f.pos = s.pos and f.fix
               where s.paper = p_paper and s.student = v_me));
end;
$$;

-- 正確答案（顯示順序），交卷後才給
create or replace function public.quiz_key(p_kind text, p_body jsonb, p_seed text)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare v_p int[]; v_n int; v_out jsonb := '[]'; i int;
begin
  if p_kind = 'tf' then return p_body->'a';
  elsif p_kind in ('mc', 'who') then
    v_p := public.quiz_perm(p_seed, jsonb_array_length(p_body->case when p_kind = 'mc' then 'opts' else 'says' end));
    return to_jsonb(array_position(v_p, (p_body->>'a')::int) - 1);
  elsif p_kind = 'multi' then
    v_p := public.quiz_perm(p_seed, jsonb_array_length(p_body->'opts'));
    return (select jsonb_agg(array_position(v_p, x::int) - 1 order by array_position(v_p, x::int))
              from jsonb_array_elements_text(p_body->'a') x);
  elsif p_kind = 'order' then
    v_n := jsonb_array_length(p_body->'steps');
    v_p := public.quiz_perm(p_seed, v_n);
    if v_p = (select array_agg(g) from generate_series(0, v_n - 1) g) then v_p := v_p[2:] || v_p[1]; end if;
    return (select jsonb_agg(array_position(v_p, g) - 1 order by g) from generate_series(0, v_n - 1) g);
  elsif p_kind = 'cat' then
    v_p := public.quiz_perm(p_seed, jsonb_array_length(p_body->'cards'));
    return (select jsonb_agg((p_body->'cards'->x->>'c')::int order by o) from unnest(v_p) with ordinality u(x, o));
  elsif p_kind = 'cloze' then
    for i in 0 .. jsonb_array_length(p_body->'blanks') - 1 loop
      v_p := public.quiz_perm(p_seed || ':b' || i, jsonb_array_length(p_body->'blanks'->i->'opts'));
      v_out := v_out || to_jsonb(array_position(v_p, (p_body->'blanks'->i->>'a')::int) - 1);
    end loop;
    return v_out;
  end if;
  return null;
end;
$$;

-- 這張卷該拿幾個幣（不看每週上限）
create or replace function public.quiz_coins(p_score int, p_n int)
returns int language sql immutable set search_path = public, pg_temp as $$
  select case when p_n < 5 then 0 else
    round((case when p_score >= 100 then 30 when p_score >= 80 then 20 when p_score >= 60 then 10 else 5 end)
          * (case when p_n >= 30 then 2 when p_n >= 20 then 1.5 else 1 end))::int end;
$$;

-- 交卷：p_resp＝[{pos, resp, ms}]。只能交一次。回傳 {score, coins, capped}
create or replace function public.park_quiz_submit(p_paper uuid, p_resp jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := public.current_student_id(); v_t public.quiz_take; s record; v_r jsonb; v_got real; v_sum real := 0; v_n int := 0;
  v_score int; v_coins int := 0; v_capped boolean := false; v_title text;
begin
  if v_me is null then raise exception '要先登入'; end if;
  select * into v_t from public.quiz_take where paper = p_paper and student = v_me for update;
  if v_t.paper is null then raise exception '要先打開試煉卷'; end if;
  if v_t.submitted_at is not null then raise exception '這張卷已經交過了'; end if;
  if exists (select 1 from public.quiz_paper p where p.id = p_paper and p.hidden_at is not null) then raise exception '這張卷已經收回了'; end if;
  for s in select sl.pos, sl.item, sl.ver, q.kind, q.body, q.kp
             from public.quiz_slot sl join public.quiz_item q on q.id = sl.item
            where sl.paper = p_paper and sl.student = v_me order by sl.pos loop
    select x into v_r from jsonb_array_elements(coalesce(p_resp, '[]')) x where (x->>'pos')::int = s.pos limit 1;
    v_got := public.quiz_grade(s.kind, s.body, p_paper::text || ':' || v_me || ':' || s.pos, v_r->'resp');
    insert into public.quiz_answer (paper, student, pos, fix, item, kp, ver, resp, got, ms)
    values (p_paper, v_me, s.pos, false, s.item, s.kp, s.ver, v_r->'resp', v_got,
            least(greatest(coalesce((v_r->>'ms')::int, 0), 0), 3600000));
    v_sum := v_sum + v_got; v_n := v_n + 1;
  end loop;
  v_score := case when v_n = 0 then 0 else round(100 * v_sum / v_n)::int end;
  -- 一週最多 3 張卷給幣
  if (select count(*) from public.park_coin_ledger l
       where l.student_id = v_me and l.source ~ '^quiz:[0-9a-f-]+$' and l.created_at >= public.park_week_start()) >= 3 then
    v_capped := true;
  else
    select title into v_title from public.quiz_paper where id = p_paper;
    v_coins := public.park_coin_grant(v_me, 'quiz:' || p_paper, public.quiz_coins(v_score, v_n), 'quiz',
                                      '試煉卷「' || v_title || '」' || v_score || ' 分');
  end if;
  update public.quiz_take set submitted_at = now(), score = v_score, coins = v_coins where paper = p_paper and student = v_me;
  perform public.park_stamp_sync(v_me);
  return jsonb_build_object('score', v_score, 'coins', v_coins, 'capped', v_capped);
end;
$$;

-- 訂正：只改錯的題。全部改對 +5（一張卷一次）。可以訂正很多次，記最後一次。
create or replace function public.park_quiz_fix(p_paper uuid, p_resp jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := public.current_student_id(); v_t public.quiz_take; s record; v_r jsonb; v_got real; v_all boolean; v_coins int := 0;
begin
  if v_me is null then raise exception '要先登入'; end if;
  select * into v_t from public.quiz_take where paper = p_paper and student = v_me for update;
  if v_t.submitted_at is null then raise exception '要先交卷才能訂正'; end if;
  for s in select a.pos, a.item, a.ver, a.kp, q.kind, q.body
             from public.quiz_answer a join public.quiz_item q on q.id = a.item
            where a.paper = p_paper and a.student = v_me and not a.fix and a.got < 1 order by a.pos loop
    -- 只改這次有送來的題（第二次訂正只送還沒改對的；之前改對的不能被蓋掉）
    v_r := null;
    select x into v_r from jsonb_array_elements(coalesce(p_resp, '[]')) x where (x->>'pos')::int = s.pos limit 1;
    if v_r is null then continue; end if;
    v_got := public.quiz_grade(s.kind, s.body, p_paper::text || ':' || v_me || ':' || s.pos, v_r->'resp');
    insert into public.quiz_answer (paper, student, pos, fix, item, kp, ver, resp, got, ms)
    values (p_paper, v_me, s.pos, true, s.item, s.kp, s.ver, v_r->'resp', v_got, (v_r->>'ms')::int)
    on conflict (paper, student, pos, fix) do update set resp = excluded.resp, got = excluded.got, ms = excluded.ms, at = now();
  end loop;
  -- 全對＝原本錯的每一題，訂正紀錄都是對的
  v_all := not exists (select 1 from public.quiz_answer a
                        where a.paper = p_paper and a.student = v_me and not a.fix and a.got < 1
                          and not exists (select 1 from public.quiz_answer f where f.paper = a.paper and f.student = a.student
                                                                        and f.pos = a.pos and f.fix and f.got >= 1));
  if v_all then
    v_coins := public.park_coin_grant(v_me, 'quizfix:' || p_paper, 5, 'quiz', '試煉卷訂正全對');
    update public.quiz_take set fixed_at = coalesce(fixed_at, now()), fix_coins = fix_coins + v_coins where paper = p_paper and student = v_me;
    perform public.park_stamp_sync(v_me);
  end if;
  return jsonb_build_object('all', v_all, 'coins', v_coins);
end;
$$;

-- 這題怪怪的
create or replace function public.park_quiz_flag(p_paper uuid, p_pos int, p_note text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_s public.quiz_slot;
begin
  if v_me is null then raise exception '要先登入'; end if;
  select * into v_s from public.quiz_slot where paper = p_paper and student = v_me and pos = p_pos;
  if v_s.item is null then return false; end if;
  if exists (select 1 from public.quiz_flag f where f.item = v_s.item and f.student = v_me and f.paper = p_paper) then return true; end if;
  insert into public.quiz_flag (item, ver, student, paper, note) values (v_s.item, v_s.ver, v_me, p_paper, left(coalesce(p_note, ''), 200));
  return true;
end;
$$;

-- ---------- 管理員：題庫審核 ----------
create or replace function public.park_quiz_admin_bank()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception '只有管理員可以審題'; end if;
  return jsonb_build_object(
    'kps', coalesce((select jsonb_agg(to_jsonb(k) order by k.sort, k.id) from public.quiz_kp k), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', i.id, 'kp', i.kp, 'kind', i.kind, 'level', i.level, 'body', i.body, 'src', i.src, 'ver', i.ver,
                         'status', i.status, 'note', i.note, 'reviewed_at', i.reviewed_at,
                         'check', public.quiz_check(i.kind, i.body),
                         'used', (select count(*) from public.quiz_answer a where a.item = i.id and not a.fix),
                         'right', (select round(100 * avg(a.got))::int from public.quiz_answer a where a.item = i.id and not a.fix),
                         'flags', (select count(*) from public.quiz_flag f where f.item = i.id and f.status = 'open'))
                       order by i.id)
                       from public.quiz_item i where i.status <> 'own'), '[]'),
    'flags', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'item', f.item, 'ver', f.ver, 'note', f.note, 'at', f.at,
                                                            'nickname', st.nickname) order by f.at desc)
                         from public.quiz_flag f left join public.students st on st.id = f.student
                        where f.status = 'open'), '[]'));
end;
$$;

-- 審題：p_status live／off／draft；p_body 有給就改內容（ver +1）
create or replace function public.park_quiz_review(p_item text, p_status text, p_body jsonb default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_i public.quiz_item; v_err text[];
begin
  if not public.is_admin() then raise exception '只有管理員可以審題'; end if;
  select * into v_i from public.quiz_item where id = p_item for update;
  if v_i.id is null or v_i.status = 'own' then raise exception '找不到這一題'; end if;
  if p_status not in ('live', 'off', 'draft') then raise exception '狀態不對'; end if;
  if p_body is not null and p_body <> v_i.body then
    v_err := public.quiz_check(v_i.kind, p_body);
    if cardinality(v_err) > 0 then raise exception '%', array_to_string(v_err, '、'); end if;
    update public.quiz_item set body = p_body, ver = ver + 1 where id = p_item;
  end if;
  if p_status = 'live' and cardinality(public.quiz_check(v_i.kind, coalesce(p_body, v_i.body))) > 0 then
    raise exception '這題格式還有問題，不能上架';
  end if;
  update public.quiz_item set status = p_status, note = coalesce(p_note, note),
         reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = p_item;
  perform public.park_log('quiz_review', null, p_item, jsonb_build_object('status', p_status));
  select * into v_i from public.quiz_item where id = p_item;
  return to_jsonb(v_i);
end;
$$;

-- 處理「這題怪怪的」：p_wrong＝真的錯了 → 題目停用，這一版答過的人全部算對、補分補幣
create or replace function public.park_quiz_flag_done(p_id bigint, p_wrong boolean)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.quiz_flag; t record; v_new int; v_more int; v_n int := 0;
begin
  if not public.is_admin() then raise exception '只有管理員可以處理'; end if;
  select * into v_f from public.quiz_flag where id = p_id;
  if v_f.id is null then raise exception '找不到這筆'; end if;
  if not p_wrong then
    update public.quiz_flag set status = 'ok', done_by = auth.uid(), done_at = now() where id = p_id;
    return 0;
  end if;
  update public.quiz_item set status = 'off', note = '有孩子回報題目有誤，已停用', updated_at = now() where id = v_f.item;
  update public.quiz_flag set status = 'wrong', done_by = auth.uid(), done_at = now() where item = v_f.item and status = 'open';
  for t in select distinct a.paper, a.student from public.quiz_answer a
            where a.item = v_f.item and a.ver = v_f.ver and not a.fix and a.got < 1 loop
    update public.quiz_answer set got = 1 where paper = t.paper and student = t.student and item = v_f.item and not fix;
    select round(100 * avg(a.got))::int into v_new from public.quiz_answer a where a.paper = t.paper and a.student = t.student and not a.fix;
    update public.quiz_take k set score = v_new where k.paper = t.paper and k.student = t.student;
    -- 本來有拿幣的才補差額（被每週上限擋掉的維持不給）
    if exists (select 1 from public.park_coin_ledger l where l.student_id = t.student and l.source = 'quiz:' || t.paper) then
      v_more := public.quiz_coins(v_new, (select count(*) from public.quiz_slot s where s.paper = t.paper and s.student = t.student)::int)
                - (select coalesce(sum(l.amount), 0) from public.park_coin_ledger l
                    where l.student_id = t.student and l.source like 'quiz:' || t.paper || '%')::int;
      if v_more > 0 then
        perform public.park_coin_grant(t.student, 'quiz:' || t.paper || ':fix' || p_id, v_more, 'quiz', '題目有誤，補發時光幣');
        update public.quiz_take k set coins = coins + v_more where k.paper = t.paper and k.student = t.student;
      end if;
    end if;
    v_n := v_n + 1;
  end loop;
  perform public.park_log('quiz_void', null, v_f.item, jsonb_build_object('ver', v_f.ver, 'kids', v_n));
  return v_n;
end;
$$;

-- ---------- 護照勳章（時光試煉島一頁） ----------
insert into public.park_facilities (code, zone, name, status, description, sort)
values ('quiz', 'village', '時光試煉島', 'open', '家長和老師出的試煉卷。不在樂園地圖上，從信鴿信或 /quiz/ 進去。', 9)
on conflict (code) do update set name = excluded.name, description = excluded.description;

create or replace function public.quiz_earned_stamps(p_student uuid)
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  select 'first' where exists (select 1 from public.quiz_take t where t.student = p_student and t.submitted_at is not null)
  union all
  select 'perfect' where exists (select 1 from public.quiz_take t
                                  join public.quiz_paper p on p.id = t.paper
                                 where t.student = p_student and t.score = 100 and p.n >= 10)
  union all
  select 'fixer' where (select count(*) from public.quiz_take t where t.student = p_student and t.fixed_at is not null) >= 3
  union all
  select 'weeks' where exists (
    select 1 from (select distinct date_trunc('week', t.submitted_at at time zone 'Asia/Taipei') w
                     from public.quiz_take t where t.student = p_student and t.submitted_at is not null) a
     where exists (select 1 from public.quiz_take t where t.student = p_student and t.submitted_at is not null
                      and date_trunc('week', t.submitted_at at time zone 'Asia/Taipei') = a.w + interval '1 week')
       and exists (select 1 from public.quiz_take t where t.student = p_student and t.submitted_at is not null
                      and date_trunc('week', t.submitted_at at time zone 'Asia/Taipei') = a.w + interval '2 week'))
  union all
  select 'keeper' where (
    select count(*) from (select a.kp from public.quiz_answer a
                           where a.student = p_student and a.got = 1 and not a.fix
                           group by a.kp having count(distinct (a.at at time zone 'Asia/Taipei')::date) >= 2) x) >= 20;
$$;
update public.park_facilities set stamps_fn = 'quiz_earned_stamps' where code = 'quiz';

insert into public.park_stamps (facility, code, name, hint, art, sort, kind, rarity) values
  ('quiz', 'first',   '第一張試煉卷', '寫完第一張試煉卷',                     'img/stamp/quiz-first.webp',   1, 'clear',   'bronze'),
  ('quiz', 'perfect', '滿分試煉',     '10 題以上的試煉卷拿到 100 分',          'img/stamp/quiz-perfect.webp', 2, 'master',  'silver'),
  ('quiz', 'fixer',   '訂正達人',     '3 張試煉卷訂正全部改對',                'img/stamp/quiz-fixer.webp',   3, 'collect', 'bronze'),
  ('quiz', 'weeks',   '連續三週',     '連續三個星期都寫完試煉卷',              'img/stamp/quiz-weeks.webp',   4, 'collect', 'gold'),
  ('quiz', 'keeper',  '知識守門員',   '20 個知識點在不同的兩天都答對',          'img/stamp/quiz-keeper.webp',  5, 'master',  'rainbow')
on conflict (facility, code) do update set name = excluded.name, hint = excluded.hint, art = excluded.art,
  sort = excluded.sort, kind = excluded.kind, rarity = excluded.rarity;

-- ---------- 權限 ----------
revoke all on function
  public.quiz_perm(text, int), public.quiz_public(text, jsonb, text), public.quiz_orig(int[], int),
  public.quiz_grade(text, jsonb, text, jsonb), public.quiz_check(text, jsonb), public.quiz_key(text, jsonb, text),
  public.quiz_coins(int, int), public.quiz_played(uuid), public.quiz_game(uuid), public.quiz_require_class(text),
  public.quiz_earned_stamps(uuid),
  public.park_quiz_bank(text), public.park_quiz_class(text), public.park_quiz_create(text, text, jsonb),
  public.park_quiz_add_own(text, text, text, jsonb), public.park_quiz_papers(text), public.park_quiz_report(uuid, text),
  public.park_quiz_hide(uuid), public.park_quiz_mark(text, uuid, text, boolean), public.park_quiz_recommend(text, uuid, text, text),
  public.park_quiz_mine(), public.park_quiz_open(uuid), public.park_quiz_submit(uuid, jsonb), public.park_quiz_fix(uuid, jsonb),
  public.park_quiz_flag(uuid, int, text), public.park_quiz_admin_bank(), public.park_quiz_review(text, text, jsonb, text),
  public.park_quiz_flag_done(bigint, boolean)
from public, anon;
grant execute on function
  public.park_quiz_bank(text), public.park_quiz_class(text), public.park_quiz_create(text, text, jsonb),
  public.park_quiz_add_own(text, text, text, jsonb), public.park_quiz_papers(text), public.park_quiz_report(uuid, text),
  public.park_quiz_hide(uuid), public.park_quiz_mark(text, uuid, text, boolean), public.park_quiz_recommend(text, uuid, text, text),
  public.park_quiz_mine(), public.park_quiz_open(uuid), public.park_quiz_submit(uuid, jsonb), public.park_quiz_fix(uuid, jsonb),
  public.park_quiz_flag(uuid, int, text), public.park_quiz_admin_bank(), public.park_quiz_review(text, text, jsonb, text),
  public.park_quiz_flag_done(bigint, boolean)
to authenticated;
revoke all on function public.quiz_earned_stamps(uuid), public.quiz_played(uuid), public.quiz_game(uuid) from authenticated;
revoke all on function public.quiz_is_home(text) from public, anon, authenticated;
