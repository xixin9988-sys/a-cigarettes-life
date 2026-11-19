import type { EventDef, EventEffectDef, EventConditionDef, FestivalDef } from '../schema';
import { ITEM } from '../items/ids';
import { LOC } from '../locations/ids';

/**
 * OWNER: Agent 11 (Events & Festivals) - implemented by the Lead as an integration fallback.
 * 30+ world/personal/community events and 10 seasonal festivals.
 */

const rel = (affinity = 0, trust = 0, intimacy = 0): EventEffectDef => ({
  kind: 'relationship',
  target: 'player_best',
  delta: { affinity, trust, intimacy },
});
const money = (amount: number): EventEffectDef => ({ kind: 'money', target: 'player', amount });
const item = (itemId: string, quantity = 1): EventEffectDef => ({ kind: 'item', itemId, quantity });
const mood = (value: number): EventEffectDef => ({ kind: 'npc_mood', target: 'all_known', value });
const history = (description: string, importance = 2): EventEffectDef => ({ kind: 'history', description, importance });
const flag = (name: string, value = true): EventEffectDef => ({ kind: 'worldFlag', flag: name, value });
const chain = (eventId: string, chance = 0.5): EventEffectDef => ({ kind: 'chainEvent', eventId, chance });
const weather = (value: 'rain' | 'storm' | 'fog' | 'clear' | 'snow' | 'wind' | 'cloudy', durationHours = 6): EventEffectDef => ({
  kind: 'weather',
  weather: value,
  durationHours,
});

