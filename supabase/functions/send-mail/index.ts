// 樂園共用寄信：把 public.park_mail_outbox 裡還沒寄的信，用 Resend 寄出去。
// 誰要寄信：在資料庫插一筆到 park_mail_outbox（或呼叫 public.park_mail_send），觸發器會叫醒這支。
// 這支不收任何參數、只寄信箱裡排隊的信，所以不用登入也安全。換寄信服務只要改 sendOne()。
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const FROM = 'ciyulab 時空冒險樂園 <timepark@ciyulab.com>';
const REPLY_TO = 'timepark@ciyulab.com';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function sendOne(m: { to_email: string; subject: string; html: string; text: string | null; reply_to: string | null }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [m.to_email], subject: m.subject, html: m.html, text: m.text ?? undefined, reply_to: m.reply_to ?? REPLY_TO }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return (j as { id?: string }).id ?? null;
}

Deno.serve(async () => {
  // 一次最多 20 封；先把狀態改成 sending 搶下來，避免兩次叫醒寄兩次
  const { data: rows, error } = await db.rpc('park_mail_claim', { p_limit: 20 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  let sent = 0, failed = 0;
  for (const m of rows ?? []) {
    try {
      const id = await sendOne(m);
      await db.from('park_mail_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), provider_id: id, error: null }).eq('id', m.id);
      sent++;
    } catch (e) {
      await db.from('park_mail_outbox').update({ status: m.tries >= 3 ? 'failed' : 'pending', error: String(e).slice(0, 500) }).eq('id', m.id);
      failed++;
    }
  }
  return new Response(JSON.stringify({ sent, failed }), { headers: { 'Content-Type': 'application/json' } });
});
