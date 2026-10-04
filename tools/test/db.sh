#!/usr/bin/env bash
# 在本機開一個空的 Postgres：先跑守護異世界的 schema.sql（共用帳號表在那裡），
# 再跑樂園的 park_accounts.sql 與權限測試。
#
#   ./tools/test/db.sh                       # 守護異世界的 SQL 從 GitHub 抓 dev 分支
#   ENGLISH_REPO=../gaming_english_practice ./tools/test/db.sh   # 用本機的那份
#   ISLAND_REPO=../Taiwan-island ./tools/test/db.sh                # 順便試島嶼開拓者的 SQL
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGROOT=${PGROOT:-/tmp/pg-park}
SOCK="$PGROOT/sock"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNAS=${RUNAS:-claude}

if [ ! -x "$PGBIN/initdb" ]; then
  echo "找不到 Postgres（$PGBIN）。裝一個：apt-get install -y postgresql-16" >&2
  exit 1
fi

EN="$PGROOT/english"
mkdir -p "$EN"
if [ -n "${ENGLISH_REPO:-}" ]; then
  cp "$ENGLISH_REPO/supabase/schema.sql" "$ENGLISH_REPO/supabase/park_guardian.sql" "$ENGLISH_REPO/supabase/test/00_supabase_stub.sql" "$EN/"
else
  RAW=https://raw.githubusercontent.com/cphskid/gaming_english_practice/dev/supabase
  curl -fsSL "$RAW/schema.sql" -o "$EN/schema.sql"
  curl -fsSL "$RAW/park_guardian.sql" -o "$EN/park_guardian.sql"
  curl -fsSL "$RAW/test/00_supabase_stub.sql" -o "$EN/00_supabase_stub.sql"
fi

as_pg() { if [ "$(id -u)" = 0 ]; then su "$RUNAS" -c "PATH=$PGBIN:\$PATH $1"; else PATH=$PGBIN:$PATH sh -c "$1"; fi; }
"$PGBIN/pg_ctl" -D "$PGROOT/data" stop >/dev/null 2>&1 || true
rm -rf "$PGROOT/data" "$SOCK"
mkdir -p "$PGROOT/data" "$SOCK"
[ "$(id -u)" = 0 ] && chown -R "$RUNAS" "$PGROOT"
as_pg "initdb -D $PGROOT/data -U postgres --auth=trust" >/dev/null
as_pg "pg_ctl -D $PGROOT/data -o '-k $SOCK -c listen_addresses= -c log_min_messages=warning' -l $PGROOT/log start" >/dev/null
trap 'as_pg "pg_ctl -D $PGROOT/data stop" >/dev/null 2>&1 || true' EXIT

run() { "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo "── 守護異世界的 schema（共用帳號表）"
run -f "$EN/00_supabase_stub.sql" >/dev/null
run -f "$EN/schema.sql" >/dev/null 2>&1

echo "── park_accounts.sql"
cd "$ROOT"
run -f supabase/park_accounts.sql 2>&1 | grep -v NOTICE || true

echo "── 權限測試"
run -f supabase/test/park_accounts_test.sql 2>&1 | grep -E "✓|✗|ERROR|──" | sed 's/^psql:[^ ]* NOTICE:  //'

echo "── park_teacher.sql"
run -f supabase/park_teacher.sql 2>&1 | grep -v NOTICE || true

echo "── 守護異世界的 park_guardian.sql（全班摘要）"
run -f "$EN/park_guardian.sql" 2>&1 | grep -v NOTICE || true

echo "── P2 教師入口測試"
run -f supabase/test/park_teacher_test.sql 2>&1 | grep -E "✓|✗|ERROR|──" | sed 's/^psql:[^ ]* NOTICE:  //'

echo "── park_passport.sql"
run -f supabase/park_passport.sql 2>&1 | grep -v NOTICE || true

echo "── P4 護照與頭像測試"
run -f supabase/test/park_passport_test.sql 2>&1 | grep -E "✓|✗|ERROR|──" | sed 's/^psql:[^ ]* NOTICE:  //'

echo "── park_pet.sql"
run -f supabase/park_pet.sql 2>&1 | grep -v NOTICE || true

echo "── 桌寵一期測試"
run -f supabase/test/park_pet_test.sql 2>&1 | grep -E "✓|✗|ERROR|──" | sed 's/^psql:[^ ]* NOTICE:  //'

echo "── park_traveller.sql"
run -f supabase/park_traveller.sql 2>&1 | grep -v NOTICE || true

echo "── 時空旅人換裝測試"
run -f supabase/test/park_traveller_test.sql 2>&1 | grep -E "✓|✗|ERROR|──" | sed 's/^psql:[^ ]* NOTICE:  //'

# 島嶼開拓者的 SQL（有給 ISLAND_REPO 才跑）：確定它疊在樂園上面套得進去、護照接得到
if [ -n "${ISLAND_REPO:-}" ]; then
  echo "── 島嶼開拓者 island_pioneer.sql"
  run -f "$ISLAND_REPO/supabase/island_pioneer.sql" 2>&1 | grep -v NOTICE || true
  run -At -c "select case when public.park_earned(s.id, 'island_pioneer') is not null then '  ✓ 護照接得到島嶼開拓者的「該拿到哪些章」' else '  ✗ 護照接不到島嶼開拓者' end from public.students s limit 1"
fi
