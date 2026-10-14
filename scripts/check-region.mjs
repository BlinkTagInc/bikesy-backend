// Validate region configs and report what each still needs before a data build.
// Usage: node scripts/check-region.mjs [REGION ...]   (default: every config/REGION.json)
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRegionConfigs, validateRegionConfig } from '../src/config.js';

const REVIEW_FILES = ['inputs.lock.json', 'quality.json', 'target-ways.json', 'baseline-access-overrides.json', 'baseline-graph-edges.jsonl'];
const readJson = path => JSON.parse(readFileSync(path));

// Uncompressed Skadi HGT tiles covering the build bounds, as fetch-dem.py names them.
export function demTiles({ left, bottom, right, top }) {
  const tiles = [];
  for (let lat = Math.floor(bottom); lat <= Math.floor(top); lat++) {
    for (let lon = Math.floor(left); lon <= Math.floor(right); lon++) {
      const ns = `${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}`;
      tiles.push(`elevation/${ns}/${ns}${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}.hgt`);
    }
  }
  return tiles;
}

export function checkRegion({ region, path, config }, root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const errors = [];
  const warnings = [];
  let runtime;
  try {
    runtime = validateRegionConfig(config);
  } catch (error) {
    return { region, errors: [error.message], warnings };
  }
  const inside = ({ lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= runtime.bounds.bottom && lat <= runtime.bounds.top && lon >= runtime.bounds.left && lon <= runtime.bounds.right;

  const trips = readJson(resolve(root, 'test/fixtures/smoke-regions.json'))[region] ?? [];
  for (const trip of trips) {
    if (trip.locations?.length !== 2 || !trip.locations.every(inside)) {
      errors.push(`Smoke trip "${trip.name}" needs two locations inside the service bounds`);
    }
  }
  if (!trips.length) warnings.push('No smoke trips in test/fixtures/smoke-regions.json; smoke-region.mjs will only route the readiness trip');

  const reviewDir = [resolve(root, 'graph', region), resolve(root, 'graph')]
    .find(dir => existsSync(resolve(dir, 'quality.json')) && readJson(resolve(dir, 'quality.json')).region === region);
  const missingReview = reviewDir ? REVIEW_FILES.filter(name => !existsSync(resolve(reviewDir, name))) : REVIEW_FILES;
  if (!reviewDir) warnings.push(`No reviewed build inputs in graph/${region}/; rebuild-variant.py needs --review DIR`);
  else if (missingReview.length) errors.push(`Review directory ${relative(root, reviewDir) || '.'} lacks ${missingReview.join(', ')}`);

  const release = readJson(resolve(root, 'release.json'));
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (release.runtime_files?.[`config/${region}.json`] !== digest) {
    warnings.push('release.json does not lock this config; run node scripts/lock-source.mjs');
  }
  return {
    region, errors, warnings,
    service_bounds: runtime.bounds, build_bounds: runtime.dataBounds, admin_states: runtime.admin_states,
    scenarios: Object.keys(runtime.scenarios), readiness_scenario: runtime.readiness.scenario,
    smoke_trips: trips.length, review_dir: reviewDir ? relative(root, reviewDir) || '.' : null, dem_tiles: demTiles(runtime.dataBounds),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const regions = listRegionConfigs();
  const requested = process.argv.slice(2);
  const unknown = requested.filter(name => !regions.some(({ region }) => region === name));
  if (unknown.length) {
    console.error(`Unknown region(s) ${unknown.join(', ')}; add config/REGION.json (see docs/REGIONS.md#adding-a-region)`);
    process.exit(1);
  }
  const reports = regions.filter(({ region }) => !requested.length || requested.includes(region)).map(entry => checkRegion(entry));
  console.log(JSON.stringify(reports, null, 2));
  process.exitCode = reports.some(report => report.errors.length) ? 1 : 0;
}
