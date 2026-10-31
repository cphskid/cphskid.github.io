-- 開班帳號的身分：老師或家長（2026-10-30 權限盤點，Chuck 同意）。
-- 只影響畫面（後台的稱呼、開班預設成家庭班、家長的引導），不影響權限；權限照班級和監護人（park_parent.sql）。
-- 套用順序：park_teacher.sql 之後。舊帳號沒有選過的，畫面照舊規則猜（開的班全是家庭班＝家長）。
create table if not exists public.park_staff_roles (
  user_id    uuid primary key references public.teachers(user_id) on delete cascade,
  role       text not null check (role in ('teacher', 'parent')),
  updated_at timestamptz not null default now()
);
alter table public.park_staff_roles enable row level security;
revoke all on public.park_staff_roles from public, anon, authenticated;

create or replace function public.park_set_staff_role(p_role text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.park_require_staff();
  if p_role not in ('teacher', 'parent') then raise exception '身分只能選老師或家長'; end if;
  insert into public.park_staff_roles (user_id, role) values (auth.uid(), p_role)
  on conflict (user_id) do update set role = excluded.role, updated_at = now();
  return p_role;
end;
$$;

create or replace function public.park_my_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select r.role from public.park_staff_roles r where r.user_id = auth.uid();
$$;

revoke all on function public.park_set_staff_role(text), public.park_my_role() from public, anon;
grant execute on function public.park_set_staff_role(text), public.park_my_role() to authenticated;
