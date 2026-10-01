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

1. `zones` 加一座島：`code`、`name`、`subtitle`（科目）、`slot`（放在地圖哪個空位）、`art`（去背島圖）、`status`。
2. `facilities` 加一個設施：所屬 `zone`、`name`、`subject`、`grade_min`/`grade_max`（只當參考、不擋人）、`status`、`url`（正式站）、`url_dev`（測試站）。
3. 空位不夠時，在 `map.slots` 往右加，並把 `map.width` 加大，地圖會自動可以左右拖曳。

狀態有五種：`open` 開放中、`trial` 試營運、`construction` 施工中、`maintenance` 維修中、`hidden`（當作沒有，空位顯示雲霧）。
欄位照平台規劃書的 `park_zones`、`park_facilities` 設計，之後搬進資料庫只換讀取的地方。

## 遊戲回到樂園

遊戲裡的「回樂園」按鈕連到 `/#map`，會直接回到島嶼地圖；`/#map/castle` 會打開那座島的介紹卡。

## 私有素材

Tiny Swords 小兵圖禁止散布，不在這個 repo（見 `CREDITS.md`）。要有小兵，需要在 repo 的
Settings → Secrets and variables → Actions 加一個 `ASSETS_TOKEN`（能讀 `cphskid/gaming_english_assets` 的金鑰，
可以跟守護異世界用同一把）。沒有的話網站照常運作，只是島上沒有小兵。
