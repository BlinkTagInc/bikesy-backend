import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertTrip } from '../src/adapter.js';
import { readFileSync } from 'node:fs';

test('actual adapter retains pedestrian maneuver warning without inventing a stair count',()=>{
 const capture=JSON.parse(readFileSync(new URL('./fixtures/valhalla-current-sf-wiggle.json',import.meta.url)));
 const route=structuredClone(capture.route);route.trip.legs[0].maneuvers[0].travel_mode='pedestrian';route.trip.legs[0].maneuvers[0].length=.004;
 const result=convertTrip(route);assert.equal(result.route_warnings[0].code,'walk_bicycle');assert(!JSON.stringify(result.route_warnings).includes('step_count'));
});
