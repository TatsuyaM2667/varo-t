/**
 * Prints the sight-line analysis for the authored layout and a sample of
 * seeded layouts, and writes docs/map-validation.md.
 *   npm run validate:map
 */
import { writeFileSync } from "node:fs";
import { Rng } from "../src/sim/core/rng";
import { generateCoverLayout, checkLayout } from "../src/sim/map/generator";
import { LOS_LIMITS, analyseLayout } from "../src/sim/map/los-check";
import {
  type BoxDef,
  COVER_SLOTS,
  buildMeridianYard,
} from "../src/sim/map/map-def";

const lines: string[] = [
  "# Map validation (Meridian Yard)",
  "",
  `Generated ${new Date().toISOString()} by \`tools/validate-map.ts\`.`,
  "",
];
lines.push(
  "| layout | site points | death-spot % (≥3 posts see you) | max exposure | covers w/o safe spot | longest sightline | spawns see each other | generator checks |",
);
lines.push("|---|---|---|---|---|---|---|---|");

function row(name: string, cover: readonly BoxDef[] = COVER_SLOTS): boolean {
  const map = buildMeridianYard(cover);
  const r = analyseLayout(map);
  const chk = checkLayout(map, cover);
  const ok =
    r.deathSpotFraction <= LOS_LIMITS.maxDeathSpotFraction &&
    r.longestSightline <= LOS_LIMITS.maxSightline &&
    !r.spawnsVisible &&
    chk.ok;
  lines.push(
    `| ${name} | ${r.sitePoints} | ${(r.deathSpotFraction * 100).toFixed(1)}% | ${r.maxExposure} | ${r.coversWithoutSafeSpot.length ? r.coversWithoutSafeSpot.join(", ") : "0"} | ${r.longestSightline.toFixed(1)} m | ${r.spawnsVisible ? "YES" : "no"} | ${chk.ok ? "ok" : chk.problems.join("; ")} |`,
  );
  return ok;
}

let allOk = row("authored");
for (let s = 1; s <= 10; s++)
  allOk = row(`seed ${s}`, generateCoverLayout(new Rng(s))) && allOk;
lines.push(
  "",
  `Limits: death-spot ≤ ${LOS_LIMITS.maxDeathSpotFraction * 100}%, longest sightline ≤ ${LOS_LIMITS.maxSightline} m, no spawn-to-spawn sight lines.`,
  "",
  allOk ? "**All layouts pass.**" : "**Some layouts fail — see table.**",
);
writeFileSync("docs/map-validation.md", `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
process.exit(allOk ? 0 : 1);
