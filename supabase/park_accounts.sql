-- =============================================================================
-- 時空冒險樂園 P1：統一帳號與多班級
--
-- 帳號本身（teachers / classes / students / student_links）沿用守護異世界的
-- schema.sql，這份只「加表、加函式、加觸發器」，不改也不刪任何既有的東西，
-- 所以英文正式站照常運作。
--
-- 怎麼套：Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。
-- 順序：守護異世界的 schema.sql 先，這份後。
--
-- **注意**：守護異世界的 schema.sql 開頭會 `revoke all on all tables / functions`，
-- 會把這份給出去的讀取與執行權限一起收掉。所以每次重跑它的 schema.sql 之後，
-- 都要把這份再跑一次（觸發器不受影響，多班級資料不會亂，只是樂園的函式會暫時叫不動）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 班級成員：一個學生可以在好幾個班
--    students.class_code 保留當「主要班級」（守護異世界的排行榜、班內暱稱不重複都用它），
--    這張表記「所有」加入的班，主要班級也在裡面。
-- -----------------------------------------------------------------------------
create table if not exists public.park_class_members (
  class_code text not null references public.classes(code) on delete cascade on update cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (class_code, student_id)
);
create index if not exists park_class_members_student on public.park_class_members(student_id);

-- 班級的年級與類型。classes 是共用表不動，另外記在這裡；P2 開班畫面會用到。
create table if not exists public.park_class_settings (
  class_code text primary key references public.classes(code) on delete cascade on update cascade,
  grade      smallint check (grade between 1 and 6),          -- 家庭班可以不填
  kind       text not null default 'school' check (kind in ('school', 'home')),
  updated_at timestamptz not null default now()
);

alter table public.park_class_members  enable row level security;
alter table public.park_class_settings enable row level security;

-- 跟守護異世界一樣：只開讀，寫入一律走底下的函式。
revoke all on public.park_class_members, public.park_class_settings from anon, authenticated;
grant select on public.park_class_members, public.park_class_settings to authenticated;

drop policy if exists park_class_members_read on public.park_class_members;
create policy park_class_members_read on public.park_class_members for select to authenticated
  using (student_id = public.current_student_id() or public.is_teacher_of(class_code));

drop policy if exists park_class_settings_read on public.park_class_settings;
create policy park_class_settings_read on public.park_class_settings for select to authenticated
  using (
    public.is_teacher_of(class_code)
    or exists (select 1 from public.park_class_members m
                where m.class_code = park_class_settings.class_code
                  and m.student_id = public.current_student_id())
  );

-- -----------------------------------------------------------------------------
-- 2. 主要班級一變，成員表就跟著變
--    守護異世界自己的註冊、換班、老師加學生都只改 students.class_code，
--    靠這個觸發器同步，英文那邊一行都不用改。
--    換主要班級＝「搬家」：舊的主要班級移除、新的加入（跟守護異世界原本換班的意思一樣），
--    其他另外加入的班不受影響。
-- -----------------------------------------------------------------------------
create or replace function public.park_sync_primary_member()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.class_code is not null
     and old.class_code is distinct from new.class_code then
    delete from public.park_class_members
     where class_code = old.class_code and student_id = new.id;
  end if;
  if new.class_code is not null then
    insert into public.park_class_members (class_code, student_id)
    values (new.class_code, new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.park_sync_primary_member() from public, anon, authenticated;

drop trigger if exists park_sync_primary_member on public.students;
create trigger park_sync_primary_member
  after insert or update of class_code on public.students
  for each row execute function public.park_sync_primary_member();

-- 現有學生接上：已經有主要班級的人補一筆成員紀錄（重複執行不會重複加）。
insert into public.park_class_members (class_code, student_id, joined_at)
select s.class_code, s.id, s.created_at
  from public.students s
 where s.class_code is not null
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. 我是誰：樂園一打開就問這一支，決定顯示登入畫面、樂園地圖還是老師入口。
--    學生的班級名稱也從這裡拿：classes 的讀取規則只讓學生看到主要班級，
--    另外加入的班要靠這支（security definer）才拿得到班名。
-- -----------------------------------------------------------------------------
create or replace function public.park_me()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.current_student_id();
  v_t public.teachers%rowtype;
  v_s public.students%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('kind', 'guest');
  end if;

  if public.is_real_account() then
    select * into v_t from public.teachers t where t.user_id = auth.uid();
    if v_t.user_id is not null then
      return jsonb_build_object(
        'kind', 'staff',
        'email', auth.jwt() ->> 'email',
        'display_name', v_t.display_name,
        'is_admin', v_t.is_admin,
        'active', v_t.active,
        'has_admin', exists (select 1 from public.teachers x where x.is_admin and x.active),
        'class_count', (select count(*) from public.classes c where c.owner = auth.uid())
      );
    end if;
    -- 有 email 帳號但不是開班的人（例如註冊到一半）：當作還沒登入
    return jsonb_build_object('kind', 'guest', 'email', auth.jwt() ->> 'email',
                              'has_admin', exists (select 1 from public.teachers x where x.is_admin));
  end if;

  if v_student is null then
    return jsonb_build_object('kind', 'guest');
  end if;

  select * into v_s from public.students s where s.id = v_student;
  return jsonb_build_object(
    'kind', 'student',
    'id', v_s.id,
    'login_id', v_s.login_id,
    'nickname', v_s.nickname,
    'nickname_changed_at', v_s.nickname_changed_at,
    'primary_class', v_s.class_code,
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code,
               'name', c.name,
               'owner_name', coalesce(t.display_name, ''),
               'primary', c.code = v_s.class_code,
               'joined_at', m.joined_at)
             order by (c.code = v_s.class_code) desc, m.joined_at)
        from public.park_class_members m
        join public.classes c on c.code = m.class_code
        left join public.teachers t on t.user_id = c.owner
       where m.student_id = v_s.id
    ), '[]'::jsonb)
  );
