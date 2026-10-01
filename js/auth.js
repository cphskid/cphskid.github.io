// 樂園的帳號：跟守護異世界共用同一個 Supabase、同一套帳號。
//
// 因為樂園（/）跟遊戲（/gaming_english_practice/）在同一個網址底下，
// supabase-js 把登入狀態存在同一個 localStorage 的同一把鑰匙（sb-<專案>-auth-token），
// 所以在樂園登入一次，進遊戲就已經是登入的；在任何一邊登出，兩邊一起登出。
//
// 學生：裝置先匿名登入，再用帳號密碼把這台裝置綁到學生身上（register_student / login_student，
//       不收 email、不寄信）。老師／家長：email＋密碼（register_teacher 直接開好，不寄確認信）。
// 這些函式都是守護異世界 schema.sql 裡已經驗證過的；樂園另外加的只有 park_ 開頭的幾支（supabase/park_accounts.sql）。

const IS_DEV = /^\/dev(\/|$)/.test(location.pathname);

// 只放公開的 publishable key（安全靠資料庫的 RLS，不是靠藏金鑰）。絕對不要放 sb_secret_。
const PROJECTS = {
  // 測試庫「English game test dev area」，跟守護異世界的測試站同一個
  dev:  { url: 'https://dshggoumgqzpmzrpedyl.supabase.co', key: 'sb_publishable_l5msdhfjw1YYogWZ85K6VA_yZGDm2cV' },
  // 正式庫，跟守護異世界的正式站同一個。發布前要先在正式庫跑 supabase/park_accounts.sql
  prod: { url: 'https://bxrppdsbhuhjluprohkf.supabase.co', key: 'sb_publishable_a99TJ4CiEW14ToPcoyn4KQ_NdoqXg2A' },
};
const P = IS_DEV ? PROJECTS.dev : PROJECTS.prod;

