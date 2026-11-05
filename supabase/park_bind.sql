-- =============================================================================
-- 時空冒險樂園：家長綁定雙向同意、解除、忘記密碼寄給爸媽（2026-11-05 Chuck 定案）
--
-- 1. 家長碼路線：大人輸入孩子的家長碼 → 先「等孩子確認」（pending），孩子在樂園按「是我的爸媽」才生效；
--    還沒確認前，大人看不到、也改不了孩子任何東西（park_is_guardian 只認 active）。
-- 2. 信箱路線：孩子在爸媽任務填爸媽的信箱 → 寄邀請信，大人點信裡的連結、登入後按確認才生效。
-- 3. 家長幫孩子開帳號：直接生效（本來就是大人開的）。正式庫現有的綁定都當作已確認。
-- 4. 解除：家長自己解除；另一位家長可以移除；孩子按「這不是我的爸媽」，綁定 7 天內直接解除，
--    超過 7 天送給管理員處理（寫進問題回報）。管理員可以直接解除。
-- 5. 通知：綁定、解除、改密碼都寄信給孩子已確認的爸媽。
-- 6. 忘記密碼：孩子在登入畫面輸入帳號 → 寄「設新密碼」連結給已確認的爸媽（畫面只顯示遮住的信箱），
--    30 分鐘內有效、用一次；沒有綁爸媽的請老師重設（爸媽任務有提醒）。
--
-- 要先套 park_parent.sql、park_mail.sql、park_console.sql。可以重複執行。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 資料表
-- -----------------------------------------------------------------------------
alter table public.park_guardians add column if not exists status text not null default 'active';
alter table public.park_guardians add column if not exists confirmed_at timestamptz;
do $$ begin
  alter table public.park_guardians add constraint park_guardians_status check (status in ('pending', 'active'));
exception when duplicate_object then null; end $$;
alter table public.park_guardians drop constraint if exists park_guardians_via_check;
alter table public.park_guardians add constraint park_guardians_via_check check (via in ('create', 'code', 'email'));
update public.park_guardians set confirmed_at = created_at where status = 'active' and confirmed_at is null;

-- 孩子寄給爸媽的邀請信
create table if not exists public.park_parent_invites (
  token      text primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  used_by    uuid
);
create index if not exists park_parent_invites_student on public.park_parent_invites(student_id, created_at desc);
alter table public.park_parent_invites enable row level security;
revoke all on public.park_parent_invites from anon, authenticated;