end;
$$;

-- 班上人數滿了嗎？跟 class_full_problem 一樣，只是改算「所有成員」而不只主要班級。
create or replace function public.park_class_full_problem(p_code text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_max int; v_admin boolean; v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select t.max_students, t.is_admin into v_max, v_admin
    from public.classes c join public.teachers t on t.user_id = c.owner
   where c.code = v_code;
  if v_max is null or v_admin then return null; end if;
  if (select count(*) from public.park_class_members m where m.class_code = v_code) >= v_max then
    return format('這一班已經滿 %s 人了，請跟開班的老師或家長說', v_max);
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. 加入另一個班。還沒有主要班級的人，第一個加入的班就是主要班級；
--    已經有的人，新的班只是多一筆成員紀錄，主要班級不變。
--    暱稱重複只在主要班級檢查（規劃書：其他班的老師會同時看到暱稱和帳號）。
-- -----------------------------------------------------------------------------
create or replace function public.park_join_class(p_class_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id   uuid := public.current_student_id();
  v_code text := upper(btrim(coalesce(p_class_code, '')));
  v_open boolean; v_name text; v_primary text; v_nick text; v_bad text;
begin
  if v_id is null then raise exception '請先登入'; end if;
  select c.open, c.name into v_open, v_name from public.classes c where c.code = v_code;
  if v_open is null then raise exception '找不到這組班級代碼'; end if;

  if exists (select 1 from public.park_class_members m
              where m.class_code = v_code and m.student_id = v_id) then
    raise exception '你已經在這一班了';
  end if;
  if not v_open then raise exception '這一班目前沒有開放加入，請老師打開'; end if;
  if (select count(*) from public.park_class_members m where m.student_id = v_id) >= 10 then
    raise exception '最多只能加入 10 個班';
  end if;
  v_bad := public.park_class_full_problem(v_code);
  if v_bad is not null then raise exception '%', v_bad; end if;

  select s.class_code, s.nickname into v_primary, v_nick from public.students s where s.id = v_id;
  if v_primary is null then
    if exists (select 1 from public.students s
                where s.class_code = v_code and s.nickname = v_nick and s.id <> v_id) then
      raise exception '這一班已經有人叫「%」了，請先改一個別的暱稱再加入', v_nick;
    end if;
    update public.students set class_code = v_code where id = v_id;   -- 觸發器會補成員紀錄
  else
    insert into public.park_class_members (class_code, student_id) values (v_code, v_id);
  end if;

  return jsonb_build_object('code', v_code, 'name', v_name, 'primary', v_primary is null);
end;
$$;

-- 退出一個班。主要班級不能自己退（守護異世界的排行榜靠它），要換主要班級請老師處理。
create or replace function public.park_leave_class(p_class_code text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id   uuid := public.current_student_id();
  v_code text := upper(btrim(coalesce(p_class_code, '')));
begin
  if v_id is null then raise exception '請先登入'; end if;
  if exists (select 1 from public.students s where s.id = v_id and s.class_code = v_code) then
    raise exception '這是你的主要班級，不能自己退出';
  end if;
  delete from public.park_class_members where class_code = v_code and student_id = v_id;
  if not found then raise exception '你不在這一班'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. 權限：只給登入的人（含學生裝置的匿名身分）叫得動
-- -----------------------------------------------------------------------------
revoke all on function public.park_me(), public.park_class_full_problem(text),
                       public.park_join_class(text), public.park_leave_class(text)
  from public, anon, authenticated;
grant execute on function public.park_me(), public.park_join_class(text), public.park_leave_class(text)
  to authenticated;
