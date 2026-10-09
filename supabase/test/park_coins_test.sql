-- 時光幣、每日任務、商店的實測。只在本機跑（tools/test/db.sh，要給 ISLAND_REPO）。
-- 前提：前面的測試都跑完（小貓…13 是學生、沒有班、還沒有寵物和旅人），再跑過 park_coins.sql 和 island_pioneer.sql。

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

reset role;
select test_one($$select id from public.students where login_id = 't2_cat'$$) as cat \gset
select test_one($$select id from public.students where login_id = 't2_amy'$$) as amy \gset

\echo '── 費率與登記'
select test_ok((select count(*) from public.park_coin_rates) = 10, '費率表 10 項');
select test_ok((select coins_fn from public.park_facilities where code = 'island_pioneer') = 'island_coin_sources', '島嶼開拓者登記了時光幣');
select test_ok((select coins_fn from public.park_facilities where code = 'guardian') = 'guardian_coin_sources', '守護異世界登記了時光幣');
select test_ok((select count(*) from public.island_step_tiers) = 56, '八章各 7 步都標了輕中重');
select test_ok((select count(*) from public.island_step_tiers where tier = 'heavy') = 8, '每章一個重關');
\i supabase/park_coins.sql
select test_ok((select count(*) from public.park_shop_items) = 11, '重跑不會多出東西');
update public.park_coin_rates set amount = 12 where code = 'medium';
\i supabase/park_coins.sql
select test_ok(public.park_coin_rate('medium') = 12, '校正過的金額重跑不會蓋回去');
update public.park_coin_rates set amount = 10 where code = 'medium';

set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000013', true);

\echo '── 一開始'
select public.park_coins_me() as s \gset
select test_ok((:'s'::jsonb ->> 'balance')::int = 0, '一開始 0 幣');
select test_ok(jsonb_array_length(:'s'::jsonb -> 'daily' -> 'tasks') = 3, '每天 3 個任務');
select test_ok(:'s'::jsonb -> 'daily' -> 'tasks' -> 0 ->> 'code' = 'pet', '第一個是照顧寵物');
select test_ok(jsonb_array_length(:'s'::jsonb -> 'fresh') = 0, '沒有新入帳');
select test_denied($$select public.park_daily_claim('pet')$$, '還沒照顧寵物不能領');
select test_denied($$select public.park_daily_claim('fly')$$, '沒有的任務不能領');

