-- =============================================================================
-- 時空冒險樂園：寵物島裝扮、拜訪、今日精選島（寵物島 2.0 第 1 期，2026-10-29）
--
-- 裝扮：傢俱擺在哪、哪些收起來、島的風格（主題地面）、島名（從三組字裡各挑一個，不能自己打字）
--   存在伺服器，換手機也一樣，別人來參觀看到的也是這一份。
-- 島的風格：spring 春日花園大家都有；beach 夕陽海灘、autumn 楓葉、snow 雪夜（冬天才上架）在商店用時光幣買；
--   stars 星空要拿到臺灣島終章的章（今天的島嶼）；candy 糖果樂園是之後週末活動的獎勵。
--   買到的記在 park_student_furniture（item＝'theme-<code>'），跟傢俱同一張表。
-- 拜訪：同班同學的島隨時可以去看（試玩班 TRYIT 人太多、互相不認識，不列同學，只看精選）；
--   每座島每天可以留一個正面圖示（6 種），只能看、不能搬、不能打字。
-- 今日精選島：每天（臺灣時間）第一個人來看時選出 6 座：擺了 5 件以上的東西，
--   最近 7 天收到的圖示越多越容易選到，最近 14 天上過的先讓給別人。所有班級（含試玩班）一起選，只顯示暱稱和島名。
--
-- 怎麼套：Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。
-- 順序：park_pet.sql、park_coins.sql（park_today、商店）、park_passport.sql（章）之後。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------
-- layout：擺在島上的傢俱 {傢俱 id: {x, y, f}}（x、y 是島圖上的比例 0～1，f＝1 是翻面）；stored：收起來的傢俱
create table if not exists public.park_isle (
  student_id uuid primary key references public.students(id) on delete cascade,
  theme      text not null default 'spring',
  name       smallint[] not null default '{0,0,0}',
  layout     jsonb not null default '{}',
  stored     text[] not null default '{}',
  placed     int not null default 0,
  updated_at timestamptz not null default now()
);

-- 圖示：kind 0 好可愛、1 好厲害、2 好漂亮、3 好好笑、4 好有創意、5 我來過了
create table if not exists public.park_isle_reacts (
  from_id uuid not null references public.students(id) on delete cascade,
  to_id   uuid not null references public.students(id) on delete cascade,
  day     date not null,
  kind    smallint not null check (kind between 0 and 5),
  seen    boolean not null default false,
  at      timestamptz not null default now(),
  primary key (from_id, to_id, day)
);
create index if not exists park_isle_reacts_to on public.park_isle_reacts (to_id, at desc);

create table if not exists public.park_isle_featured (
  day        date not null,
  student_id uuid not null references public.students(id) on delete cascade,
  rank       smallint not null,
  primary key (day, student_id)
);

alter table public.park_isle          enable row level security;
alter table public.park_isle_reacts   enable row level security;
alter table public.park_isle_featured enable row level security;
revoke all on public.park_isle, public.park_isle_reacts, public.park_isle_featured from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. 島的風格
-- -----------------------------------------------------------------------------
create or replace function public.park_isle_themes(p_student uuid)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select array['spring']
    || coalesce((select array_agg(substr(f.item, 7) order by f.got_at) from public.park_student_furniture f
                  where f.student_id = p_student and f.item like 'theme-%'), '{}')
    || case when exists (select 1 from public.park_student_stamps s
                          where s.student_id = p_student and s.facility = 'island_pioneer' and s.stamp = 'end')
            then array['stars'] else '{}' end;
$$;

-- 商店上架（cat 'theme'，park_coins.sql 的 park_shop／park_shop_buy 會照傢俱一樣處理：買一次、記在 park_student_furniture）
insert into public.park_shop_items (code, cat, ref, name, art, blurb, price, months, sort) values
  ('theme-beach',  'theme', 'theme-beach',  '夕陽海灘', 'img/pet/land/beach.webp',  '寵物島換成椰子樹和金色沙灘', 300, null, 30),
  ('theme-autumn', 'theme', 'theme-autumn', '楓葉野餐', 'img/pet/land/autumn.webp', '整座島變成紅紅黃黃的楓葉', 300, null, 31),
  ('theme-snow',   'theme', 'theme-snow',   '雪夜木屋', 'img/pet/land/snow.webp',   '冬天限定：下雪的島、結冰的湖', 350, '{12,1,2}', 32)
on conflict (code) do update
  set cat = excluded.cat, ref = excluded.ref, name = excluded.name, art = excluded.art, blurb = excluded.blurb,
      price = excluded.price, months = excluded.months, sort = excluded.sort;

