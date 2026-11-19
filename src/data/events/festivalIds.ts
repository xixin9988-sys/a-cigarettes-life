/** Canonical festival ids (Agent 0). */
export const FESTIVAL = {
  springFlowers: 'fest_spring_flowers',
  summerMarket: 'fest_summer_market',
  autumnHarvest: 'fest_autumn_harvest',
  winterLights: 'fest_winter_lights',
  communityGathering: 'fest_community_gathering',
  musicEvening: 'fest_music_evening',
  fishingContest: 'fest_fishing_contest',
  produceShow: 'fest_produce_show',
  artExhibition: 'fest_art_exhibition',
  cityCultureDay: 'fest_city_culture_day',
} as const;

export const ALL_FESTIVAL_IDS: readonly string[] = Object.values(FESTIVAL);
