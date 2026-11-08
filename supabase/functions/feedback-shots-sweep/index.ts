// 問題回報截圖：刪掉超過 30 天的（2026-11-08）。每天 pg_cron 叫一次（supabase/park_feedback_shots.sql）。
// 不收任何參數、只刪到期的檔案，所以不用登入也安全（verify_jwt = false）。
// storage.objects 不能直接 delete（會留孤兒檔），一定要走 Storage API。
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BUCKET = 'feedback-shots';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async () => {
  let removed = 0;
  for (let round = 0; round < 10; round++) {
    const { data: names, error } = await db.rpc('feedback_shots_expired', { p_days: 30, p_limit: 500 });
    if (error) return new Response(JSON.stringify({ error: error.message, removed }), { status: 500 });
    const list = (names ?? []) as string[];
    if (!list.length) break;
    const { error: e2 } = await db.storage.from(BUCKET).remove(list);
    if (e2) return new Response(JSON.stringify({ error: e2.message, removed }), { status: 500 });
    removed += list.length;
    if (list.length < 500) break;
  }
  return new Response(JSON.stringify({ removed }), { headers: { 'Content-Type': 'application/json' } });
});