export const EVENTS: EventDef[] = [
  {
    id: 'event_market_bustle', title: 'Market Bustle', description: 'The square fills with traders and the smell of fresh bread. People linger longer than usual.',
    category: 'ordinary', weight: 12, conditions: [{ kind: 'season', seasons: ['spring', 'summer', 'autumn'] }], locationTags: ['market', 'plaza'],
    minParticipants: 2, maxParticipants: 6, cooldownHours: 12, unique: false, durationHours: 3, effects: [rel(1, 0), mood(0.05), history('A lively market day in Willowbrook.', 2)],
    importance: 1, icon: '🧺', tags: ['market', 'town'],
  },
  {
    id: 'event_stray_dog', title: 'A Stray Dog', description: 'A muddy, hopeful dog follows you for a while before someone claims it.',
    category: 'interesting', weight: 8, conditions: [], locationTags: ['park', 'countryside', 'forest'],
    minParticipants: 1, maxParticipants: 3, cooldownHours: 36, unique: false, durationHours: 1, effects: [rel(1, 1), history('A stray dog brightened the day.', 1)],
    importance: 1, icon: '🐕', tags: ['nature'],
  },
  {
    id: 'event_roof_leak', title: 'Roof Leak', description: 'Rain finds a weak point in an old roof. The town handyman is grumbling about it.',
    category: 'unlucky', weight: 7, conditions: [{ kind: 'weather', weathers: ['rain', 'storm'] }], locationTags: ['indoor', 'town'],
    minParticipants: 1, maxParticipants: 2, cooldownHours: 48, unique: false, durationHours: 4, effects: [mood(-0.08), history('An old roof started leaking in the rain.', 2)],
    importance: 1, icon: '🌧️', tags: ['weather'],
  },
  {
    id: 'event_hidden_cache', title: 'A Hidden Cache', description: 'Behind a loose brick you find a small tin of old coins and a folded note.',
    category: 'lucky', weight: 6, conditions: [{ kind: 'minSkill', skill: 'exploration', level: 2 }], locationTags: ['warehouse', 'forest', 'ruins', 'abandoned'],
    minParticipants: 1, maxParticipants: 1, cooldownHours: 120, unique: true, durationHours: 1,
    effects: [item(ITEM.oldCoin, 2), item(ITEM.oldClue, 1), history('A hidden cache was found behind a loose brick.', 3), flag('found_hidden_cache')],
    importance: 3, icon: '🪙', tags: ['secret'],
  },
  {
    id: 'event_lost_letter', title: 'A Lost Letter', description: 'A wind-blown letter skitters across the path. It is addressed to someone in town.',
    category: 'ordinary', weight: 8, conditions: [{ kind: 'weather', weathers: ['wind', 'rain'] }], locationTags: ['town', 'plaza', 'park'],
    minParticipants: 1, maxParticipants: 2, cooldownHours: 24, unique: false, durationHours: 1, effects: [item(ITEM.oldLetter, 1), rel(1, 0), history('A lost letter was found and returned.', 2)],
    importance: 2, icon: '✉️', tags: ['town'],
  },
  {
    id: 'event_cafe_gossip', title: 'Cafe Gossip', description: 'Sylvia leans over the counter with news: someone in town has had a very good week.',
    category: 'ordinary', weight: 10, conditions: [{ kind: 'hourRange', from: 8, to: 18 }], locationTags: ['cafe'],
    minParticipants: 2, maxParticipants: 5, cooldownHours: 18, unique: false, durationHours: 2, effects: [rel(1, 0), mood(0.05)],
    importance: 1, icon: '☕', tags: ['social'],
  },
  {
    id: 'event_market_bargain', title: 'Market Bargain', description: 'A trader is offloading a crate of goods before the weather turns. You get a good deal.',
    category: 'lucky', weight: 7, conditions: [{ kind: 'hourRange', from: 7, to: 15 }], locationTags: ['market', 'shop'],
    minParticipants: 1, maxParticipants: 2, cooldownHours: 30, unique: false, durationHours: 2, effects: [item(ITEM.flour, 2), item(ITEM.butter, 1), money(-200), history('A market bargain was found before the weather turned.', 1)],
    importance: 1, icon: '🧈', tags: ['economy'],
  },
  {
    id: 'event_travelling_merchant', title: 'Travelling Merchant', description: 'A merchant with a cart full of oddities has set up by the station for the afternoon.',
    category: 'interesting', weight: 6, conditions: [{ kind: 'season', seasons: ['spring', 'summer', 'autumn'] }], locationTags: ['market', 'station', 'plaza'],
    minParticipants: 1, maxParticipants: 4, cooldownHours: 72, unique: false, durationHours: 5, effects: [item(ITEM.crystal, 1), rel(1, 0), history('A travelling merchant visited with curiosities.', 2)],
    importance: 2, icon: '🛒', tags: ['economy', 'town'],
  },
  {
    id: 'event_heatwave', title: 'Heatwave', description: 'The air shimmers. Even the bees seem too tired to work. Drink something cold.',
    category: 'unlucky', weight: 6, conditions: [{ kind: 'season', seasons: ['summer'] }], locationTags: ['park', 'farm', 'plaza', 'city'],
    minParticipants: 1, maxParticipants: 6, cooldownHours: 96, unique: false, durationHours: 8, effects: [weather('clear', 8), mood(-0.05), history('A heatwave settled over the region.', 2)],
    importance: 2, icon: '🌡️', tags: ['weather'],
  },
  {
    id: 'event_storm_damage', title: 'Storm Damage', description: 'A branch came down across the lane overnight. A runner has been rigged up as a warning.',
    category: 'unlucky', weight: 5, conditions: [{ kind: 'weather', weathers: ['storm'] }], locationTags: ['forest', 'countryside', 'town'],
    minParticipants: 1, maxParticipants: 4, cooldownHours: 120, unique: false, durationHours: 6, effects: [mood(-0.1), history('Storm damage left a fallen branch across the lane.', 2)],
    importance: 2, icon: '🌪️', tags: ['weather'],
  },
  {
    id: 'event_neighbour_help', title: 'A Neighbour Needs Help', description: 'Eliza has dropped a basket of books on the library steps. Her back is not what it was.',
    category: 'ordinary', weight: 8, conditions: [], locationTags: ['library', 'town', 'residential'],
    minParticipants: 1, maxParticipants: 2, cooldownHours: 24, unique: false, durationHours: 1, effects: [rel(2, 1), history('A helping hand was offered to a neighbour.', 2)],
    importance: 2, icon: '📚', tags: ['social'],
  },
  {
    id: 'event_library_book_sale', title: 'Library Book Sale', description: 'The library is selling off duplicates and old donations. A crowd of readers has formed.',
    category: 'ordinary', weight: 6, conditions: [{ kind: 'hourRange', from: 9, to: 16 }], locationTags: ['library'],
    minParticipants: 2, maxParticipants: 5, cooldownHours: 120, unique: false, durationHours: 4, effects: [item(ITEM.localHistoryBook, 1), rel(1, 0), history('The library held a busy book sale.', 1)],
    importance: 1, icon: '📖', tags: ['library'],
  },
  {
    id: 'event_ghost_sighting', title: 'A Ghost Sighting', description: 'Rufus swears he saw a light moving through the old warehouse windows. Nobody believes him. Mostly.',
    category: 'special', weight: 3, conditions: [{ kind: 'hourRange', from: 21, to: 4 }], locationTags: ['warehouse', 'ruins', 'abandoned'],
    minParticipants: 1, maxParticipants: 2, cooldownHours: 240, unique: true, durationHours: 2, effects: [item(ITEM.oldClue, 1), history('A strange light was seen in the abandoned warehouse.', 4), flag('ghost_sighting')],
    importance: 4, icon: '👻', tags: ['special', 'secret'],
  },
  {
    id: 'event_secret_letter', title: 'A Letter With No Name', description: 'Someone slid an unaddressed envelope under the door. Inside: a single line about the old garden.',
    category: 'special', weight: 3, conditions: [{ kind: 'minSkill', skill: 'exploration', level: 3 }], locationTags: ['indoor', 'town'],
    minParticipants: 1, maxParticipants: 1, cooldownHours: 240, unique: true, durationHours: 1, effects: [item(ITEM.mysteriousLetter, 1), item(ITEM.gardenKey, 1), history('A mysterious letter pointed toward the hidden garden.', 4), flag('mysterious_letter_received')],
    importance: 4, icon: '💌', tags: ['special', 'secret'],
  },
  {
    id: 'event_power_cut', title: 'Power Cut', description: 'The lights flicker and die across the street. Lamps are lit in windows one by one.',
    category: 'unlucky', weight: 4, conditions: [{ kind: 'weather', weathers: ['storm'] }], locationTags: ['indoor', 'city', 'town'],
    minParticipants: 1, maxParticipants: 6, cooldownHours: 96, unique: false, durationHours: 3, effects: [mood(-0.03), history('The power flickered out on the street.', 1)],
    importance: 1, icon: '🕯️', tags: ['weather'],
  },
  {
    id: 'event_harvest_surplus', title: 'Harvest Surplus', description: 'Ada has more carrots than she can sell. She hands out bundles to anyone walking past the farm.',
    category: 'lucky', weight: 8, conditions: [{ kind: 'season', seasons: ['autumn'] }], locationTags: ['farm', 'market'],
    minParticipants: 1, maxParticipants: 4, cooldownHours: 48, unique: false, durationHours: 4, effects: [item(ITEM.carrot, 3), item(ITEM.potato, 2), rel(1, 0), history('Ada shared a surplus harvest with the village.', 2)],
    importance: 2, icon: '🥕', tags: ['farm'],
  },
  {
    id: 'event_business_boom', title: 'A Good Week', description: 'The cafe has been full all week. Sylvia is trying not to look too pleased about it.',
    category: 'lucky', weight: 5, conditions: [{ kind: 'minInfluence', value: 0 }], locationTags: ['cafe', 'shop', 'city'],
    minParticipants: 2, maxParticipants: 6, cooldownHours: 72, unique: false, durationHours: 4, effects: [money(200), rel(1, 0), history('Trade picked up in town.', 2)],
    importance: 2, icon: '📈', tags: ['economy'],
  },
  {
    id: 'event_npc_birthday', title: 'A Birthday', description: "It is someone in town's birthday. A small cake appears on the cafe counter.",
    category: 'ordinary', weight: 7, conditions: [], locationTags: ['cafe', 'residential', 'town'],
    minParticipants: 2, maxParticipants: 6, cooldownHours: 168, unique: false, durationHours: 4, effects: [item(ITEM.strawberryCake, 1), rel(1, 1), mood(0.08), history('A birthday was celebrated in the village.', 2)],
    importance: 2, icon: '🎂', tags: ['social'],
  },
  {
    id: 'event_wedding', title: 'A Village Wedding', description: 'Cars are parked along the lane and the church bells are ringing. The whole village seems invited.',
    category: 'interesting', weight: 4, conditions: [{ kind: 'season', seasons: ['spring', 'summer'] }], locationTags: ['plaza', 'town', 'residential'],
    minParticipants: 3, maxParticipants: 8, cooldownHours: 240, unique: true, durationHours: 6, effects: [rel(2, 1), mood(0.15), history('A wedding brought the village together.', 3)],
    importance: 3, icon: '💍', tags: ['social', 'town'],
  },
  {
    id: 'event_rumour', title: 'A Rumour', description: 'Rumours travel faster than the post in Willowbrook. Today it is about the old farmhouse.',
    category: 'ordinary', weight: 8, conditions: [], locationTags: ['town', 'cafe', 'market', 'city'],
    minParticipants: 1, maxParticipants: 4, cooldownHours: 24, unique: false, durationHours: 2, effects: [rel(0, 0), history('A rumour spread about the abandoned farmhouse.', 1)],
    importance: 1, icon: '🗣️', tags: ['social'],
  },
  {
    id: 'event_music_evening', title: 'Music From The Square', description: 'Someone has brought a fiddle to the square. A few people drift over to listen.',
    category: 'interesting', weight: 7, conditions: [{ kind: 'hourRange', from: 16, to: 22 }], locationTags: ['plaza', 'cafe', 'city'],
    minParticipants: 2, maxParticipants: 6, cooldownHours: 36, unique: false, durationHours: 3, effects: [rel(1, 0), mood(0.1), history('Music drifted across the square.', 2)],
    importance: 2, icon: '🎻', tags: ['social', 'music'],
  },
  {
    id: 'event_snow_day', title: 'First Snow', description: 'Snow falls over the village overnight. Every path looks new and every roof is white.',
    category: 'interesting', weight: 10, conditions: [{ kind: 'season', seasons: ['winter'] }], locationTags: ['park', 'town', 'countryside'],
    minParticipants: 1, maxParticipants: 6, cooldownHours: 48, unique: false, durationHours: 8, effects: [weather('snow', 8), mood(0.1), history('The first snow of winter arrived.', 2)],
    importance: 2, icon: '❄️', tags: ['weather', 'season'],
  },
  {
    id: 'event_frost_warning', title: 'Frost Warning', description: 'A sharp frost is expected. The farmers are covering their seedlings before dark.',
    category: 'unlucky', weight: 6, conditions: [{ kind: 'season', seasons: ['winter', 'autumn'] }], locationTags: ['farm', 'orchard', 'greenhouse'],
    minParticipants: 1, maxParticipants: 4, cooldownHours: 72, unique: false, durationHours: 6, effects: [mood(-0.04), history('Frost threatened the farm seedlings.', 2)],
    importance: 2, icon: '🧊', tags: ['weather', 'farm'],
  },
  {
    id: 'event_abandoned_cache', title: 'The Old Farmhouse Cache', description: "In the abandoned farmhouse, a broken floorboard reveals a tin box with a child's keepsakes.",
    category: 'special', weight: 2, conditions: [{ kind: 'flag', flag: 'ghost_sighting', equals: true }], locationTags: ['abandoned', 'farmhouse'],
    minParticipants: 1, maxParticipants: 1, cooldownHours: 240, unique: true, durationHours: 1, effects: [item(ITEM.oldCoin, 3), item(ITEM.pressedFlower, 1), history('Keepsakes were found in the abandoned farmhouse.', 4), flag('farmhouse_cache_found')],
    importance: 4, icon: '🥀', tags: ['special', 'secret'],
  },
  {
    id: 'event_spring_blossom', title: 'Blossom Everywhere', description: 'The orchard is in blossom and the whole lane smells of flowers. Even the grumpy locals smile.',
    category: 'lucky', weight: 9, conditions: [{ kind: 'season', seasons: ['spring'] }], locationTags: ['orchard', 'park', 'garden'],
    minParticipants: 1, maxParticipants: 5, cooldownHours: 72, unique: false, durationHours: 8, effects: [rel(1, 0), mood(0.1), item(ITEM.pressedFlower, 1), history('Spring blossom covered the orchard.', 2)],
    importance: 2, icon: '🌸', tags: ['season', 'nature'],
  },
  {
    id: 'event_fishing_rivalry', title: 'Fishing Rivalry', description: 'Finn and a visitor have been comparing catches at the river for an hour. Neither will admit defeat.',
    category: 'interesting', weight: 6, conditions: [{ kind: 'hourRange', from: 5, to: 20 }], locationTags: ['river', 'lake', 'riverside'],
    minParticipants: 1, maxParticipants: 3, cooldownHours: 36, unique: false, durationHours: 2, effects: [rel(1, 0), history('A friendly fishing rivalry ran late into the afternoon.', 1)],
    importance: 1, icon: '🎣', tags: ['fishing'],
  },
  {
    id: 'event_art_show', title: 'An Artist Sets Up', description: 'Jasper has propped easels along the square and is painting whoever stops to watch.',
    category: 'ordinary', weight: 6, conditions: [{ kind: 'hourRange', from: 10, to: 18 }], locationTags: ['plaza', 'city', 'park'],
    minParticipants: 1, maxParticipants: 4, cooldownHours: 48, unique: false, durationHours: 4, effects: [rel(1, 0), item(ITEM.paintedCard, 1), history('An artist set up in the square.', 1)],
    importance: 1, icon: '🎨', tags: ['art'],
  },
  {
    id: 'event_museum_news', title: 'Museum News', description: 'Penelope is excited: a small historical find has been donated to the museum and put on display.',
    category: 'interesting', weight: 5, conditions: [], locationTags: ['museum', 'city'],
    minParticipants: 1, maxParticipants: 4, cooldownHours: 96, unique: false, durationHours: 3, effects: [rel(1, 1), history('A new exhibit arrived at the museum.', 2)],
    importance: 2, icon: '🏛️', tags: ['museum', 'city'],
  },
  {
    id: 'event_city_busker', title: 'A Busker In The City', description: 'A busker with a battered guitar has drawn a small, shifting crowd on the high street.',
    category: 'ordinary', weight: 8, conditions: [{ kind: 'hourRange', from: 10, to: 21 }], locationTags: ['city', 'street', 'plaza'],
    minParticipants: 1, maxParticipants: 5, cooldownHours: 24, unique: false, durationHours: 3, effects: [money(-50), rel(0, 0), history('A busker played on the high street.', 1)],
    importance: 1, icon: '🎸', tags: ['city', 'music'],
  },
  {
    id: 'event_evening_rain', title: 'Evening Rain', description: 'Rain arrives just as the shops close. Steam rises from the pavements. Smoke and weather mix.',
    category: 'ordinary', weight: 9, conditions: [{ kind: 'hourRange', from: 17, to: 23 }], locationTags: ['town', 'city', 'street'],
    minParticipants: 1, maxParticipants: 4, cooldownHours: 24, unique: false, durationHours: 2, effects: [weather('rain', 4), history('Evening rain swept through the streets.', 1)],
    importance: 1, icon: '🌆', tags: ['weather'],
  },
  {
    id: 'event_special_moon', title: 'Moon Over The Lake', description: 'The lake is so still that the moon seems to be sitting on the water. A few people have come out to look.',
    category: 'lucky', weight: 4, conditions: [{ kind: 'hourRange', from: 20, to: 3 }, { kind: 'weather', weathers: ['clear'] }], locationTags: ['lake', 'park', 'river'],
    minParticipants: 1, maxParticipants: 5, cooldownHours: 240, unique: true, durationHours: 2, effects: [mood(0.12), rel(1, 1), item(ITEM.fishMoonfish, 1), history('A remarkable moonlit night over the lake.', 3), flag('saw_the_moon')],
    importance: 3, icon: '🌕', tags: ['special', 'nature'],
  },
  {
    id: 'event_letter_from_friend', title: 'A Letter From A Friend', description: 'A familiar handwriting sits on the doormat. Someone you know has taken the trouble to write.',
    category: 'ordinary', weight: 6, conditions: [{ kind: 'minInfluence', value: 20 }], locationTags: ['indoor', 'town'],
    minParticipants: 1, maxParticipants: 1, cooldownHours: 48, unique: false, durationHours: 1, effects: [rel(1, 2), history('A friend wrote a letter.', 2)],
    importance: 2, icon: '📮', tags: ['social'],
  },
  {
    id: 'event_community_meeting', title: 'Community Meeting', description: 'Edmund has called a meeting in the hall about the state of the public paths. There is tea.',
    category: 'interesting', weight: 5, conditions: [{ kind: 'hourRange', from: 17, to: 21 }], locationTags: ['community', 'plaza', 'library'],
    minParticipants: 3, maxParticipants: 8, cooldownHours: 168, unique: false, durationHours: 3, effects: [rel(1, 1), history('A community meeting discussed the public paths.', 2), flag('community_meeting_held')],
    importance: 2, icon: '🗓️', tags: ['community'],
  },
];

