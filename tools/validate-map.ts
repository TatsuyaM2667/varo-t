/**
 * Prints the sight-line analysis for every stage map, Meridian Yard and a
 * sample of its seeded layouts, and writes docs/map-validation.md.
 *   npm run validate:map
 */
import { writeFileSync } from "node:fs";
import { Rng } from "../src/sim/core/rng";
import { checkLayout, generateCoverLayout } from "../src/sim/map/generator";
import { LOS_LIMITS, analyseLayout } from "../src/sim/map/los-check";
import { type BoxDef, COVER_SLOTS, type MapData, buildMeridianYard } from "../src/sim/map/map-def";
import { STAGES, buildMap } from "../src/sim/map/registry";

const lines: string[] = ["# Map validation", "", `Generated ${new Date().toISOString()} by \`tools/validate-map.ts\`.`, ""];
lines.push(
  "| layout | site points | death-spot % (no cover within 3 m from half the posts) | max exposure | covers w/o safe spot | longest sightline | spawns see each other | extra checks |",
);
lines.push("|---|---|---|---|---|---|---|---|");

function row(name: string, map: MapData, extra: { ok: boolean; problems: string[] } = { ok: true, problems: [] }): boolean {
  const r = analyseLayout(map);
  const ok = r.deathSpotFraction <= LOS_LIMITS.maxDeathSpotFraction && !r.spawnsVisible && extra.ok;
  lines.push(
    `| ${name} | ${r.sitePoints} | ${(r.deathSpotFraction * 100).toFixed(1)}% | ${r.maxExposure} | ${r.coversWithoutSafeSpot.length} | ${r.longestSightline.toFixed(1)} m${r.longestSightline > LOS_LIMITS.maxSightline ? " (long lane)" : ""} | ${r.spawnsVisible ? "YES" : "no"} | ${extra.ok ? "ok" : extra.problems.join("; ")} |`,
  );
  return ok;
}

let allOk = true;
for (const st of STAGES) allOk = row(`${st.map} (${st.difficulty})`, buildMap(st.map)) && allOk;
const yardRow = (name: string, cover: readonly BoxDef[]): boolean => {
  const map = buildMeridianYard(cover);
  return row(name, map, checkLayout(map, cover));
};
allOk = yardRow("yard (authored)", COVER_SLOTS) && allOk;
for (let s = 1; s <= 6; s++) allOk = yardRow(`yard seed ${s}`, generateCoverLayout(new Rng(s))) && allOk;
lines.push(
  "",
  `Limits: death-spot ≤ ${LOS_LIMITS.maxDeathSpotFraction * 100}%, no spawn-to-spawn sight lines. Sightlines over ${LOS_LIMITS.maxSightline} m are flagged as long lanes (intended for the sniper on stage maps).`,
  "",
  allOk ? "**All layouts pass.**" : "**Some layouts fail — see table.**",
);
writeFileSync("docs/map-validation.md", `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
process.exit(allOk ? 0 : 1);
