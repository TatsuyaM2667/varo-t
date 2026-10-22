/**
 * Character skins (procedural, no asset files). ★ キャラクターの色・装備のバリエーションはここ。
 *
 * LANTERN (attackers): dark tactical suit, warm amber trims, hooded scouts.
 * WARDEN (defenders): white/grey plate armour, cyan visor and light strips.
 */
export type HelmetStyle = 'visor' | 'crest' | 'hood';

export interface Skin {
  /** under-suit / fabric */
  suit: string;
  /** hard armour plates */
  armor: string;
  /** secondary armour / pouches */
  gear: string;
  /** gloves, boots, straps */
  dark: string;
  /** emissive trims and visor (team identity) */
  glow: string;
  /** rim highlight colour (makes the silhouette pop against the map) */
  rim: string;
  helmets: HelmetStyle[];
}

export const SKINS: { attackers: Skin; defenders: Skin } = {
  attackers: {
    suit: '#3d4250',
    armor: '#5d6372',
    gear: '#8a7254',
    dark: '#17191e',
    glow: '#ffb648',
    rim: '#ffcf7a',
    helmets: ['hood', 'visor', 'crest'],
  },
  defenders: {
    suit: '#5a6478',
    armor: '#e6e9ee',
    gear: '#9aa4b2',
    dark: '#2a2f39',
    glow: '#4fd1ff',
    rim: '#8fe3ff',
    helmets: ['visor', 'crest', 'visor'],
  },
};

export const CHARACTER_LOOK = {
  /** strength of the coloured edge glow on enemies of the viewer (0 = off) */
  enemyRim: 0.9,
  /** edge glow on the viewer's own team */
  allyRim: 0.35,
  /** emissive strength of trims / visor */
  glow: 1.5,
  /** self-illumination so the side away from the sun doesn't go black (× suit colour) */
  shadowLift: 0.35,
  /** small per-agent shade variation so bots are distinguishable */
  shadeVariation: 0.12,
};
