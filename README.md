# 時空冒險樂園

各科學習遊戲的統一入口：<https://cphskid.github.io/>（測試站 <https://cphskid.github.io/dev/>）。
小朋友在樂園地圖上點一座島、選一個設施，就進到那個遊戲。

| 網址 | 內容 | 從哪裡來 |
| --- | --- | --- |
| `/` | 樂園正式站 | 本 repo 的 `main` |
| `/dev/` | 樂園測試站 | 本 repo 的 `dev` |
| `/gaming_english_practice/` | 守護異世界（英文） | 它自己的 repo |
| `/Taiwan-island/` | 穿越吧！島嶼開拓者（社會） | 它自己的 repo（開發中） |

## 開發規則

- 一律先改 `dev`，在 `/dev/` 試過，Chuck 說「發布」才合進 `main`。
- 純靜態網頁，沒有建置步驟：`python3 -m http.server` 在 repo 根目錄跑起來就能看。
- 推 `main` 或 `dev` 都會由 `.github/workflows/pages.yml` 重新發佈（兩份一起包）。

## 新增一座島或一個設施

全部在 `data/park.json`，不用改程式：

1. `zones` 加一座島：`code`、`name`、`subtitle`（名牌下的玩法類型，不寫科目）、`slot`（放在地圖哪個空位）、`art`（去背島圖）、`status`。
2. `facilities` 加一個設施：所屬 `zone`、`name`、`genre`（玩法類型）、`stars`（挑戰度 1–3）、`subject`、`grade_min`/`grade_max`（科目和年級只給老師後台看，學生畫面不顯示）、`status`、`url`（正式站）、`url_dev`（測試站）。
3. 空位不夠時，在 `map.slots` 往右加，並把 `map.width` 加大，地圖會自動可以左右拖曳。

狀態有五種：`open` 開放中、`trial` 試營運、`construction` 施工中、`maintenance` 維修中、`hidden`（當作沒有，空位顯示雲霧）。
欄位照平台規劃書的 `park_zones`、`park_facilities` 設計，之後搬進資料庫只換讀取的地方。

## 遊戲回到樂園

遊戲裡的「回樂園」按鈕連到 `/#map`，會直接回到島嶼地圖；`/#map/castle` 會打開那座島的介紹卡。

## 帳號（P1）

樂園跟各遊戲共用同一個 Supabase、同一套帳號（守護異世界的 `teachers` / `classes` / `students` / `student_links`）。
測試站 `/dev/` 接測試庫，正式站 `/` 接正式庫，設定在 `js/auth.js`。

- 因為都在 `cphskid.github.io` 這個網址底下，登入狀態存在同一個 localStorage，
  **在樂園登入一次，進守護異世界就已經登入；任何一邊登出，兩邊一起登出。**
- 學生：班級代碼＋帳號＋密碼＋暱稱，不收 email。老師／家長：email 註冊，不寄確認信。
  系統還沒有管理員時，老師入口會出現「我是第一個使用者」。
- 多班級：`park_class_members` 記學生加入的所有班；`students.class_code` 保留當主要班級
  （守護異世界的排行榜、班內暱稱不重複都用它）。學生在「我的資料」用代碼加入其他班。
- 老師分享帶代碼的連結：`/?join=班級代碼` 會直接打開「第一次來」並填好代碼。

資料庫的部分在 `supabase/park_accounts.sql`（只加表、加函式、加觸發器，不動守護異世界的東西）：

1. Supabase 後台 → SQL Editor → 整份貼上 → Run。可以重複執行。先套測試庫，發布前再套正式庫。
2. **守護異世界每次重跑它的 `schema.sql` 之後，這份要再跑一次**：它的 schema 開頭會收回所有權限。
3. 改之前先跑 `./tools/test/db.sh`（本機 Postgres，先跑守護異世界的 schema 再跑這份與權限測試）。

還沒套 `park_accounts.sql` 的資料庫，樂園照樣能登入、註冊（用守護異世界原本的函式），只是不能加入多個班。

## 私有素材

Tiny Swords 小兵圖禁止散布，不在這個 repo（見 `CREDITS.md`）。要有小兵，需要在 repo 的
Settings → Secrets and variables → Actions 加一個 `ASSETS_TOKEN`（能讀 `cphskid/gaming_english_assets` 的金鑰，
可以跟守護異世界用同一把）。沒有的話網站照常運作，只是島上沒有小兵。

## 老師後台（P2）

`teacher.html`：老師、家長、管理員共用的後台，取代守護異世界的老師後台（它原本那套在過渡期照常可用）。
老師在樂園大門登入後直接進來；右上角的名字也點得到。

- **我的班級**：開班（代碼由系統產生、選學校班或家庭班與年級）、分享連結、開關加入、換代碼。
- **開放的遊戲**：勾選這個班可以玩哪些設施；適合該年級的排在前面。新開的班預設開放所有「開放中」的設施。
- **全班總覽**：一列一個學生（含從別班另外加入的），一欄一個開放的遊戲，資料來自各遊戲的 `<前綴>_class_summary`。
  可以只看需要注意的、匯出 CSV，學生可以重設密碼、改暱稱、移出班級（只移出，不刪帳號）。
- **管理員**：設施狀態（開放中／試營運／施工中／維修中／隱藏）、適合年級、試玩班；老師帳號的上限與停用；
  所有班級與換開班人；幫人開帳號；操作紀錄。

