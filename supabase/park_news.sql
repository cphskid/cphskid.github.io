-- =============================================================================
-- 時空冒險樂園：樂園公告（2026-10-24「設計樂園登入後的公告方式」）
-- =============================================================================
--
-- 一則公告寫一次，發的人勾要用哪幾種方式出現（kinds，可以同時勾好幾種）：
--   board    📌 村莊布告欄：貼在樂園村莊，村莊亮紅點
--   flag     🚩 島嶼布條＋紅點：掛在 zones 選的島上，孩子進那座島玩過就收
--   balloon  🎈 熱氣球布條：天上飄過一次
--   letter   ✉️ 信差來信：信鴿送到名牌旁邊，看完收進信箱
-- 管理員四種都能用、可以發全站或指定班；老師只能用 letter，而且只能寄給自己（任何一班）的班。
--
--   park_news_mine()                 地圖要的：現在該出現的公告＋我看過哪些（沒登入只回全站的布告欄）
--   park_news_seen(id, parts)        學生看過了（parts：board / flag / balloon / letter）
--   park_news_post(...)              發公告（管理員、老師）
--   park_news_list()                 後台列表（管理員看全部、老師看自己發的），附幾個人看過
--   park_news_hide(id)               撤回（發的人或管理員）
--
-- 套用順序：schema.sql → park_accounts.sql → park_teacher.sql → 這份（之後重跑都可以）

create table if not exists public.park_news (
  id          bigint generated always as identity primary key,
  kinds       text[] not null check (kinds <@ array['board', 'flag', 'balloon', 'letter'] and cardinality(kinds) > 0),
  title       text not null check (char_length(title) between 1 and 40),
  body        text not null default '' check (char_length(body) <= 400),
  banner      text check (char_length(banner) <= 14),            -- 布條、熱氣球上的字；沒填用標題
  link        text check (char_length(link) <= 60),              -- 「去看看」帶去哪：shop-month、zone:<島>、repair、wear、pet
  zones       text[] not null default '{}',                      -- flag 掛在哪幾座島（park_zones.code）
  classes     text[],                                            -- null＝全站；有值＝只給這些班
  sign        text check (char_length(sign) <= 20),              -- 信的署名
  important   boolean not null default false,                    -- 信：第一次登入自動打開一次
  starts_on   date not null default ((now() at time zone 'Asia/Taipei')::date),
  ends_on     date not null,
  author      uuid,
  author_name text not null default '',
  created_at  timestamptz not null default now(),
  hidden_at   timestamptz,
  check (ends_on >= starts_on)
);
-- 2026-10-29 時光試煉島：信鴿信可以只寄給班上幾個孩子。null＝整班（或全站）。
alter table public.park_news add column if not exists students uuid[];
create index if not exists park_news_active on public.park_news (ends_on desc) where hidden_at is null;

create table if not exists public.park_news_seen (
  news_id    bigint not null references public.park_news(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  parts      text[] not null default '{}',
  seen_at    timestamptz not null default now(),
  primary key (news_id, student_id)
);
create index if not exists park_news_seen_student on public.park_news_seen (student_id);

alter table public.park_news      enable row level security;
alter table public.park_news_seen enable row level security;
-- 沒有任何 policy：只能透過下面的函式讀寫
revoke all on public.park_news, public.park_news_seen from public, anon, authenticated;

-- 地圖要的。信箱要留著舊信，所以過期 60 天內的也回（active=false），地圖只拿 active 的來畫。
create or replace function public.park_news_mine()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := public.current_student_id();
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_codes text[];
begin
  if v_me is not null then
    select coalesce(array_agg(m.class_code), '{}') into v_codes from public.park_class_members m where m.student_id = v_me;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'kinds', n.kinds, 'title', n.title, 'body', n.body, 'banner', coalesce(n.banner, n.title),
             'link', n.link, 'zones', n.zones, 'sign', n.sign, 'important', n.important,
             'starts_on', n.starts_on, 'ends_on', n.ends_on, 'active', n.ends_on >= v_today,
             'mine_class', n.classes is not null,
             'seen', coalesce(s.parts, '{}'))
           order by n.starts_on desc, n.id desc)
      from public.park_news n
      left join public.park_news_seen s on s.news_id = n.id and s.student_id = v_me
     where n.hidden_at is null
       and n.starts_on <= v_today
       and n.ends_on >= v_today - 60
       and (n.classes is null or n.classes && v_codes)
       and (n.students is null or v_me = any(n.students))
       -- 沒登入（或老師）只看全站、還沒過期的布告欄
       and (v_me is not null or (n.classes is null and n.ends_on >= v_today and 'board' = any(n.kinds)))
  ), '[]'::jsonb);
end;
$$;

create or replace function public.park_news_seen(p_id bigint, p_parts text[])
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := public.current_student_id();
  v_parts text[];
begin
  if v_me is null then return false; end if;
  select array_agg(distinct p) into v_parts from unnest(coalesce(p_parts, '{}')) p
   where p in ('board', 'flag', 'balloon', 'letter');
  if v_parts is null then return false; end if;
  if not exists (select 1 from public.park_news n where n.id = p_id and n.hidden_at is null) then return false; end if;
  insert into public.park_news_seen as s (news_id, student_id, parts)
  values (p_id, v_me, v_parts)
  on conflict (news_id, student_id) do update
    set parts = (select array_agg(distinct p) from unnest(s.parts || excluded.parts) p), seen_at = now();
  return true;