// supabase.js 是 vendor 進來的 UMD 版（js/vendor/supabase.js），載入失敗就整個帳號功能關掉，地圖照常
const lib = globalThis.supabase;
export const db = lib ? lib.createClient(P.url, P.key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

// 錯誤訊息：資料庫函式丟出來的已經是小朋友看得懂的中文，其他的翻成白話
function nice(error) {
  const m = String(error?.message ?? error ?? '');
  if (/anonymous sign-ins are disabled/i.test(m)) return '學生登入暫時不能用（後台沒開匿名登入），請告訴老師';
  if (/invalid login credentials/i.test(m)) return 'email 或密碼不對';
  if (/failed to fetch|network/i.test(m)) return '連不上網路，檢查一下網路再試一次';
  if (/rate limit|too many/i.test(m)) return '同時登入的人太多了，等一下再試';
  return m || '發生錯誤，請再試一次';
}
function check(error) { if (error) throw new Error(nice(error)); }

async function session() {
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session;
}

// 學生的動作一定要先有一個匿名身分。如果這台裝置現在登入的是老師，先登出老師。
async function ensureStudentSession() {
  if (!db) throw new Error('帳號功能載入失敗，重新整理再試一次');
  const s = await session();
  if (s && s.user.is_anonymous) return;
  if (s) await db.auth.signOut();
  const { error } = await db.auth.signInAnonymously();
  check(error);
}

// ---------- 我是誰 ----------
// 回傳 { kind: 'guest' | 'student' | 'staff', ... }，欄位見 park_accounts.sql 的 park_me()。
// 測試庫還沒跑 park_accounts.sql 時，退回用守護異世界原本就有的函式湊出同樣的形狀。
export async function me() {
  const s = await session();
  if (!s) return { kind: 'guest' };
  const { data, error } = await db.rpc('park_me');
  if (!error) return data;
  if (error.code !== 'PGRST202') return { kind: 'guest' };
  return legacyMe(s);
}
async function legacyMe(s) {
  if (!s.user.is_anonymous) {
    const { data } = await db.from('teachers').select('display_name, is_admin, active').eq('user_id', s.user.id).maybeSingle();
    if (!data) return { kind: 'guest' };
    const { data: has } = await db.rpc('has_admin');
    return { kind: 'staff', email: s.user.email, ...data, has_admin: !!has, legacy: true };
  }
  const { data: id } = await db.rpc('current_student_id');
  if (!id) return { kind: 'guest' };
  const { data: st } = await db.from('students').select('id, nickname, class_code').eq('id', id).maybeSingle();
  if (!st) return { kind: 'guest' };
  let classes = [];
  if (st.class_code) {
    const { data: c } = await db.from('classes').select('code, name').eq('code', st.class_code).maybeSingle();
    classes = [{ code: st.class_code, name: c?.name ?? '', owner_name: '', primary: true }];
  }
  return { kind: 'student', id: st.id, login_id: '', nickname: st.nickname, primary_class: st.class_code, classes, legacy: true };
}

// ---------- 學生 ----------
export async function studentLogin(loginId, password) {
  await ensureStudentSession();
  const { data, error } = await db.rpc('login_student', { p_login_id: loginId.trim().toLowerCase(), p_password: password });
  check(error);
  const row = data?.[0];
  if (!row) throw new Error('登入失敗，伺服器沒有回應');
  if (row.error) throw new Error(row.error);
}
export async function studentRegister(loginId, password, nickname, classCode) {
  await ensureStudentSession();
  const { error } = await db.rpc('register_student', {
    p_login_id: loginId.trim().toLowerCase(), p_password: password,
    p_nickname: nickname.trim(), p_class_code: classCode.trim().toUpperCase(),
  });
  check(error);
}
export async function joinClass(code) {
  const { data, error } = await db.rpc('park_join_class', { p_class_code: code.trim().toUpperCase() });
  if (error?.code === 'PGRST202') throw new Error('加入多個班的功能還沒裝到資料庫，請告訴管理員');
  check(error);
  return data;
}
export async function leaveClass(code) {
  const { error } = await db.rpc('park_leave_class', { p_class_code: code });
  check(error);
}
export async function setNickname(nick) {
  const { data, error } = await db.rpc('student_set_nickname', { p_nickname: nick.trim() });
  check(error);
  return data;
}
export async function setPassword(oldPw, newPw) {
  const { error } = await db.rpc('student_set_password', { p_old: oldPw, p_new: newPw });
  check(error);
}

// ---------- 老師／家長／管理員 ----------
export async function staffLogin(email, password) {
  if (!db) throw new Error('帳號功能載入失敗，重新整理再試一次');
  const s = await session();
  if (s) await db.auth.signOut();
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  check(error);
  // 系統全空時，第一個登入的人會在這裡變成管理員（claim_teacher 的規則）；已經是老師就什麼都不做
  await db.rpc('claim_teacher', { p_display_name: null });
  const who = await me();
  if (who.kind !== 'staff') {
    await db.auth.signOut();
    throw new Error('這個 email 還沒有開班帳號，請按「第一次使用」建立');
  }
  if (who.active === false) {
    await db.auth.signOut();
    throw new Error('這個帳號已經被管理員停用了');
  }
  return who;
}
// 不走 auth.signUp（會寄確認信，寄信額度一小時只有兩封）：register_teacher 直接開好帳號，再登入。
// register_teacher 用匿名身分數「同一台裝置開了幾個帳號」，所以要先有身分。
export async function staffSignUp(email, password, name, adult) {
  await ensureStudentSession();
  const { error } = await db.rpc('register_teacher', {
    p_email: email.trim(), p_password: password, p_display_name: name.trim(), p_adult: adult,
  });
  check(error);
  return staffLogin(email, password);
}
export async function claimFirstAdmin() {
  const { error } = await db.rpc('claim_first_admin');
  check(error);
}

export async function logout() {
  if (db) await db.auth.signOut();
}