-- 忘記密碼的設新密碼連結（只存雜湊）
create table if not exists public.park_reset_tokens (
  token_hash text primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists park_reset_tokens_student on public.park_reset_tokens(student_id, created_at desc);
alter table public.park_reset_tokens enable row level security;
revoke all on public.park_reset_tokens from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. 小工具
-- -----------------------------------------------------------------------------
-- 只有確認過的才算監護人
create or replace function public.park_is_guardian(p_student uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.park_guardians g where g.student_id = p_student and g.guardian = auth.uid() and g.status = 'active');
$$;

-- 某位家長的家庭班（大人自己操作時用 park_parent_home() 開好；這裡只找，沒有就 null）
create or replace function public.park_parent_home_of(p_guardian uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select c.code from public.classes c join public.park_class_settings s on s.class_code = c.code
   where c.owner = p_guardian and s.kind = 'home' order by c.created_at limit 1;
$$;

-- 家庭班（判斷「家長設的優先」用）只認確認過的監護人
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

-- 把孩子放進某位家長的家庭班
create or replace function public.park_put_in_home(p_student uuid, p_guardian uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_home text := public.park_parent_home_of(p_guardian);
begin
  if v_home is null then return null; end if;
  if not exists (select 1 from public.park_class_members m where m.class_code = v_home and m.student_id = p_student) then
    if (select s.class_code from public.students s where s.id = p_student) is null then
      update public.students set class_code = v_home where id = p_student;   -- 觸發器會補成員紀錄
    else
      insert into public.park_class_members (class_code, student_id) values (v_home, p_student);
    end if;
  end if;
  return v_home;
end;
$$;

-- 把孩子從某位家長的家庭班拿出來（只拿那位家長開的家庭班；是主要班級的話跟移出班級一樣換一個）
create or replace function public.park_take_from_home(p_student uuid, p_guardian uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_nick text; v_next text;
begin
  for v_code in select m.class_code from public.park_class_members m
                  join public.classes c on c.code = m.class_code
                  join public.park_class_settings s on s.class_code = m.class_code and s.kind = 'home'
                 where m.student_id = p_student and c.owner = p_guardian loop
    if (select s.class_code from public.students s where s.id = p_student) = v_code then
      select s.nickname into v_nick from public.students s where s.id = p_student;
      select m.class_code into v_next from public.park_class_members m
       where m.student_id = p_student and m.class_code <> v_code
         and not exists (select 1 from public.students s2 where s2.class_code = m.class_code and s2.nickname = v_nick and s2.id <> p_student)
       order by m.joined_at limit 1;
      update public.students set class_code = v_next where id = p_student;
    end if;
    delete from public.park_class_members where class_code = v_code and student_id = p_student;
  end loop;
end;
$$;

-- 遮住信箱：chuck@gmail.com → c***k@gmail.com
create or replace function public.park_mask_email(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p is null or position('@' in p) = 0 then null
              when position('@' in p) <= 3 then left(p, 1) || '***' || substr(p, position('@' in p))
              else left(p, 1) || '***' || substr(p, position('@' in p) - 1) end;
$$;

-- 信件外框
create or replace function public.park_mail_html(p_title text, p_body text, p_button text default null, p_url text default null)
returns text language sql immutable set search_path = public, pg_temp as $$
  select '<div style="font-family:''Noto Sans TC'',sans-serif;font-size:16px;line-height:1.7;color:#3a2412;max-width:560px">'
      || '<h2 style="color:#6b3f1f;font-size:20px">' || p_title || '</h2>' || p_body
      || case when p_url is not null then '<p style="margin:24px 0"><a href="' || p_url || '" style="background:#3f9a2a;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">'
              || coalesce(p_button, '打開') || '</a></p><p style="font-size:13px;color:#8a6a4a">按鈕按不了的話，複製這個網址到瀏覽器：<br>' || p_url || '</p>' else '' end
      || '<p style="font-size:13px;color:#8a6a4a;margin-top:28px">時空冒險樂園・有問題請直接回信，或寫信到 timepark@ciyulab.com</p></div>';
$$;

-- 寄信給孩子已確認的爸媽（p_except：不寄給這位）
create or replace function public.park_notify_guardians(p_student uuid, p_subject text, p_body text, p_kind text, p_except uuid default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mail text; v_n int := 0;
begin
  for v_mail in select u.email from public.park_guardians g join auth.users u on u.id = g.guardian
                 where g.student_id = p_student and g.status = 'active' and g.guardian is distinct from p_except and u.email is not null loop
    perform public.park_mail_send(v_mail, p_subject, public.park_mail_html(p_subject, p_body), p_kind);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- 網址只能是樂園自己的（信裡的連結）
create or replace function public.park_site_base(p_base text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p_base ~ '^https://(timepark\.ciyulab\.com|cphskid\.github\.io)(/dev)?/$' then p_base
              else 'https://timepark.ciyulab.com/' end;
$$;

create or replace function public.park_kid_name(p_student uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select replace(replace(s.nickname, '<', '＜'), '>', '＞') || '（帳號 ' || s.login_id || '）' from public.students s where s.id = p_student;
$$;
create or replace function public.park_staff_name(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select replace(replace(coalesce(t.display_name, '一位大人'), '<', '＜'), '>', '＞') from public.teachers t where t.user_id = p_user;
$$;

-- -----------------------------------------------------------------------------
-- 3. 綁定（改寫 park_parent.sql 的同名函式）
-- -----------------------------------------------------------------------------
-- p_via：create 家長開的帳號、email 孩子寄的邀請 → 直接生效；code 家長碼 → 等孩子確認
create or replace function public.park_parent_bind(p_student uuid, p_via text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_home text; v_bad text; v_status text; v_was text;
begin
  select g.status into v_was from public.park_guardians g where g.student_id = p_student and g.guardian = auth.uid();
  if v_was = 'active' then return public.park_put_in_home(p_student, auth.uid()); end if;
  if v_was is null and (select count(*) from public.park_guardians g where g.student_id = p_student
                          and (g.status = 'active' or g.created_at > now() - interval '14 days')) >= 2 then
    raise exception '這個孩子已經有 2 位爸媽連起來了';
  end if;
  v_status := case when p_via = 'code' then 'pending' else 'active' end;
  v_home := public.park_parent_home();          -- 大人的家庭班先開好（孩子確認時直接放進去）
  if v_status = 'active' then
    if not exists (select 1 from public.park_class_members m where m.class_code = v_home and m.student_id = p_student) then
      v_bad := public.park_class_full_problem(v_home);
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;
  end if;
  insert into public.park_guardians (student_id, guardian, via, status, confirmed_at)
  values (p_student, auth.uid(), p_via, v_status, case when v_status = 'active' then now() end)
  on conflict (student_id, guardian) do update set status = excluded.status, via = excluded.via,
    confirmed_at = excluded.confirmed_at, created_at = case when park_guardians.status = 'pending' then now() else park_guardians.created_at end;
  if v_status = 'pending' then
    perform public.park_log('parent_pending', null, p_student::text, jsonb_build_object('via', p_via));
    return null;
  end if;
  v_home := public.park_put_in_home(p_student, auth.uid());
  perform public.park_log('parent_bind', v_home, p_student::text, jsonb_build_object('via', p_via));
  perform public.park_notify_guardians(p_student, '時空冒險樂園：' || public.park_kid_name(p_student) || ' 多連了一位大人',
    '<p>' || public.park_staff_name(auth.uid()) || ' 剛剛和 ' || public.park_kid_name(p_student) || ' 連起來了，之後可以看孩子的冒險、出測驗卷、調整能玩的遊戲。</p>'
    || '<p>如果你不認識這位大人，請到老師後台「首頁」的孩子卡片按「移除另一位大人」，或直接回信給我們。</p>',
    'parent_bind', auth.uid());
  return v_home;
end;
$$;

-- 家長碼（覆寫 park_parent.sql）：回傳 pending，等孩子確認
create or replace function public.park_parent_redeem(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.park_parent_codes%rowtype; v_home text;
begin
  perform public.park_require_staff();
  select * into v_c from public.park_parent_codes c where c.code = upper(btrim(coalesce(p_code, '')));
  if v_c.code is null then raise exception '找不到這組家長碼，請孩子再按一次「拿給爸媽」'; end if;
  if v_c.used_at is not null and v_c.used_by is distinct from auth.uid() then raise exception '這組家長碼已經用過了，請孩子再按一次「拿給爸媽」'; end if;
  if v_c.created_at < now() - interval '14 days' then raise exception '這組家長碼過期了，請孩子再按一次「拿給爸媽」'; end if;
  v_home := public.park_parent_bind(v_c.student_id, 'code');
  update public.park_parent_codes set used_at = coalesce(used_at, now()), used_by = auth.uid() where code = v_c.code;
  return jsonb_build_object('student', v_c.student_id, 'home', v_home, 'pending', v_home is null,
                            'nickname', (select s.nickname from public.students s where s.id = v_c.student_id));
end;
$$;

-- 孩子：確認／拒絕等待中的大人
create or replace function public.park_parent_answer(p_guardian uuid, p_yes boolean)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_home text; v_name text;
begin
  if v_me is null then raise exception '請先登入'; end if;
  if not exists (select 1 from public.park_guardians g where g.student_id = v_me and g.guardian = p_guardian and g.status = 'pending') then
    raise exception '這個邀請已經處理過了';
  end if;
  v_name := public.park_staff_name(p_guardian);
  if not coalesce(p_yes, false) then
    delete from public.park_guardians where student_id = v_me and guardian = p_guardian and status = 'pending';
    insert into public.park_audit (actor, actor_name, action, target, detail)
    values (auth.uid(), '孩子', 'parent_refuse', v_me::text, jsonb_build_object('guardian', p_guardian));
    return '好，' || v_name || ' 不會和你連起來';
  end if;
  update public.park_guardians set status = 'active', confirmed_at = now() where student_id = v_me and guardian = p_guardian;
  v_home := public.park_put_in_home(v_me, p_guardian);
  insert into public.park_audit (actor, actor_name, action, class_code, target, detail)
  values (auth.uid(), '孩子', 'parent_confirm', v_home, v_me::text, jsonb_build_object('guardian', p_guardian));
  perform public.park_notify_guardians(v_me, '時空冒險樂園：' || public.park_kid_name(v_me) || ' 和你連起來了',
    '<p>' || public.park_kid_name(v_me) || ' 在樂園按了「是我的爸媽」。到老師後台就能看孩子的冒險、送貼紙、簽週末聯絡簿。</p>',
    'parent_bind');
  return '和 ' || v_name || ' 連起來了！';
end;
$$;

-- 孩子：寄邀請信給爸媽（同一個孩子 10 分鐘一封、一天 5 封）
create or replace function public.park_parent_invite(p_email text, p_base text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_mail text := lower(btrim(coalesce(p_email, ''))); v_tok text; v_url text;
begin
  if v_me is null then raise exception '請先登入'; end if;
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '信箱看起來不太對，請爸媽幫你看一下'; end if;
  if exists (select 1 from public.park_parent_invites i where i.student_id = v_me and i.created_at > now() - interval '10 minutes') then
    raise exception '剛剛寄過了，請爸媽看一下信箱（也看看垃圾信件匣），10 分鐘後才能再寄';
  end if;
  if (select count(*) from public.park_parent_invites i where i.student_id = v_me and i.created_at > now() - interval '1 day') >= 5 then
    raise exception '今天已經寄 5 封了，明天再試';
  end if;
  if (select count(*) from public.park_guardians g where g.student_id = v_me and g.status = 'active') >= 2 then
    raise exception '你已經和 2 位爸媽連起來了';
  end if;
  v_tok := encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.park_parent_invites (token, student_id, email) values (v_tok, v_me, v_mail);
  v_url := public.park_site_base(p_base) || 'teacher.html?invite=' || v_tok;
  perform public.park_mail_send(v_mail, '時空冒險樂園：' || public.park_kid_name(v_me) || ' 想和你連起來',
    public.park_mail_html('孩子想和你連起來',
      '<p>' || public.park_kid_name(v_me) || ' 在時空冒險樂園填了你的信箱，想請你當他的爸媽帳號。</p>'
      || '<p>連起來以後，你可以看孩子每天玩了什麼、送鼓勵貼紙、出測驗卷、設定寵物島時間；孩子忘記密碼時，設新密碼的連結也會寄到這個信箱。</p>'
      || '<p>按下面的按鈕，登入或建立家長帳號，再按「確認」就好。<b>不認識這個孩子的話，不用理這封信</b>，什麼都不會發生。</p>',
      '確認我是爸媽', v_url), 'parent_confirm');
  return public.park_mask_email(v_mail);
end;
$$;

-- 大人：打開邀請連結看是誰
create or replace function public.park_parent_invite_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_i public.park_parent_invites%rowtype;
begin
  perform public.park_require_staff();
  select * into v_i from public.park_parent_invites where token = btrim(coalesce(p_token, ''));
  if v_i.token is null then raise exception '找不到這個邀請，請孩子再寄一次'; end if;
  if v_i.used_at is not null then
    return jsonb_build_object('used', true, 'mine', v_i.used_by = auth.uid(), 'nickname', (select nickname from public.students where id = v_i.student_id));
  end if;
  if v_i.created_at < now() - interval '7 days' then raise exception '這個邀請過期了（7 天），請孩子再寄一次'; end if;
  return jsonb_build_object('used', false, 'nickname', (select nickname from public.students where id = v_i.student_id),
                            'login', (select login_id from public.students where id = v_i.student_id), 'email', public.park_mask_email(v_i.email));
end;
$$;

-- 大人：按確認
create or replace function public.park_parent_invite_accept(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_i public.park_parent_invites%rowtype; v_home text;
begin
  perform public.park_require_staff();
  select * into v_i from public.park_parent_invites where token = btrim(coalesce(p_token, '')) for update;
  if v_i.token is null then raise exception '找不到這個邀請，請孩子再寄一次'; end if;
  if v_i.used_at is not null and v_i.used_by is distinct from auth.uid() then raise exception '這個邀請已經用過了'; end if;
  if v_i.created_at < now() - interval '7 days' then raise exception '這個邀請過期了（7 天），請孩子再寄一次'; end if;
  v_home := public.park_parent_bind(v_i.student_id, 'email');
  update public.park_parent_invites set used_at = coalesce(used_at, now()), used_by = auth.uid() where token = v_i.token;
  return jsonb_build_object('student', v_i.student_id, 'home', v_home, 'nickname', (select nickname from public.students where id = v_i.student_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. 解除
-- -----------------------------------------------------------------------------
create or replace function public.park_unbind(p_student uuid, p_guardian uuid, p_why text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_kid text := public.park_kid_name(p_student); v_name text := public.park_staff_name(p_guardian); v_mail text;
begin
  select u.email into v_mail from auth.users u where u.id = p_guardian;
  perform public.park_take_from_home(p_student, p_guardian);
  delete from public.park_guardians where student_id = p_student and guardian = p_guardian;
  insert into public.park_audit (actor, actor_name, action, target, detail)
  values (auth.uid(), coalesce((select t.display_name from public.teachers t where t.user_id = auth.uid()), '孩子'),
          'parent_unbind', p_student::text, jsonb_build_object('guardian', p_guardian, 'why', p_why));
  perform public.park_notify_guardians(p_student, '時空冒險樂園：' || v_name || ' 和 ' || v_kid || ' 不再連在一起',
    '<p>' || v_name || ' 和 ' || v_kid || ' 已經解除連結（' || p_why || '）。</p>', 'parent_unbind');
  if v_mail is not null then
    perform public.park_mail_send(v_mail, '時空冒險樂園：你和 ' || v_kid || ' 不再連在一起',
      public.park_mail_html('已經解除連結', '<p>你和 ' || v_kid || ' 已經解除連結（' || p_why || '）。之後看不到這個孩子的資料了。</p>'
        || '<p>如果這不是你要的，請回信給我們。</p>'), 'parent_unbind');
  end if;
end;
$$;

-- 家長：解除自己（p_guardian 不填）或移除另一位家長
create or replace function public.park_parent_unbind(p_student uuid, p_guardian uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.park_require_staff();
  if not public.park_is_guardian(p_student) and not public.is_admin() then raise exception '這個孩子沒有和你連起來'; end if;
  if p_guardian is null or p_guardian = auth.uid() then
    perform public.park_unbind(p_student, auth.uid(), '家長自己解除');
  else
    if not exists (select 1 from public.park_guardians g where g.student_id = p_student and g.guardian = p_guardian) then
      raise exception '這位大人沒有和孩子連起來';
    end if;
    perform public.park_unbind(p_student, p_guardian, case when public.is_admin() and not public.park_is_guardian(p_student)
                                                          then '管理員解除' else '另一位家長移除' end);
  end if;
end;
$$;

-- 孩子：這不是我的爸媽。7 天內直接解除；超過 7 天送給管理員
create or replace function public.park_parent_not_mine(p_guardian uuid, p_note text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id(); v_g public.park_guardians%rowtype;
begin
  if v_me is null then raise exception '請先登入'; end if;
  select * into v_g from public.park_guardians g where g.student_id = v_me and g.guardian = p_guardian;
  if v_g.student_id is null then raise exception '這位大人沒有和你連起來'; end if;
  if v_g.status = 'pending' or coalesce(v_g.confirmed_at, v_g.created_at) > now() - interval '7 days' then
    perform public.park_unbind(v_me, p_guardian, '孩子說不是他的爸媽');
    return '好，已經解除了';
  end if;
  if exists (select 1 from public.feedback f where f.student_id = v_me and f.context ->> 'type' = 'guardian_dispute'
               and f.context ->> 'guardian' = p_guardian::text and f.created_at > now() - interval '7 days') then
    return '已經告訴管理員了，會盡快處理';
  end if;
  insert into public.feedback (user_id, student_id, class_code, who, role, kind, message, screen, context)
  select auth.uid(), v_me, s.class_code, s.nickname, 'student', 'confusing',
         '孩子說「' || public.park_staff_name(p_guardian) || '」不是他的爸媽，請管理員確認後解除。' || coalesce('孩子說：' || left(nullif(btrim(p_note), ''), 200), ''),
         '爸媽任務', jsonb_build_object('game', 'park', 'type', 'guardian_dispute', 'guardian', p_guardian)
    from public.students s where s.id = v_me;
  return '連起來超過 7 天了，已經告訴管理員，管理員確認後會幫你解除';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. 改密碼通知、忘記密碼
-- -----------------------------------------------------------------------------
create or replace function public.park_pw_changed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.park_notify_guardians(new.id, '時空冒險樂園：' || public.park_kid_name(new.id) || ' 的密碼改過了',
      '<p>' || public.park_kid_name(new.id) || ' 的樂園密碼在 ' || to_char(now() at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI') || '（臺灣時間）改過了。</p>'
      || '<p>是孩子自己、老師或你改的就不用理這封信。不是的話，請到老師後台幫孩子重設密碼，或回信給我們。</p>', 'pw_changed');
  exception when others then null;   -- 通知失敗不能擋住改密碼
  end;
  return null;
end;
$$;
drop trigger if exists park_pw_changed on public.students;
create trigger park_pw_changed after update of pw_hash on public.students
  for each row when (old.pw_hash is distinct from new.pw_hash) execute function public.park_pw_changed();

-- 孩子在登入畫面按「忘記密碼」（還沒登入也能叫）。回傳遮住的爸媽信箱；沒有綁爸媽回 none
create or replace function public.park_forgot_password(p_login text, p_base text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_id uuid; v_tok text; v_url text; v_mails text[];
begin
  select s.id into v_id from public.students s where s.login_id = lower(btrim(coalesce(p_login, '')));
  if v_id is null then return jsonb_build_object('none', true); end if;   -- 不說帳號存不存在
  select array_agg(u.email::text order by g.created_at) into v_mails
    from public.park_guardians g join auth.users u on u.id = g.guardian
   where g.student_id = v_id and g.status = 'active' and u.email is not null;
  if v_mails is null then return jsonb_build_object('none', true); end if;
  if exists (select 1 from public.park_reset_tokens t where t.student_id = v_id and t.created_at > now() - interval '5 minutes') then
    raise exception '剛剛寄過了，請爸媽看一下信箱（也看看垃圾信件匣）';
  end if;
  if (select count(*) from public.park_reset_tokens t where t.student_id = v_id and t.created_at > now() - interval '1 day') >= 5 then
    raise exception '今天已經寄 5 次了，請老師幫你重設密碼';
  end if;
  v_tok := encode(gen_random_bytes(24), 'hex');
  insert into public.park_reset_tokens (token_hash, student_id, expires_at)
  values (encode(digest(v_tok, 'sha256'), 'hex'), v_id, now() + interval '30 minutes');
  v_url := public.park_site_base(p_base) || '?reset=' || v_tok;
  for i in 1 .. array_length(v_mails, 1) loop
    perform public.park_mail_send(v_mails[i], '時空冒險樂園：幫 ' || public.park_kid_name(v_id) || ' 設新密碼',
      public.park_mail_html('孩子忘記密碼了',
        '<p>' || public.park_kid_name(v_id) || ' 在樂園按了「忘記密碼」。請在孩子要用的裝置上打開下面的連結，陪孩子設一組新密碼，設好就會直接登入。</p>'
        || '<p>連結 30 分鐘內有效，用過一次就失效。不是孩子按的話，不用理這封信，密碼不會改。</p>',
        '設新密碼', v_url), 'login_link');
  end loop;
  return jsonb_build_object('sent', (select jsonb_agg(public.park_mask_email(m)) from unnest(v_mails) m));
end;
$$;

-- 打開信裡的連結：看是誰（不用登入）
create or replace function public.park_reset_info(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare v_t public.park_reset_tokens%rowtype;
begin
  select * into v_t from public.park_reset_tokens where token_hash = encode(digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex');
  if v_t.student_id is null or v_t.used_at is not null or v_t.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', '這個連結過期或用過了，請孩子在登入畫面再按一次「忘記密碼」');
  end if;
  return jsonb_build_object('ok', true, 'login', (select login_id from public.students where id = v_t.student_id),
                            'nickname', (select nickname from public.students where id = v_t.student_id));
end;
$$;

-- 設新密碼（用一次就失效）。回傳帳號，網頁接著用新密碼登入
create or replace function public.park_reset_with_token(p_token text, p_password text)
returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_t public.park_reset_tokens%rowtype; v_login text; v_bad text;
begin
  select * into v_t from public.park_reset_tokens where token_hash = encode(digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex') for update;
  if v_t.student_id is null or v_t.used_at is not null or v_t.expires_at < now() then
    raise exception '這個連結過期或用過了，請孩子在登入畫面再按一次「忘記密碼」';
  end if;
  select login_id into v_login from public.students where id = v_t.student_id;
  v_bad := public.password_problem(p_password, v_login); if v_bad is not null then raise exception '%', v_bad; end if;
  update public.park_reset_tokens set used_at = now() where token_hash = v_t.token_hash;
  update public.students set pw_hash = crypt(lower(p_password), gen_salt('bf')), failed_attempts = 0, locked_until = null where id = v_t.student_id;
  insert into public.park_audit (actor, actor_name, action, target, detail)
  values (auth.uid(), '爸媽信箱連結', 'reset_by_mail', v_login, '{}'::jsonb);
  return v_login;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. 改寫讀取：只算確認過的；等待中的另外列
-- -----------------------------------------------------------------------------
-- 孩子的爸媽任務卡：多 pending（等我確認的大人）、guardians（已連起來的，可按「不是我的爸媽」）
create or replace function public.park_parent_links_me()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := public.current_student_id();
begin
  if v_me is null then return null; end if;
  return jsonb_build_object(
    'pending', coalesce((select jsonb_agg(jsonb_build_object('id', g.guardian, 'name', t.display_name, 'at', g.created_at) order by g.created_at)
                           from public.park_guardians g join public.teachers t on t.user_id = g.guardian
                          where g.student_id = v_me and g.status = 'pending' and g.created_at > now() - interval '14 days'), '[]'),
    'guardians', coalesce((select jsonb_agg(jsonb_build_object('id', g.guardian, 'name', t.display_name,
                                                               'at', coalesce(g.confirmed_at, g.created_at),
                                                               'fresh', coalesce(g.confirmed_at, g.created_at) > now() - interval '7 days') order by g.created_at)
                             from public.park_guardians g join public.teachers t on t.user_id = g.guardian
                            where g.student_id = v_me and g.status = 'active'), '[]'));
end;
$$;

-- 家長後台：等孩子確認中的
create or replace function public.park_parent_waiting()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.park_require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nickname', s.nickname, 'at', g.created_at) order by g.created_at)
                     from public.park_guardians g join public.students s on s.id = g.student_id
                    where g.guardian = auth.uid() and g.status = 'pending' and g.created_at > now() - interval '14 days'), '[]');
end;
$$;

-- 家長後台：這個孩子還連了誰（可以移除另一位）
create or replace function public.park_parent_others(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.park_is_guardian(p_student) then raise exception '這個孩子沒有和你連起來'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.guardian, 'name', t.display_name, 'status', g.status, 'mine', g.guardian = auth.uid(),
                                                      'at', coalesce(g.confirmed_at, g.created_at)) order by g.created_at)
                     from public.park_guardians g join public.teachers t on t.user_id = g.guardian
                    where g.student_id = p_student), '[]');
end;
$$;

-- 下面三支是 park_parent.sql 的同名函式，只多「status = 'active'」
do $do$
declare v_src text; v_fn text;
begin
  foreach v_fn in array array['public.park_parent_kids()'::text, 'public.park_parent_me()'] loop
    v_src := pg_get_functiondef(v_fn::regprocedure);
    if v_src !~ 'g\.status = ''active''' then
      v_src := replace(v_src, 'where g.guardian = auth.uid()), ''[]''::jsonb)', 'where g.guardian = auth.uid() and g.status = ''active''), ''[]''::jsonb)');
      v_src := replace(v_src, 'v_linked := exists (select 1 from public.park_guardians g where g.student_id = v_me);',
                              'v_linked := exists (select 1 from public.park_guardians g where g.student_id = v_me and g.status = ''active'');');
      v_src := replace(v_src, 'join public.teachers t on t.user_id = g.guardian where g.student_id = v_me),',
                              'join public.teachers t on t.user_id = g.guardian where g.student_id = v_me and g.status = ''active''),');
      execute v_src;
    end if;
  end loop;
end $do$;

-- 管理員的家長綁定表：多 status
drop function if exists public.park_admin_guardians();
create or replace function public.park_admin_guardians()
returns table (student_id uuid, nickname text, login text, class_code text, class_name text,
               guardian uuid, guardian_name text, guardian_email text, guardian_active boolean,
               via text, linked_at timestamptz, last_view timestamptz, status text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception '只有管理員可以看'; end if;
  return query
    select s.id, s.nickname, s.login_id, s.class_code, c.name,
           g.guardian, t.display_name, u.email::text, t.active,
           g.via, g.created_at,
           (select max(e.at) from public.park_parent_events e
             where e.student_id = g.student_id and e.guardian = g.guardian and e.kind = 'view'),
           g.status
      from public.park_guardians g
      join public.students s on s.id = g.student_id
      left join public.classes c on c.code = s.class_code
      left join public.teachers t on t.user_id = g.guardian
      left join auth.users u on u.id = g.guardian
     order by g.created_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. 權限
-- -----------------------------------------------------------------------------
revoke all on function
  public.park_parent_home_of(uuid), public.park_put_in_home(uuid, uuid), public.park_take_from_home(uuid, uuid),
  public.park_mail_html(text, text, text, text), public.park_notify_guardians(uuid, text, text, text, uuid),
  public.park_kid_name(uuid), public.park_staff_name(uuid), public.park_unbind(uuid, uuid, text), public.park_pw_changed(),
  public.park_parent_bind(uuid, text), public.park_home_class_of(uuid), public.park_is_guardian(uuid)
  from public, anon, authenticated;
grant execute on function
  public.park_parent_redeem(text), public.park_parent_answer(uuid, boolean), public.park_parent_invite(text, text),
  public.park_parent_invite_info(text), public.park_parent_invite_accept(text), public.park_parent_unbind(uuid, uuid),
  public.park_parent_not_mine(uuid, text), public.park_parent_links_me(), public.park_parent_waiting(),
  public.park_parent_others(uuid), public.park_admin_guardians()
  to authenticated;
grant execute on function public.park_forgot_password(text, text), public.park_reset_info(text), public.park_reset_with_token(text, text)
  to anon, authenticated;