\echo '── 島嶼開拓者：每一步依輕中重'
select public.island_save('ch5', '{"v":1,"reached":3,"stars":0,"done":false}');
select public.park_coins_me() as s \gset
select test_ok((:'s'::jsonb ->> 'balance')::int = 20, '開場 5＋認識地形 5＋做竹蛇籠 10＝20');
select test_ok(:'s'::jsonb -> 'fresh' -> 0 ->> 'facility' = 'island_pioneer' and (:'s'::jsonb -> 'fresh' -> 0 ->> 'amount')::int = 20, '樂園會說「在島嶼開拓者賺了 20」');
select public.island_save('ch5', '{"v":1,"reached":6,"stars":2,"done":true}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 20 + 45 + 30 + 20, '過關：其他步 45＋整章 30＋兩顆星 20');
select public.island_save('ch5', '{"v":1,"reached":6,"stars":2,"done":true}');
select public.island_save('ch5', '{"v":1,"reached":6,"stars":1,"done":true}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 115, '重送、星星變少都不會多算或扣掉');

\echo '── 重玩整章遞減'
select public.island_save('ch5', '{"v":1,"reached":2,"stars":0,"done":false}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 115, '從頭再玩、還沒玩完：不給');
select public.island_save('ch5', '{"v":1,"reached":6,"stars":3,"done":true}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 115 + 10 + 47, '二刷：第三顆星 10＋整章獎勵 95 的一半 47');
select public.island_save('ch5', '{"v":1,"reached":0,"done":false}');
select public.island_save('ch5', '{"v":1,"reached":6,"stars":3,"done":true}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 172 + 23, '三刷：四分之一 23');
select public.island_save('ch5', '{"v":1,"reached":0,"done":false}');
select public.island_save('ch5', '{"v":1,"reached":6,"stars":3,"done":true}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 195, '四刷起不給');
select test_ok((select clears from public.island_saves where student_id = public.current_student_id() and slot = 'ch5') = 4, '記得玩完 4 次');

\echo '── 新結局、再挑戰、序章'
select public.island_save('medals', '{"v":1,"endings":["ch2:a0","ch2:a1","ch2:a1"],"chal":["ch2:hunt","bad key!"],"eggs":[]}');
select public.island_save('ch2', '{"v":1,"reached":1,"stars":0,"done":false}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 195 + 5 + 30 + 10, '第二章開場 5＋第二種結局 30＋再挑戰 10（亂寫的不算）');
select public.island_save('world', '{"v":1,"prologue":true,"cleared":[]}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 240 + 30, '玩完序章 30');
select test_ok((public.park_coins_me() ->> 'week')::int = 270, '本週冒險值 270');
select public.park_coins_seen();
select test_ok(jsonb_array_length(public.park_coins_me() -> 'fresh') = 0, '通知看過就不再跳');

\echo '── 每日任務'
select public.park_pet_adopt('kitten', '咪咪');
select public.park_pet_pat();
select public.park_daily_claim('pet') as s \gset
select test_ok((:'s'::jsonb ->> 'got')::int = 5, '照顧寵物：領 5');
select test_denied($$select public.park_daily_claim('pet')$$, '同一個不能領兩次');
select test_ok((public.park_daily_claim('play') ->> 'got')::int = 5, '今天玩過島嶼開拓者：領 5');
select public.park_pet_play('wish');
select public.park_traveller_create('', 'hair-crop', 'tw');
select public.park_daily_claim(public.park_coins_me() -> 'daily' -> 'tasks' -> 2 ->> 'code') as s \gset
select test_ok((:'s'::jsonb ->> 'got')::int = 15, '第三個 5＋全做完 10');
select test_ok((:'s'::jsonb -> 'daily' ->> 'all')::boolean, '今天全部完成');
select test_ok((:'s'::jsonb ->> 'balance')::int = 295, '一天最多 25');

\echo '── 商店'
select public.park_shop() as s \gset
select test_ok((select count(*) from jsonb_array_elements(:'s'::jsonb -> 'items') x where x ->> 'cat' = 'wear') = 12, '主角：12 件衣飾（起始套裝的也賣）');
select test_ok((select bool_and((x ->> 'owned')::boolean) from jsonb_array_elements(:'s'::jsonb -> 'items') x where x ->> 'set' = 'tw'), '自己的起始套裝標成已經有');
select test_ok((select count(*) from jsonb_array_elements(:'s'::jsonb -> 'items') x where x ->> 'cat' = 'furn') = 4, '傢俱 4 件常駐');
select test_ok((select count(*) from jsonb_array_elements(:'s'::jsonb -> 'items') x where x ->> 'cat' = 'month')
               = case when extract(month from now() at time zone 'Asia/Taipei') in (9, 10) then 2 else 0 end, '本月限定只在那個月上架');
select test_denied($$select public.park_shop_buy('wear', 'top-floral')$$, '已經有的不能再買');
select test_denied($$select public.park_shop_buy('wear', 'hair-crop')$$, '髮型不賣');
select test_denied($$select public.park_shop_buy('shop', 'nothing')$$, '沒有的東西');
select public.park_shop_buy('wear', 'top-tech') as s \gset
select test_ok((:'s'::jsonb ->> 'balance')::int = 195 and :'s'::jsonb ->> 'bought' = '發光機能外套', '買外套：扣 100');
select test_ok((select count(*) from public.park_student_wear where item = 'top-tech') = 1, '衣櫃裡有了');
select test_ok((public.park_traveller_save('{"hair":"hair-crop","top":"top-tech"}') -> 'look' ->> 'top') = 'top-tech', '買了就能穿');
select public.park_shop_buy('shop', 'pet-apple');
select public.park_shop_buy('shop', 'pet-apple') as s \gset
select test_ok((select qty from public.park_pet_inventory where item = 'apple') = 2, '點心可以一直買，放進背包');
select test_ok((public.park_pet_feed('apple') ->> 'did') = 'feed', '買的點心餵得了');
select test_denied($$select public.park_shop_buy('shop', 'furn-sandbox')$$, '135 幣買不起 150 的沙坑');
select public.park_shop_buy('shop', 'furn-scratcher') as s \gset
select test_ok((:'s'::jsonb ->> 'balance')::int = 15, '貓抓板 120：剩 15');
select test_ok(public.park_my_furniture() = '["scratcher"]'::jsonb, '寵物島有貓抓板了');
select test_denied($$select public.park_shop_buy('shop', 'furn-scratcher')$$, '傢俱買一次就好');
select test_ok((public.park_coins_me() ->> 'week')::int = 295, '花錢不會扣本週冒險值');
reset role;
update public.park_coin_ledger set created_at = now() - interval '8 days' where student_id = :'cat';
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000013', true);
select test_ok((public.park_coins_me() ->> 'week')::int = 0 and (public.park_coins_me() ->> 'balance')::int = 15, '下週冒險值歸零，餘額還在');

\echo '── 守護異世界的章'
reset role;
insert into public.park_student_stamps (student_id, facility, stamp) values (:'cat', 'guardian', 'first') on conflict do nothing;
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000013', true);
select test_ok((public.park_coins_me() ->> 'balance')::int = 35, '蓋到守護異世界的章：20');

\echo '── 現在篇：漁村任務、規則小鎮'
select public.island_save('village', '{"v":1,"quests":["house","pier","hack"]}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 35 + 10, '漁村兩個輕任務 10（亂寫的任務不算）');
select public.island_save('town', '{"v":1,"solved":{"karaoke":2,"seat":1,"moon":1,"hack":2,"beer":3}}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 45 + 30 + 10 + 30, '小鎮破三案 30＋一次判對 10＋大街過關 30（亂寫的不算）');
select public.island_save('town', '{"v":1,"solved":{"karaoke":2,"seat":1,"moon":1}}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 115, '重送不會多算');
select public.island_save('sky', '{"v":1,"best":{"1":2,"2":1e30,"9":3,"3":"x"}}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 115 + 30 + 40, '天空港：第一關過關＋兩顆星 30、第二關亂寫的星星最多算 3 顆 40');
select public.island_save('isles', '{"v":1,"stamps":["penghu","lanyu","penghu","moon"]}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 185 + 20, '離島兩個郵戳 20（重複、亂寫的不算）');
select public.island_save('isles', '{"v":1,"stamps":["guishan","liuqiu","penghu","lanyu","ludao","kinmen","matsu"]}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 205 + 50 + 30, '七座蓋滿：再 5 個郵戳 50＋蓋滿 30');
select public.island_save('post', '{"v":1,"sent":[{"spot":"taroko","msg":"a"},{"spot":"taroko","msg":"b"},{"spot":"mars","msg":"c"},{"spot":"market","msg":"d"}]}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 285 + 20, '明信片兩個景點 20（同景點、亂寫的不算）');
select public.island_save('post', '{"v":1,"sent":[{"spot":"taroko"},{"spot":"sunmoon"},{"spot":"qingshui"},{"spot":"market"},{"spot":"persimmon"},{"spot":"tower"}]}');
select test_ok((public.park_coins_me() ->> 'balance')::int = 305 + 40 + 30, '六個景點都寄過：再 4 張 40＋全寄 30');
select test_denied($$select * from public.island_class_postcards('ZZZZZZ')$$, '學生看不到全班的明信片');

\echo '── 現在篇勳章'
reset role;
select test_ok((select array_agg(x order by x) from public.island_earned_stamps(:'cat') x where x like 'v-%' or x = 'now')
               = array['v-isles', 'v-isles-all', 'v-post', 'v-post-all', 'v-sky', 'v-town'], '小貓拿到的現在篇勳章（漁村沒兩星、天空港沒三星、小鎮沒全判對）');
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000013', true);
select public.island_save('village', '{"v":1,"quests":["house","pier","star2","star5"]}');
reset role;
select test_ok((select count(*) from public.island_earned_stamps(:'cat') x where x in ('v-village', 'v-village-star', 'now')) = 3, '漁村兩星、五星，五個地方都有第一枚：今日臺灣探險家');
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000013', true);

\echo '── 班級排行：本週冒險值＋代表勳章'
reset role;
select test_one($$select code from public.classes where name = '英文 5-2'$$) as c2 \gset
insert into public.park_class_members (class_code, student_id) values (:'c2', :'cat') on conflict do nothing;
select public.park_coin_grant(:'amy', 'test:board', 7, null, '測試');
select public.park_coin_sync(:'cat');
select public.park_coin_week(:'cat') as catweek \gset
select coalesce(sum(amount), 0) as catlast from public.park_coin_ledger where student_id = :'cat' and amount > 0 and created_at >= public.park_week_start() - interval '7 days' and created_at < public.park_week_start() \gset
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000013', true);
select public.park_class_board(:'c2') as b \gset
select test_ok((:'b'::jsonb ->> 'total')::int = 3, '全班 3 人');
select test_ok((:'b'::jsonb -> 'me' ->> 'rank')::int = 1 and (:'b'::jsonb -> 'me' ->> 'score')::int = :catweek, '小貓這週賺最多，第 1 名');
select test_ok((select bool_and((r ->> 'score')::int > 0) from jsonb_array_elements(:'b'::jsonb -> 'rows') r), '0 分的不列出來');
select public.park_class_board(:'c2', 'up') as bu \gset
select test_ok(:'bu'::jsonb ->> 'kind' = 'up' and (:'bu'::jsonb -> 'me' ->> 'score')::int = :catweek - :catlast, '進步之星：這週減上週');
select public.park_class_board(:'c2', 'medals') as bm \gset
select test_ok((select (r ->> 'score')::int from jsonb_array_elements(:'bm'::jsonb -> 'rows') r where r ->> 'id' = :'amy') >= 1, '勳章牆：艾咪有勳章，上榜');
select test_ok((:'bm'::jsonb -> 'me' ->> 'rank') is null or (:'bm'::jsonb -> 'me' ->> 'score')::int > 0, '勳章牆：沒有勳章的不給名次');
select test_ok(public.park_class_board(:'c2', 'hack') ->> 'kind' = 'week', '亂給種類就當本週冒險值');
select test_ok((select r -> 'medal' ->> 'art' from jsonb_array_elements(:'b'::jsonb -> 'rows') r where r ->> 'id' = :'amy') is not null, '艾咪那列掛著她的代表勳章');
select test_ok((select count(*) from jsonb_array_elements(:'b'::jsonb -> 'rows') r where (r ->> 'me')::boolean) = 1, '自己那列有標出來');
select test_denied($$select public.park_class_board('ZZZZZZ')$$, '不是自己的班看不到排行');
reset role;
delete from public.park_class_members where class_code = :'c2' and student_id = :'cat';
set role authenticated;
select test_as('d0000000-0000-0000-0000-000000000013', true);

\echo '── 不能自己加錢、不能看別人的'
select test_denied(format($$insert into public.park_coin_ledger (student_id, source, amount) values (%L, 'hack', 9999)$$, :'cat'), '學生直接寫帳本');
select test_denied(format($$update public.park_coin_ledger set amount = 9999 where student_id = %L$$, :'cat'), '學生直接改帳本');
select test_denied(format($$select public.park_coin_grant(%L, 'hack', 9999, null, '')$$, :'cat'), '入帳函式叫不動');
select test_denied(format($$select public.park_coin_sync(%L)$$, :'amy'), '幫別人同步叫不動');
select test_denied(format($$select * from public.island_coin_sources(%L)$$, :'cat'), '島嶼的算錢函式叫不動');
select test_denied(format($$insert into public.park_student_furniture (student_id, item) values (%L, 'hammock')$$, :'cat'), '學生直接塞傢俱');
select test_denied(format($$update public.park_daily set claimed = '{}' where student_id = %L$$, :'cat'), '學生直接改任務');
select test_as('d0000000-0000-0000-0000-000000000011', true);
select test_ok((select count(*) from public.park_coin_ledger where student_id = :'cat') = 0, '艾咪看不到小貓的帳本');
select test_ok((select count(*) from public.park_student_furniture) = 0, '也看不到小貓的傢俱');
select test_as('d0000000-0000-0000-0000-000000000002', false, 't2b@parktest.local');
select test_ok(public.park_coins_me() is null, '老師沒有時光幣');
select test_denied($$select public.park_shop_buy('wear', 'top-tech')$$, '老師不能買');
reset role;
set role anon;
select test_ok(jsonb_array_length(public.park_shop() -> 'items') > 0, '沒登入也看得到商店');
select test_denied($$select public.park_coins_me()$$, '沒登入叫不到我的時光幣');
reset role;
