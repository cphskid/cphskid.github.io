-- 問題回報自動截圖（2026-11-08，Chuck：小朋友的文字常看不懂，回報時自動附上當下畫面）
--
-- js/feedback.js 打開回報視窗時先拍一張畫面（縮到約 960px 寬的 WebP/JPEG，通常 50–120 KB），
-- 送出時上傳到私密空間 feedback-shots/<自己的 user id>/<時間>.webp，路徑記在 feedback.context.shot。
--   * 誰能上傳：登入的人，只能放進自己 user id 的資料夾
--   * 誰能看：只有管理員（老師、家長、本人都看不到；畫面上可能有別的孩子暱稱）
--   * 留多久：30 天，每天臺灣 04:10 由 pg_cron 叫 Edge Function feedback-shots-sweep 用 Storage API 刪掉
--     （storage.objects 不能直接 delete，會留下孤兒檔，所以一定要走 Storage API）
-- 冪等，可以重複套。

-- ---------- 空間 ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-shots', 'feedback-shots', false, 600000, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "feedback shots: upload own" on storage.objects;
create policy "feedback shots: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback-shots' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "feedback shots: admin read" on storage.objects;
create policy "feedback shots: admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-shots' and public.is_admin());

-- ---------- 30 天到期的檔名（給 Edge Function 用 service role 拿） ----------
create or replace function public.feedback_shots_expired(p_days int default 30, p_limit int default 500)
returns setof text language sql stable security definer set search_path = public, storage, pg_temp as $$
  select o.name from storage.objects o
   where o.bucket_id = 'feedback-shots' and o.created_at < now() - make_interval(days => p_days)
   order by o.created_at
   limit p_limit;
$$;
revoke all on function public.feedback_shots_expired(int, int) from public, anon, authenticated;
grant execute on function public.feedback_shots_expired(int, int) to service_role;

-- ---------- 每天清一次 ----------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 網址沿用寄信設定（park_mail_config 的 send-mail 網址換成這支），測試庫／正式庫各自對
do $$
begin
  if exists (select 1 from cron.job where jobname = 'feedback-shots-sweep') then
    perform cron.unschedule('feedback-shots-sweep');
  end if;
  perform cron.schedule('feedback-shots-sweep', '10 20 * * *', $c$
    select net.http_post(
      url := replace((select fn_url from public.park_mail_config where id = 1), '/send-mail', '/feedback-shots-sweep'),
      body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)
     where exists (select 1 from public.park_mail_config where id = 1 and fn_url is not null)
  $c$);
end $$;
