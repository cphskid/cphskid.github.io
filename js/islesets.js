// 島嶼風格套組（2026-11-19「提案島嶼風格與聖誕活動」）：十種島的風格，每種配 6 件同主題傢俱。
// 圖：地面 img/pet/land2/<風格>.webp、傢俱 img/pet/furniture/<id>.webp（Gemini 產、切圖在 /mnt/project-files/art/isle-themes/）。
// 價錢只給畫面顯示，真的價錢看資料庫 park_shop_items（supabase/park_isle.sql）；解鎖型的風格條件寫在 park_isle_themes。
// 每件：[id, 名字, 價錢, 在島上多寬, 圖高/寬, 怎麼用]；id 開頭 house- 的是小屋（寵物進去睡，佔 2×2）。
const P = (...a) => { const line = a.pop(); return { kind: 'play', at: [.5, 1.08], poses: a, every: 950, line }; };
const SIT = (x, y) => ({ kind: 'sit', at: [x, y] });
const SWAY = (x, y) => ({ kind: 'sit', at: [x, y], sway: true });
const LIE = (x, y) => ({ kind: 'lie', at: [x, y] });
const HOUSE = { kind: 'hide', sleep: true, at: [.3, .74], door: [.2, .95] };
export const SETS = [
  { id: 'nightmarket', name: '夜市燈籠', price: 350, how: '商店 350 幣', items: [
    ['nm-cart', '小吃攤車', 220, 70, 1.111, P('sniff','chew','sniff','cheer','好香的雞排！')],
    ['nm-lantern', '紅燈籠串', 150, 44, 1.361, P('look','cheer','look','燈籠亮起來了！')],
    ['nm-tea', '珍奶攤', 180, 52, 1.064, P('eat','chew','eat','珍珠好Q！')],
    ['nm-stool', '紅色塑膠椅桌', 100, 58, 0.745, SIT(.3,.62)],
    ['nm-pinball', '彈珠台', 200, 36, 1.562, P('play','cheer','play','jump','叮叮叮，中了！')],
    ['nm-arch', '霓虹拱門', 250, 44, 1.587, P('look','cheer','look','好亮的拱門！')],
  ] },
  { id: 'tung', name: '油桐花小徑', price: 0, how: '完成開拓者第五章（清領）', items: [
    ['tg-bench', '花布長椅', 150, 60, 1.026, SIT(.4,.62)],
    ['tg-umbrella', '紙傘架', 120, 38, 1.399, P('look','sniff','look','油紙傘好漂亮')],
    ['tg-leicha', '擂茶桌', 180, 50, 1.111, P('eat','chew','eat','擂茶香香的')],
    ['tg-bridge', '小石橋', 220, 70, 0.775, P('jump','cheer','look','過橋囉！')],
    ['tg-basket', '油桐花籃', 80, 34, 0.94, P('sniff','look','sniff','花好香喔～')],
    ['tg-arch', '花拱門', 200, 52, 1.212, P('look','cheer','sniff','像下雪一樣的花')],
  ] },
  { id: 'teahill', name: '竹林茶山', price: 350, how: '商店 350 幣', items: [
    ['tea-pavilion', '竹編茶亭', 250, 76, 1.005, SIT(.45,.7)],
    ['tea-table', '茶桌茶具', 150, 54, 0.89, P('eat','chew','look','喝茶囉')],
    ['tea-fence', '竹籬笆', 80, 46, 1.117, P('sniff','look','sniff','')],
    ['tea-pipe', '竹管流水', 180, 38, 1.471, P('eat','chew','eat','咕嚕咕嚕，好涼！')],
    ['tea-basket', '採茶簍', 80, 34, 1.093, P('dig','sniff','dig','採到嫩芽了！')],
    ['tea-lamp', '石燈籠', 120, 30, 1.361, P('look','sniff','look','')],
  ] },
  { id: 'coral', name: '海底珊瑚', price: 400, how: '商店 400 幣', items: [
    ['cr-shellbed', '貝殼床', 220, 64, 1.031, LIE(.5,.55)],
    ['cr-chair', '珊瑚沙發', 180, 50, 1.117, SIT(.5,.6)],
    ['cr-jelly', '水母燈', 150, 30, 1.98, P('look','cheer','look','水母在發光！')],
    ['cr-chest', '寶箱', 200, 46, 1.149, P('dig','sniff','cheer','dig','找到寶藏了！')],
    ['cr-swing', '船舵鞦韆', 220, 58, 1.17, SWAY(.5,.72)],
    ['cr-fountain', '珍珠噴泉', 180, 54, 0.85, P('eat','chew','look','珍珠閃閃的')],
  ] },
  { id: 'moon', name: '月球基地', price: 0, how: '完成時光祕境島第五關（山頂天文台）', items: [
    ['mn-rocket', '小火箭', 250, 38, 1.754, P('jump','cheer','jump','三、二、一，發射！')],
    ['house-dome', '圓頂太空艙', 300, 185, 0.946, HOUSE],
    ['mn-dish', '衛星天線', 150, 40, 1.504, P('look','sniff','look','收到外星訊號？')],
    ['mn-scope', '望遠鏡', 180, 44, 1.176, P('look','cheer','look','看到星星了！')],
    ['mn-rover', '月球車', 220, 58, 1.026, SIT(.5,.55)],
    ['mn-star', '星星燈', 100, 24, 2.632, P('look','cheer','look','')],
  ] },
  { id: 'dino', name: '恐龍叢林', price: 400, how: '商店 400 幣', items: [
    ['dn-nest', '恐龍蛋巢床', 220, 66, 0.765, LIE(.5,.5)],
    ['dn-bone', '化石拱門', 250, 56, 1.005, P('look','sniff','cheer','好大的骨頭！')],
    ['dn-table', '石桌石椅', 150, 58, 0.74, SIT(.25,.8)],
    ['dn-hammock', '大葉吊床', 180, 60, 0.97, LIE(.5,.55)],
    ['dn-egg', '恐龍蛋', 120, 34, 1.143, P('sniff','look','sniff','裡面好像有東西在動！')],
    ['dn-slide', '長頸龍溜滑梯', 250, 70, 0.945, P('jump','cheer','play','咻～')],
  ] },
  { id: 'cloud', name: '雲朵天空', price: 0, how: '收集 30 個護照章', items: [
    ['cl-sofa', '雲朵沙發', 200, 62, 0.8, SIT(.5,.55)],
    ['cl-balloon', '熱氣球鞦韆', 250, 40, 1.942, SWAY(.5,.85)],
    ['cl-lamp', '金星路燈', 120, 24, 3.125, P('look','cheer','look','')],
    ['cl-rainbow', '彩虹溜滑梯', 250, 64, 0.865, P('jump','cheer','play','溜下彩虹囉！')],
    ['cl-bed', '羽毛枕床', 180, 62, 0.85, LIE(.5,.5)],
    ['cl-vane', '風向風車', 100, 32, 1.887, P('look','sniff','look','風往哪邊吹？')],
  ] },
  { id: 'future', name: '未來科技城', price: 400, how: '商店 400 幣', items: [
    ['ft-chair', '懸浮椅', 200, 40, 1.408, SIT(.5,.45)],
    ['ft-robot', '機器人充電座', 220, 52, 0.89, P('play','cheer','play','嗶嗶，朋友你好！')],
    ['ft-holo', '全息投影燈', 180, 38, 1.46, P('look','cheer','look','星星浮在空中！')],
    ['ft-bench', '太陽能長椅', 150, 58, 1.176, SIT(.45,.68)],
    ['house-pod', '膠囊小屋', 300, 185, 0.973, HOUSE],
    ['ft-drone', '無人機快遞箱', 150, 38, 1.149, P('sniff','look','cheer','包裹送到了！')],
  ] },
  { id: 'desert', name: '沙漠綠洲', price: 300, how: '商店 300 幣', items: [
    ['house-tent', '條紋帳篷', 280, 185, 0.932, HOUSE],
    ['ds-cactus', '陶盆仙人掌', 80, 30, 1.681, P('sniff','look','sniff','刺刺的，小心！')],
    ['ds-saddle', '駱駝鞍座墊', 120, 44, 0.91, SIT(.5,.45)],
    ['ds-carpet', '編織地毯', 150, 66, 0.69, LIE(.5,.5)],
    ['ds-jar', '陶罐噴泉', 180, 42, 1.266, P('eat','chew','eat','咕嚕咕嚕')],
    ['ds-palm', '棕櫚樹', 120, 50, 1.282, P('look','sniff','look','好涼的樹蔭')],
  ] },
  { id: 'ranch', name: '小農牧場', price: 300, how: '商店 300 幣', items: [
    ['house-barn', '紅色穀倉', 300, 185, 1.01, HOUSE],
    ['rc-hay', '圓乾草堆', 100, 48, 0.975, P('roll','play','roll','滾來滾去～')],
    ['rc-mill', '小風車', 200, 40, 1.504, P('look','cheer','look','風車轉轉轉')],
    ['rc-milk', '牛奶桶水槽', 120, 50, 1.015, P('eat','chew','eat','咕嚕咕嚕')],
    ['rc-scarecrow', '稻草人', 100, 36, 1.299, P('look','jump','look','稻草人先生好！')],
    ['rc-cart', '蔬菜推車', 150, 56, 0.86, P('sniff','dig','chew','紅蘿蔔好甜！')],
  ] },
];
export const SET_ITEMS = SETS.flatMap((s) => s.items.map(([id, name, price, w, aspect, use]) => ({ id, name, price, w, aspect, use, set: s.id })));
export const isSetHouse = (id) => id.startsWith('house-') && SET_ITEMS.some((x) => x.id === id);