-- -----------------------------------------------------------------------------
-- 3. 誰可以看誰的島
-- -----------------------------------------------------------------------------
-- 試玩班這種大家互不認識的大班，不算「同班」
create or replace function public.park_isle_open_class(p_code text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_code = 'TRYIT';
$$;

create or replace function public.park_isle_classmate(p_me uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.park_class_members a join public.park_class_members b on b.class_code = a.class_code
                  where a.student_id = p_me and b.student_id = p_other and not public.park_isle_open_class(a.class_code));
$$;

-- 同班，或是今天、昨天上過精選
create or replace function public.park_isle_can_see(p_me uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_me = p_other or public.park_isle_classmate(p_me, p_other)
      or exists (select 1 from public.park_isle_featured f
                  where f.student_id = p_other and f.day >= public.park_today() - 1);
$$;

-- 收到的圖示，6 種各幾個（全部時間）
create or replace function public.park_isle_love(p_student uuid)
returns int[] language sql stable security definer set search_path = public, pg_temp as $$
  select array[count(*) filter (where kind = 0), count(*) filter (where kind = 1), count(*) filter (where kind = 2),
               count(*) filter (where kind = 3), count(*) filter (where kind = 4), count(*) filter (where kind = 5)]::int[]
    from public.park_isle_reacts where to_id = p_student;
$$;

-- 一座島的卡片（清單用）：{id, nickname, name, theme, placed, love}
create or replace function public.park_isle_card(p_student uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', st.id, 'nickname', st.nickname,
           'name', coalesce(to_jsonb(i.name), '[0,0,0]'::jsonb), 'theme', coalesce(i.theme, 'spring'),
           'placed', coalesce(i.placed, 0), 'love', to_jsonb(public.park_isle_love(st.id)),
           'pet', (select jsonb_build_object('species', p.species, 'stage', public.park_pet_stage(p.xp))
                     from public.park_pets p where p.student_id = st.id order by p.active desc, p.id limit 1))
    from public.students st left join public.park_isle i on i.student_id = st.id
   where st.id = p_student;
$$;

-- -----------------------------------------------------------------------------
-- 4. 自己的島
-- -----------------------------------------------------------------------------
-- {saved, theme, name, layout, stored, themes, inbox:[{nickname, kind, at}], featured}
create or replace function public.park_isle_me()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_i public.park_isle;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  select * into v_i from public.park_isle where student_id = v_me;
  return jsonb_build_object(
    'saved', v_i.student_id is not null,
    'theme', coalesce(v_i.theme, 'spring'), 'name', coalesce(to_jsonb(v_i.name), '[0,0,0]'::jsonb),
    'layout', coalesce(v_i.layout, '{}'::jsonb), 'stored', coalesce(to_jsonb(v_i.stored), '[]'::jsonb),
    'themes', to_jsonb(public.park_isle_themes(v_me)),
    'love', to_jsonb(public.park_isle_love(v_me)),
    'inbox', coalesce((select jsonb_agg(jsonb_build_object('nickname', st.nickname, 'kind', r.kind, 'at', r.at) order by r.at desc)
                         from (select * from public.park_isle_reacts where to_id = v_me and not seen order by at desc limit 20) r
                         join public.students st on st.id = r.from_id), '[]'::jsonb),
    'featured', exists (select 1 from public.park_isle_featured where student_id = v_me and day = public.park_today()));
end;
$$;

create or replace function public.park_isle_seen()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.park_isle_reacts set seen = true where to_id = public.current_student_id() and not seen;
$$;

-- 存島：主題要有、島名每組 0～19、傢俱最多 40 件（id 只能英數和 -）、座標夾在 0～1
create or replace function public.park_isle_save(p_theme text, p_name int[], p_layout jsonb, p_stored text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_layout jsonb := '{}'; v_k text; v_v jsonb;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if not (coalesce(p_theme, 'spring') = any(public.park_isle_themes(v_me))) then raise exception '還沒拿到這個島的風格'; end if;
  if coalesce(array_length(p_name, 1), 0) <> 3 or exists (select 1 from unnest(p_name) n where n is null or n < 0 or n > 19) then
    raise exception '島名要從選單挑';
  end if;
  if jsonb_typeof(coalesce(p_layout, '{}')) <> 'object' then raise exception '擺放資料不對'; end if;
  for v_k, v_v in select * from jsonb_each(coalesce(p_layout, '{}')) loop
    if v_k !~ '^[a-z][a-z0-9-]{1,30}$' or jsonb_typeof(v_v -> 'x') <> 'number' or jsonb_typeof(v_v -> 'y') <> 'number' then continue; end if;
    v_layout := v_layout || jsonb_build_object(v_k, jsonb_build_object(
      'x', round(least(1, greatest(0, (v_v ->> 'x')::numeric)), 3),
      'y', round(least(1, greatest(0, (v_v ->> 'y')::numeric)), 3),
      'f', case when (v_v ->> 'f') = '1' then 1 else 0 end));
  end loop;
  if (select count(*) from jsonb_object_keys(v_layout)) > 40 then raise exception '島上放太多東西了'; end if;
  insert into public.park_isle as i (student_id, theme, name, layout, stored, placed, updated_at)
  values (v_me, coalesce(p_theme, 'spring'), p_name::smallint[], v_layout,
          coalesce((select array_agg(s) from unnest(p_stored) s where s ~ '^[a-z][a-z0-9-]{1,30}$' limit 60), '{}'),
          (select count(*) from jsonb_object_keys(v_layout)), now())
  on conflict (student_id) do update
    set theme = excluded.theme, name = excluded.name, layout = excluded.layout, stored = excluded.stored,
        placed = excluded.placed, updated_at = now();
  return jsonb_build_object('ok', true, 'placed', (select count(*) from jsonb_object_keys(v_layout)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. 拜訪
-- -----------------------------------------------------------------------------
-- 同班同學的島（試玩班不列、還沒打開過寵物島的不列）：[{卡片}]，最近改過的排前面
create or replace function public.park_isle_class()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  return coalesce((select jsonb_agg(public.park_isle_card(x.sid) order by x.up desc nulls last) from (
    select distinct b.student_id as sid, i.updated_at as up
      from public.park_class_members a
      join public.park_class_members b on b.class_code = a.class_code and b.student_id <> v_me
      join public.park_isle i on i.student_id = b.student_id   -- 打開過寵物島的才列
     where a.student_id = v_me and not public.park_isle_open_class(a.class_code)
     limit 80) x), '[]'::jsonb);
end;
$$;

-- 今日精選：今天還沒選就先選（同一時間只有一個人在選）
create or replace function public.park_isle_featured_today()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_day date := public.park_today();
begin
  if public.current_student_id() is null and not public.is_admin() then raise exception '請先登入'; end if;
  if not exists (select 1 from public.park_isle_featured where day = v_day) then
    perform pg_advisory_xact_lock(hashtext('park_isle_featured'));
    if not exists (select 1 from public.park_isle_featured where day = v_day) then
      insert into public.park_isle_featured (day, student_id, rank)
      select v_day, c.student_id, row_number() over (order by c.recent, c.score desc)
        from (select i.student_id,
                     exists (select 1 from public.park_isle_featured f
                              where f.student_id = i.student_id and f.day > v_day - 14) as recent,
                     (select count(*) from public.park_isle_reacts r where r.to_id = i.student_id and r.day > v_day - 7)
                       + random() * 3 as score
                from public.park_isle i
               where i.placed >= 5 and i.updated_at > now() - interval '30 days') c
       order by c.recent, c.score desc
       limit 6;
    end if;
  end if;
  return coalesce((select jsonb_agg(public.park_isle_card(f.student_id) order by f.rank)
                     from public.park_isle_featured f where f.day = v_day), '[]'::jsonb);
end;
$$;

-- 參觀一座島：{卡片, theme, name, layout, pets:[{species, stage, name}], mine（今天留過的圖示或 null）}
create or replace function public.park_isle_view(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_i public.park_isle;
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if not public.park_isle_can_see(v_me, p_student) then raise exception '只能參觀同班同學或今日精選的島'; end if;
  select * into v_i from public.park_isle where student_id = p_student;
  return public.park_isle_card(p_student) || jsonb_build_object(
    'layout', coalesce(v_i.layout, '{}'::jsonb),
    'pets', coalesce((select jsonb_agg(jsonb_build_object('species', p.species, 'stage', public.park_pet_stage(p.xp), 'name', p.name) order by p.active desc, p.id)
                        from public.park_pets p where p.student_id = p_student), '[]'::jsonb),
    'mine', (select r.kind from public.park_isle_reacts r where r.from_id = v_me and r.to_id = p_student and r.day = public.park_today()));
end;
$$;

-- 留圖示：每座島每天一個、不能留給自己
create or replace function public.park_isle_react(p_student uuid, p_kind int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then raise exception '請先登入學生帳號'; end if;
  if p_student = v_me then raise exception '自己的島不用按喔'; end if;
  if p_kind is null or p_kind not between 0 and 5 then raise exception '沒有這個圖示'; end if;
  if not public.park_isle_can_see(v_me, p_student) then raise exception '只能參觀同班同學或今日精選的島'; end if;
  insert into public.park_isle_reacts (from_id, to_id, day, kind) values (v_me, p_student, public.park_today(), p_kind)
  on conflict do nothing;
  if not found then raise exception '今天已經留過了，明天可以再來'; end if;
  return jsonb_build_object('love', to_jsonb(public.park_isle_love(p_student)), 'mine', p_kind);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_isle_themes(uuid), public.park_isle_open_class(text), public.park_isle_classmate(uuid, uuid),
  public.park_isle_can_see(uuid, uuid), public.park_isle_love(uuid), public.park_isle_card(uuid),
  public.park_isle_me(), public.park_isle_seen(), public.park_isle_save(text, int[], jsonb, text[]),
  public.park_isle_class(), public.park_isle_featured_today(), public.park_isle_view(uuid), public.park_isle_react(uuid, int)
  from public, anon, authenticated;
grant execute on function
  public.park_isle_me(), public.park_isle_seen(), public.park_isle_save(text, int[], jsonb, text[]),
  public.park_isle_class(), public.park_isle_featured_today(), public.park_isle_view(uuid), public.park_isle_react(uuid, int)
  to authenticated;
