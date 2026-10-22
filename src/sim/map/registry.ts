import type { Difficulty } from '../../config/bots';
import { type MapData, buildMeridianYard } from './map-def';
import { buildFromSpec } from './spec';
import { BAZAAR, FOUNDRY, TERRACE } from './stages';

export type MapId = 'yard' | 'bazaar' | 'terrace' | 'foundry';

export const MAP_IDS: MapId[] = ['bazaar', 'terrace', 'foundry', 'yard'];

const cache = new Map<MapId, MapData>();

/** Build (or reuse) a map. Maps are immutable once built, so sharing is safe. */
export function buildMap(id: MapId): MapData {
  let m = cache.get(id);
  if (!m) {
    m = id === 'yard' ? buildMeridianYard() : buildFromSpec(id === 'bazaar' ? BAZAAR : id === 'terrace' ? TERRACE : FOUNDRY);
    cache.set(id, m);
  }
  return m;
}

/** One stage per difficulty. ★ ステージごとの敵の数の初期値はここ */
export interface StageDef {
  map: MapId;
  difficulty: Difficulty;
  enemies: number;
  title: { ja: string; en: string };
  blurb: { ja: string; en: string };
}

export const STAGES: StageDef[] = [
  {
    map: 'bazaar',
    difficulty: 'easy',
    enemies: 4,
    title: { ja: 'ステージ1 ルーメン・バザール', en: 'Stage 1 — Lumen Bazaar' },
    blurb: { ja: '砂色の市場街。門の通りから3つの路地を抜けて中継塔へ', en: 'A sun-baked market: through the gate street and three lanes to the relay' },
  },
  {
    map: 'terrace',
    difficulty: 'normal',
    enemies: 5,
    title: { ja: 'ステージ2 キヨミ・テラス', en: 'Stage 2 — Kiyomi Terrace' },
    blurb: { ja: '段々の坂の町。石段と門をのぼって頂上の社を制圧せよ', en: 'A hillside town: climb the terraces to take the shrine' },
  },
  {
    map: 'foundry',
    difficulty: 'hard',
    enemies: 6,
    title: { ja: 'ステージ3 アイアンヴェイル製鉄所', en: 'Stage 3 — Ironvale Foundry' },
    blurb: { ja: '狭い屋内と長い射線。キャットウォークから撃ち下ろされる溶鉱炉ホール', en: 'Tight halls, long lanes and a catwalk over the furnace hall' },
  },
];