const activity = (id: string, label: string, description: string, skill?: 'gardening' | 'fishing' | 'foraging' | 'exploration' | 'crafting' | 'cooking' | 'social' | 'art', rewardMoney = 0, rewardItemId?: string) => ({
  id,
  label,
  description,
  ...(skill ? { skill } : {}),
  ...(rewardMoney > 0 ? { rewardMoney } : {}),
  ...(rewardItemId ? { rewardItemId } : {}),
});

export const FESTIVALS: FestivalDef[] = [
  {
    id: 'fest_spring_flowers', name: 'Spring Flower Festival', description: 'Willowbrook celebrates the blossom with flower stalls, a garden show and the first picnic of the year.',
    season: 'spring', dayOfSeason: 14, startHour: 9, durationHours: 8, locationId: LOC.plaza,
    activities: [
      activity('flower_garden_show', 'Garden Show', 'Present your best flowers to the village.', 'gardening', 300, ITEM.pressedFlower),
      activity('flower_stall', 'Flower Stall', 'Help Marigold run a stall in the square.', 'social', 150),
    ],
    importance: 3, npcInterestTags: ['flowers', 'gardening', 'social', 'nature'], visual: { shape: 'flower', color: '#e07aa0' },
  },
  {
    id: 'fest_summer_market', name: 'Summer Market', description: 'A long summer market day: stalls, music, cold drinks and a great deal of haggling.',
    season: 'summer', dayOfSeason: 21, startHour: 8, durationHours: 12, locationId: LOC.market,
    activities: [
      activity('summer_market_stall', 'Run a Stall', 'Sell your produce to the summer crowds.', 'social', 400),
      activity('summer_music', 'Evening Music', 'Enjoy the music on the green.', 'art', 100),
    ],
    importance: 3, npcInterestTags: ['market', 'music', 'social', 'food'], visual: { shape: 'food', color: '#e0a040' },
  },
  {
    id: 'fest_autumn_harvest', name: 'Harvest Festival', description: 'The village gives thanks for the harvest with a produce exhibition, a big supper and a lantern walk.',
    season: 'autumn', dayOfSeason: 20, startHour: 10, durationHours: 10, locationId: LOC.farm,
    activities: [
      activity('harvest_produce_show', 'Produce Exhibition', "Enter the season's best vegetables.", 'gardening', 500, ITEM.harvestCrown),
      activity('harvest_supper', 'Harvest Supper', 'Share a meal with the village.', 'cooking', 200),
    ],
    importance: 4, npcInterestTags: ['farming', 'food', 'social', 'tradition'], visual: { shape: 'leaf', color: '#c08040' },
  },
  {
    id: 'fest_winter_lights', name: 'Winter Lights', description: 'Lanterns, warm drinks and lights along the river mark the darkest days of the year.',
    season: 'winter', dayOfSeason: 12, startHour: 16, durationHours: 8, locationId: LOC.plaza,
    activities: [
      activity('winter_lanterns', 'Lantern Walk', 'Walk the lantern route along the river.', 'art', 250, ITEM.festivalRibbon),
      activity('winter_market', 'Winter Market', 'Warm drinks and hand-made gifts.', 'social', 200),
    ],
    importance: 3, npcInterestTags: ['lights', 'social', 'crafting', 'tradition'], visual: { shape: 'gem', color: '#e8d070' },
  },
  {
    id: 'fest_community_gathering', name: 'Community Gathering', description: 'A casual gathering on the green: chairs, tea, news and an argument about the path.',
    season: 'spring', dayOfSeason: 7, startHour: 14, durationHours: 4, locationId: LOC.park,
    activities: [activity('community_tea', 'Share Tea', 'Sit and talk with whoever turns up.', 'social', 80)],
    importance: 2, npcInterestTags: ['social', 'community'], visual: { shape: 'circle', color: '#a0c090' },
  },
  {
    id: 'fest_music_evening', name: 'Music Evening', description: 'Musicians from the town and city take the square for an evening of fiddles, songs and applause.',
    season: 'summer', dayOfSeason: 9, startHour: 18, durationHours: 5, locationId: LOC.plaza,
    activities: [activity('music_performance', 'Play A Song', 'Perform in front of the village.', 'art', 350, ITEM.festivalRibbon)],
    importance: 3, npcInterestTags: ['music', 'art', 'social'], visual: { shape: 'bottle', color: '#a080c0' },
  },
  {
    id: 'fest_fishing_contest', name: 'Fishing Contest', description: 'A friendly contest at the lake: the biggest fish wins a ribbon and bragging rights for a year.',
    season: 'summer', dayOfSeason: 3, startHour: 7, durationHours: 6, locationId: LOC.lake,
    activities: [activity('fishing_contest_enter', 'Enter Contest', 'Catch the biggest fish you can.', 'fishing', 400, ITEM.festivalRibbon)],
    importance: 3, npcInterestTags: ['fishing', 'nature', 'competition'], visual: { shape: 'fish', color: '#5f9ec0' },
  },
  {
    id: 'fest_produce_show', name: 'Produce Show', description: 'The village hall displays the finest vegetables, jams and bread of the season.',
    season: 'autumn', dayOfSeason: 6, startHour: 10, durationHours: 6, locationId: LOC.center,
    activities: [activity('produce_show_enter', 'Enter Produce', 'Show off your best crop.', 'gardening', 300, ITEM.harvestCrown)],
    importance: 2, npcInterestTags: ['gardening', 'food', 'tradition'], visual: { shape: 'leaf', color: '#c0a040' },
  },
  {
    id: 'fest_art_exhibition', name: 'Art Exhibition', description: 'The museum hosts local artists, photographs and the occasional very odd sculpture.',
    season: 'autumn', dayOfSeason: 13, startHour: 11, durationHours: 7, locationId: LOC.museum,
    activities: [activity('art_exhibition_show', 'Show A Piece', 'Exhibit your work at the museum.', 'art', 350, ITEM.artSupplies)],
    importance: 3, npcInterestTags: ['art', 'city', 'social'], visual: { shape: 'book', color: '#80a0c0' },
  },
  {
    id: 'fest_city_culture_day', name: 'City Culture Day', description: 'Ashford celebrates its museums, music and food with a day of events along the riverside and the cultural centre.',
    season: 'spring', dayOfSeason: 24, startHour: 10, durationHours: 10, locationId: LOC.culturalCenter,
    activities: [
      activity('culture_exhibition', 'Cultural Exhibition', 'Visit the cultural centre displays.', 'art', 150),
      activity('culture_food', 'Street Food', 'Sample food from across the city.', 'cooking', 120),
    ],
    importance: 3, npcInterestTags: ['city', 'art', 'music', 'food'], visual: { shape: 'gem', color: '#a0a0e0' },
  },
];