end;
$$;

create or replace function public.park_news_post(
  p_kinds text[], p_title text, p_body text, p_ends_on date,
  p_banner text default null, p_link text default null, p_zones text[] default '{}',
  p_classes text[] default null, p_sign text default null, p_important boolean default false,
  p_starts_on date default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin boolean := public.is_admin();
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_start date := coalesce(p_starts_on, v_today);
  v_kinds text[];
  v_zones text[];
  v_name  text;
  v_id    bigint;
begin
  perform public.park_require_staff();
  select array_agg(distinct k) into v_kinds from unnest(coalesce(p_kinds, '{}')) k;
  if v_kinds is null then raise exception '至少勾一種出現方式'; end if;
  if not v_kinds <@ array['board', 'flag', 'balloon', 'letter'] then raise exception '沒有這種公告方式'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception '標題要寫'; end if;
  if p_ends_on is null or p_ends_on < v_start then raise exception '結束日要在開始日之後'; end if;
  if p_ends_on > v_start + 120 then raise exception '公告最長 120 天'; end if;

  if not v_admin then
    -- 老師：只能寄信、只能寄給自己的班
    if v_kinds <> array['letter'] then raise exception '老師只能用「信差來信」'; end if;
    if p_classes is null or cardinality(p_classes) = 0 then raise exception '要選寄給哪一班'; end if;
    if exists (select 1 from unnest(p_classes) c where not public.is_teacher_of(c)) then
      raise exception '只能寄給自己的班';
    end if;
  end if;
  if p_classes is not null and exists (select 1 from unnest(p_classes) c where not exists (select 1 from public.classes x where x.code = c)) then
    raise exception '找不到這個班';
  end if;

  select array_agg(distinct z) into v_zones from unnest(coalesce(p_zones, '{}')) z;
  if 'flag' = any(v_kinds) then
    if v_zones is null then raise exception '島嶼布條要選掛在哪座島'; end if;
    if exists (select 1 from unnest(v_zones) z where not exists (select 1 from public.park_zones x where x.code = z)) then
      raise exception '沒有這座島';
    end if;
  else
    v_zones := '{}';
  end if;

  select t.display_name into v_name from public.teachers t where t.user_id = auth.uid();
  insert into public.park_news (kinds, title, body, banner, link, zones, classes, sign, important, starts_on, ends_on, author, author_name)
  values (v_kinds, btrim(p_title), coalesce(btrim(p_body), ''), nullif(btrim(coalesce(p_banner, '')), ''),
          nullif(btrim(coalesce(p_link, '')), ''), v_zones,
          case when p_classes is null or cardinality(p_classes) = 0 then null else p_classes end,
          nullif(btrim(coalesce(p_sign, '')), ''), coalesce(p_important, false), v_start, p_ends_on,
          auth.uid(), coalesce(v_name, ''))
  returning id into v_id;
  perform public.park_log('news_post', case when p_classes is null then null else array_to_string(p_classes, ',') end,
                          v_id::text, jsonb_build_object('kinds', v_kinds, 'title', btrim(p_title)));
  return v_id;
end;
$$;

-- 後台列表：管理員看全部，老師看自己發的。seen＝看過任何一種的人數，reach＝收得到的學生數
create or replace function public.park_news_list()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_admin boolean := public.is_admin();
begin
  perform public.park_require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'kinds', n.kinds, 'title', n.title, 'body', n.body, 'banner', n.banner, 'link', n.link,
             'zones', n.zones, 'classes', n.classes, 'sign', n.sign, 'important', n.important,
             'starts_on', n.starts_on, 'ends_on', n.ends_on, 'author_name', n.author_name,
             'mine', n.author = auth.uid(), 'created_at', n.created_at, 'hidden', n.hidden_at is not null,
             'seen', (select count(*) from public.park_news_seen s where s.news_id = n.id),
             'reach', case when n.classes is null then (select count(*) from public.students)
                           else (select count(distinct m.student_id) from public.park_class_members m where m.class_code = any(n.classes)) end)
           order by n.created_at desc)
      from public.park_news n
     where (v_admin or n.author = auth.uid())
       and n.created_at > now() - interval '365 days'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.park_news_hide(p_id bigint)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.park_require_staff();
  update public.park_news n set hidden_at = now()
   where n.id = p_id and n.hidden_at is null and (public.is_admin() or n.author = auth.uid());
  if not found then return false; end if;
  perform public.park_log('news_hide', null, p_id::text, '{}');
  return true;
end;
$$;

revoke all on function public.park_news_mine(), public.park_news_seen(bigint, text[]),
  public.park_news_post(text[], text, text, date, text, text, text[], text[], text, boolean, date),
  public.park_news_list(), public.park_news_hide(bigint) from public;
grant execute on function public.park_news_mine() to anon, authenticated;
grant execute on function public.park_news_seen(bigint, text[]),
  public.park_news_post(text[], text, text, date, text, text, text[], text[], text, boolean, date),
  public.park_news_list(), public.park_news_hide(bigint) to authenticated;
