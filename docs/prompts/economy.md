DOMAIN: Natural economy, shops, jobs, player business (spec Agent 9).

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/core/contracts.d.ts, src/data/schema.ts, src/data/items/ids.ts, src/data/shops/ids.ts, src/data/npcs/ids.ts,
src/data/locations/ids.ts first.

FILES in src/economy/: EconomySystem.ts (class EconomySystem implements IEconomySystem, id 'economy'),
MarketSystem.ts, PriceSystem.ts, SupplyDemandSystem.ts, InventorySystem.ts (shop stock helpers), BusinessSystem.ts,
PlayerShopSystem.ts, EmploymentSystem.ts, TransactionSystem.ts.

CONTENT DATA:
1) src/data/items/core.ts -> CORE_ITEMS: ItemDef[] for general goods using ITEM ids that belong to these groups:
   tools (fishing rods basic/good/master, axe, pickaxe, hoe, watering can(s), shovel, bug net, camera, paintbrush,
   hammer, sewing kit, cooking pot, pan, workbench kit, lantern, backpack), food and drink (bread, cheese, soups, pies,
   cakes, sandwiches, salads, stews, tea, coffee, lemonade, cider, hot chocolate, honey jar, jam, roast dinner, picnic
   basket, herbal tea) and cooking ingredients (flour, sugar, salt, butter, milk, egg, cheese, dough, pie dough, jam,
   tea leaves, coffee beans, honey, oil), books (gardening, fishing, local history, recipe book, romance novel, art,
   museum guide, town almanac), clothing (raincoat, wellies, sun hat, scarf, town coat, work apron), gifts and
   collectibles (bouquet, gift box, handmade candle, plush cigarette, friendship bracelet, painted card, old coin,
   message bottle, pressed flower, fossil, crystal, music box, old letter, antique key, silver locket), misc (camera
   film, photo paper, art supplies, festival ribbon, harvest crown). Real descriptions, balanced pence prices,
   categories, tags (gift tastes, tool skills, edible/effects), visual colours/shapes. Do NOT define ids owned by
   other agents: seeds/produce/fish/forage/raw materials (nature), processed materials/furniture/building kits (craft),
   cigarette equipment/ash products (life).
2) src/data/shops/shops.ts -> BUSINESSES: BusinessDef[] for all 22 BIZ constants: proper names, types, locationId
   (LOC constants; must exist in world data), ownerNpcId from NPC constants (majors own shops; some null/player-
   buyable), initialMoney, reputation 40-75, priceMarkup 0.9-1.25, openHours realistic (cafe 7-18, bakery 6-15,
   grocery 8-20, bookshop 9-18, market stall 8-14, restaurant 12-23, city shops 9-21, supermarket 8-22, museum 10-17,
   closed Mon where sensible), stock lists (8-20 items each with quantities/restock targets/price multipliers), jobs
   with titles/wages (barista 950p/h, baker 1100p/h, farmhand 900p/h, museum assistant 1050p/h, shop assistant 900p/h
   etc.) and playerAvailable flags.

SYSTEM BEHAVIOUR (implement IEconomySystem exactly):
- init: read state.economy (created by WorldFactory), assign NPC employees to jobs based on npc.workLocationId/occupation,
  set business owners, initialise market if missing, set business isOpen by clock hour.
- Market/Price/SupplyDemand: hourly settlement (config interval) updates demand/supply from recent transactions and NPC
  needs; price = round(base * seasonalFactor * (1 + alpha*(demand-supply)/target) * markup) clamped [0.4, 2.5] * base;
  track trend; economicIndex; no NaN/infinite.
- BusinessSystem: opening hours; per open business per hour simulate customers: footfall from location kind/region/time +
  reputation + price competitiveness -> arrival count via stream 'economy.customer'; each simulated customer picks a
  stocked item via weighted probability (need/price), checks npc budget (never negative; living reserve), buys: stock--,
  business.money += price, npc.money -= price, transaction, dailyRevenue/customers. Restock at 07:00 daily: order up to
  target, cost ~55% base, deduct business money. Daily settlement at 22:00: pay employee wages and owner income, push
  BusinessDayRecord (cap 60), update reputation, reset daily counters. IDEMPOTENT: never settle same day twice.
- Employment: applyForJob (player at business location, job.playerAvailable, business open, levelReq), quit, workShift
  (player at workplace during shift hours, once per game hour, pays wagePerHour for one hour, sets player.jobId/
  occupation, bus money event, statistics.shiftsWorked++). NPC wages in daily settlement.
- TransactionSystem: atomic buy/sell for player: validate business open + player at location + stock/money/inventory;
  add/remove items with quality/freshness via InventoryUtil; statistics; emit events; ActionResult with clear messages.
  Sell price = current market price * 0.6 (round), business must afford. No negative money anywhere.
- PlayerShopSystem: buyPlayerShop (price by type/reputation, e.g. 80k-350k pence, player money check; sets
  isPlayerOwned, state.economy.playerShop, statistics.businessesOwned); setPlayerShopPrice (clamp 0.4-2.5 base);
  restockPlayerShop (wholesale cost); togglePlayerShopOpen; hireEmployee/fireEmployee (NPC id, wage, cap 3); daily
  settlement: shop sales -> player profit minus wages; offline-safe.
- getRecentTransactions cap ring (100).

TESTS in tests/economy/: transaction atomicity/no negative money, price clamping + determinism, restock + daily
settlement idempotency, NPC budget limits, job apply/workShift pay, player shop buy/price/restock/hire, 30-day market
stability (prices within clamps, money finite). Pass: npx vitest run tests/economy. Fix your TS errors only.
