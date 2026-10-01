#!/bin/sh
# 把私有素材 repo（cphskid/gaming_english_assets）裡樂園用的圖放回網站目錄。
#
#   sh tools/private-assets.sh [私有 repo 的本機路徑] [網站目錄，預設 .]
#
# 為什麼：Tiny Swords 的授權寫明「不得再散布，改過的也不行」，而這個 repo 是公開的，
# 所以小兵圖只放在私有 repo 的 park/overlay/（路徑照這個 repo 擺，例：park/overlay/img/ts/pawn_run.png），
# 發佈時 .github/workflows/pages.yml 用 ASSETS_TOKEN 拉下來再打包。網站上看得到，repo 裡沒有原檔。
# 放回來的檔案都寫在 .gitignore，不會被 commit 進來。
set -eu

SRC=${1:-private-assets}
DEST=${2:-.}
if [ ! -d "$SRC/park/overlay" ]; then
  git clone --depth 1 https://github.com/cphskid/gaming_english_assets "$SRC"
fi
cp -R "$SRC/park/overlay/." "$DEST/"
echo "樂園私有素材放回 $DEST"
