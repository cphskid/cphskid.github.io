-- =============================================================================
-- 樂園寄信（2026-11-05）：信箱排隊表＋寄信函式。真正寄出的是 Edge Function send-mail（Resend）。
-- 用法（只給資料庫裡的函式用，前端不能直接呼叫）：
--   select public.park_mail_send('someone@example.com', '主旨', '<p>內文 html</p>', 'kind 代號', '純文字版（可省）');
-- 會插一筆 park_mail_outbox，觸發器用 pg_net 叫醒 send-mail；寄完 status=sent，失敗會重試 3 次。
-- 這張表也是寄信紀錄（換寄信服務也不會遺失）。可重跑。
-- =============================================================================
create extension if not exists pg_net with schema extensions;

create table if not exists public.park_mail_outbox (
  id          bigint generated always as identity primary key,
  kind        text not null default 'misc',            -- 例：test、parent_confirm、login_link、news
  to_email    text not null check (to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject     text not null check (char_length(subject) between 1 and 150),
  html        text not null,
  text        text,
  reply_to    text,
  status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  tries       int not null default 0,
  error       text,
  provider_id text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists park_mail_outbox_pending on public.park_mail_outbox (id) where status in ('pending', 'sending');
alter table public.park_mail_outbox enable row level security;   -- 沒有 policy：前端讀寫不到
revoke all on public.park_mail_outbox from anon, authenticated;

-- 寄信函式網址：每個庫不一樣，套完這份後另外 update 一次（見檔尾註解）
create table if not exists public.park_mail_config (
  id     int primary key default 1 check (id = 1),
  fn_url text not null
);
alter table public.park_mail_config enable row level security;
revoke all on public.park_mail_config from anon, authenticated;

-- 叫醒 send-mail（沒設網址就只排隊，不報錯）
create or replace function public.park_mail_kick()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_url text;
begin
  select fn_url into v_url from public.park_mail_config where id = 1;
  if v_url is not null then
    perform net.http_post(url := v_url, body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb);
  end if;
  return null;
end;
$$;
drop trigger if exists park_mail_kick on public.park_mail_outbox;
create trigger park_mail_kick after insert on public.park_mail_outbox
  for each statement execute function public.park_mail_kick();

-- 給其他資料庫函式用的寄信入口（前端不能直接呼叫）
create or replace function public.park_mail_send(p_to text, p_subject text, p_html text, p_kind text default 'misc', p_text text default null, p_reply_to text default null)
returns bigint language sql security definer set search_path = public, pg_temp as $$
  insert into public.park_mail_outbox (kind, to_email, subject, html, text, reply_to)
  values (coalesce(p_kind, 'misc'), lower(btrim(p_to)), p_subject, p_html, p_text, p_reply_to)
  returning id;
$$;
revoke all on function public.park_mail_send(text, text, text, text, text, text) from public, anon, authenticated;

-- send-mail 用：搶下要寄的信（pending，或卡在 sending 超過 5 分鐘的）
create or replace function public.park_mail_claim(p_limit int default 20)
returns setof public.park_mail_outbox language sql security definer set search_path = public, pg_temp as $$
  update public.park_mail_outbox o set status = 'sending', tries = o.tries + 1
   where o.id in (select id from public.park_mail_outbox
                   where status = 'pending' or (status = 'sending' and created_at < now() - interval '5 minutes' and tries < 4)
                   order by id limit greatest(1, least(p_limit, 50)) for update skip locked)
  returning o.*;
$$;
revoke all on function public.park_mail_claim(int) from public, anon, authenticated;
grant execute on function public.park_mail_claim(int) to service_role;

-- -----------------------------------------------------------------------------
-- 樂園風格信件外框（2026-11-05）：藍天底、樂園 logo、奶油色木框卡片、綠色按鈕、滴答署名。
-- 樣板原檔 mail/layout.html、mail/button.html（改了這兩個檔要重新產生這段）。
--   select public.park_mail_send(信箱, 主旨,
--     public.park_mail_layout('標題', '<p>內文 html</p>', '按鈕字', 'https://…'), 'kind');
-- 標題、按鈕字會自動跳脫；內文是 html，自己組時要跳脫使用者輸入（用 public.park_mail_esc）。
-- -----------------------------------------------------------------------------
create or replace function public.park_mail_esc(p text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

create or replace function public.park_mail_layout(p_title text, p_body_html text, p_button_text text default null,
  p_button_url text default null, p_sign text default '時空冒險樂園 園長 敬上', p_foot text default '')
returns text language sql immutable as $fn$
  select replace(replace(replace(replace(replace($tpl$<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{TITLE}}</title></head>
<body style="margin:0;padding:0;background:#2f9fd8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#2f9fd8;background-image:linear-gradient(#8fd3f4,#2f9fd8 260px)">
<tr><td align="center" style="padding:24px 12px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td align="center" style="padding:0 0 14px"><a href="https://timepark.ciyulab.com/" style="text-decoration:none"><img src="https://timepark.ciyulab.com/img/mail/logo.png" width="300" alt="時空冒險樂園 Time Adventure Park" style="display:block;width:300px;max-width:80%;height:auto;border:0"></a></td></tr>
<tr><td style="background:#fff4dc;border:4px solid #6b3f1f;border-radius:22px;box-shadow:0 6px 0 #6b3f1f;padding:28px 28px 22px;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;color:#3a2412">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.4;color:#6b3f1f;font-weight:900">{{TITLE}}</h1>
<div style="font-size:16px;line-height:1.8;color:#3a2412">{{BODY}}</div>
{{BUTTON}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;border-top:2px dashed #f6dfb4">
<tr><td width="64" valign="bottom" style="padding-top:14px"><img src="https://timepark.ciyulab.com/img/mail/wave.png" width="56" alt="滴答" style="display:block;width:56px;height:auto;border:0"></td>
<td valign="middle" style="padding:14px 0 0 10px;font-size:14px;line-height:1.7;color:#8a5429">{{SIGN}}</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:18px 8px 0;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;font-size:13px;line-height:1.7;color:#ffffff">
時空冒險樂園 · <a href="https://timepark.ciyulab.com/" style="color:#ffffff">timepark.ciyulab.com</a><br>
有任何問題，直接回覆這封信就會寄到園長信箱 timepark@ciyulab.com{{FOOT}}
</td></tr>
</table></td></tr></table></body></html>
$tpl$,
    '{{TITLE}}', public.park_mail_esc(p_title)),
    '{{BODY}}', coalesce(p_body_html, '')),
    '{{BUTTON}}', case when coalesce(p_button_text, '') <> '' and p_button_url ~ '^https://'
      then replace(replace($btn$<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 4px"><tr><td align="center" style="background:#4caf2e;border-radius:999px;border-bottom:4px solid #2f7a1c"><a href="{{URL}}" style="display:inline-block;padding:14px 34px;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;font-size:18px;font-weight:900;color:#ffffff;text-decoration:none">{{TEXT}}</a></td></tr></table>$btn$, '{{URL}}', public.park_mail_esc(p_button_url)), '{{TEXT}}', public.park_mail_esc(p_button_text))
      else '' end),
    '{{SIGN}}', public.park_mail_esc(p_sign)),
    '{{FOOT}}', coalesce(p_foot, ''))
$fn$;

-- 套完後每個庫各設一次：
--   insert into public.park_mail_config (id, fn_url) values (1, 'https://<ref>.supabase.co/functions/v1/send-mail')
--   on conflict (id) do update set fn_url = excluded.fn_url;
