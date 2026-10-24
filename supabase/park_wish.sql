-- 許願池：還沒開幕（Beta）的設施，讓大家選「多想玩」。一人一票、可以改，只記最新的。
-- 四段：1 想玩、2 超想玩、3 迫不及待、4 太好玩了快出！
-- 學生和老師都能投：學生以學生編號為準（同一個學生在不同裝置登入也算同一票），老師用登入帳號；票數大家都看得到，誰投的只有資料庫知道。
-- 重複套用沒關係。

create table if not exists public.park_wishes (
  facility   text not null references public.park_facilities(code) on delete cascade on update cascade,
  voter      uuid not null,
  level      smallint not null check (level between 1 and 4),
  updated_at timestamptz not null default now(),
  primary key (facility, voter)
);
alter table public.park_wishes enable row level security;
-- 不開放直接讀寫，一律走下面兩支函式

-- 投票的人：學生用學生編號，老師用登入帳號
create or replace function public.park_wish_voter()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_student_id(), auth.uid());
$$;

-- 票數＋自己投了哪一段
create or replace function public.park_wish_counts(p_facility text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'counts', (select jsonb_build_array(
                 count(*) filter (where level = 1), count(*) filter (where level = 2),
                 count(*) filter (where level = 3), count(*) filter (where level = 4))
                 from public.park_wishes where facility = p_facility),
    'mine', (select level from public.park_wishes where facility = p_facility and voter = public.park_wish_voter()));
$$;

-- 投票（或改票），回傳最新票數
create or replace function public.park_wish(p_facility text, p_level int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.park_wish_voter() is null then raise exception '要先登入才能許願'; end if;
  if p_level not between 1 and 4 then raise exception '沒有這個選項'; end if;
  if not exists (select 1 from public.park_facilities where code = p_facility and status <> 'hidden') then
    raise exception '找不到這個設施';
  end if;
  insert into public.park_wishes (facility, voter, level) values (p_facility, public.park_wish_voter(), p_level)
  on conflict (facility, voter) do update set level = excluded.level, updated_at = now();
  return public.park_wish_counts(p_facility);
end;
$$;

revoke all on function public.park_wish_voter(), public.park_wish_counts(text), public.park_wish(text, int) from public;
grant execute on function public.park_wish_counts(text) to anon, authenticated;
grant execute on function public.park_wish(text, int) to authenticated;
