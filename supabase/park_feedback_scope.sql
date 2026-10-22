-- =============================================================================
-- 時空冒險樂園：問題回報只看樂園自己的
--
-- 同一個 Supabase 也放了別的專案（貓閣咖啡 catloft_*），它的 catloft_submit_feedback
-- 也寫進 public.feedback，只是 context.game 一定是 'catloft'，自己用 catloft_admin_feedback 讀。
-- 所以樂園後台、守護異世界管理員頁用的 list_feedback 要把 game = 'catloft' 排掉。
-- 只改 list_feedback；catloft 的表、資料、函式一個都不動。
-- 守護異世界 supabase/schema.sql 的 list_feedback 也同步改了，重跑那份不會改回去。
-- 可以重複執行。
-- =============================================================================

create or replace function public.list_feedback(
  p_status text default null, p_limit int default 200, p_hidden boolean default false)
returns setof public.feedback language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_all boolean := public.can_triage_feedback();
begin
  if not v_all and not exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.active) then
    raise exception '只有管理員和老師可以看回報';
  end if;
  return query
    select * from public.feedback f
     where (p_status is null or f.status = p_status)
       and coalesce(f.context ->> 'game', '') <> 'catloft'
       and (case when v_all and coalesce(p_hidden, false) then f.hidden_at is not null
                 else f.hidden_at is null end)
       and (v_all or (f.role = 'student' and f.class_code in
                        (select c.code from public.classes c where c.owner = auth.uid())))
     order by f.created_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;