資料庫在 `supabase/park_teacher.sql`（順序：守護異世界 schema.sql → park_accounts.sql → park_teacher.sql，可重複執行）。
守護異世界的全班摘要 `guardian_class_summary` 暫時放在這份，P3 接上守護異世界時搬回它的 repo。
地圖上的設施狀態以資料庫為準（`park_facility_list`），連不上才用 `data/park.json`；
學生的班沒開放某個遊戲時，介紹卡會說「請問問老師」。遊戲自己的進場檢查（`park_can_enter`）在 P3 接上。
後台美術在 `img/admin/`（B-01～B-07，原圖在專案的 art/admin/）。

## 護照與頭像（P4）

- **樂園護照**：地圖左下角的護照（學生才有）、樂園村莊的介紹卡、「我的資料」都打得開。每個遊戲一頁，
  蓋到的章亮起來、沒蓋到的顯示怎麼拿到，還沒做好的部分顯示「即將開放」。剛蓋的新章第一次打開會「咚」一聲蓋下去。
- **頭像**：一開始 12 個可以選，其他 12 個靠蓋章或蓋滿一頁解鎖；頭像框 5 種（木頭、天空、銀、金、彩虹）。
  第一次登入會請小朋友挑一個。頭像會出現在右上角、護照、老師後台的全班總覽（連同章數）。
- **遊戲怎麼蓋章**（規劃書「遊戲接入規則」第 4 條）：
  1. 遊戲在學生完成時呼叫 `park_award_stamp(設施代碼, 章代碼)`，回傳 `{ok, new, name, art, unlocked}`，不丟錯。
  2. 或者提供 `<前綴>_earned_stamps(學生 id) returns setof text`，樂園打開時自己補蓋。
     有提供的設施，第 1 條也要對得上才蓋得下去（小朋友不能自己叫函式蓋章）。
  守護異世界走第 2 條（`guardian_earned_stamps`，看伺服器判定的 `level_progress`，暫放在這份 SQL，之後搬回英文 repo）；
  島嶼開拓者兩條都有（過完一章叫 `park_award_stamp`，`island_earned_stamps` 在它的 `island_pioneer.sql`）。
- 章的定義（`park_stamps`）與頭像解鎖條件（`park_rewards`）寫在 `supabase/park_passport.sql` 的初始資料；章的圖在 `img/stamp/`，頭像在 `img/avatar/`。
- 資料庫：`supabase/park_passport.sql`（順序：schema.sql → park_accounts.sql → park_teacher.sql → 這份 → 各遊戲的 SQL）。
  還沒套的資料庫，地圖照常，護照會說「還在準備中」，頭像退回滴答。

## 主島桌寵（一期）

規劃書：<https://claude.ai/code/artifact/9bf0398a-f6c6-4f6d-b9ff-eda3994cd702>。學生才有，資料庫在 `supabase/park_pet.sql`
（順序：schema.sql → park_accounts.sql → park_teacher.sql → park_passport.sql → 這份，可重複執行）。還沒套的資料庫，地圖上就不出現桌寵。

- **地圖**：樂園村莊上坐著自己的桌寵，還沒領養的是一顆時光蛋。餓了冒「!」、生氣冒「💢」、睡著冒「Zz」，滴答打招呼也會提醒。
- **領養**：小狗、小貓、黃金鼠三選一，或選「隨機」；可以取名（1～8 個字，跟暱稱一樣過濾不雅字），之後也能改。
- **餓的規則**：一天沒餵會餓、再一天生氣、7 天沒來睡著（不會死）。生氣時餵飽了還要摸摸哄一下；睡著的點一下叫醒，醒來是餓的。週末寒暑假不暫停。
- **道具**：每天在主島免費領 3 份時光飼料（背包最多 9 份）；在一個遊戲蓋到護照章，就送那座島的招牌點心
  （守護異世界＝異世界魔法果、島嶼開拓者＝八堡圳米糰），以前蓋的章也會補送。飼料 3 小時內只吃一次，點心隨時吃。
- **長大**：飼料 +1、點心 +5、摸摸一天 +1；12 點長成「成長期」、40 點「完全體」。
- **小窩狀態**：飽足、心情各 5 格，旁邊一句提示（例如「大約 5 小時後會餓」「有點無聊，摸摸牠吧」）。
- **寵物島**：地圖 `pet_slot`（data/park.json，現在是 slot 5）放寵物島，佔位圖用 `img/decor/sandbar.webp`。小窩一次只住一隻，
  其他夥伴縮小在島上走動，不會餓也不會長大；點島可以把一隻帶回小窩（小窩那隻餓、生氣、睡著時不肯走）。
  護照蓋到 3 個章、6 個章各多一顆時光蛋，可以再領養一隻起始夥伴，還沒解鎖的顯示灰色剪影。
- **老師**：後台「我的班級」可以打開「上課時間桌寵休息」（週一到週五 8:00–16:00，臺灣時間），任何一個班開了就算。
- 圖：三隻先用頭像圖當佔位（`img/pet/<種類>.webp`），正式的 T 系列動作表做好直接換檔；道具圖示先用表情符號。
- 本機看畫面不用連資料庫：`python3 -m http.server` 後開 `/tools/test/pet-preview.html`（網址參數見檔案開頭）。
