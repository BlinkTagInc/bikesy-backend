import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../src/bridge-notices.js';
import {convertTrip} from '../src/adapter.js';
import {readFileSync} from 'node:fs';
const notices=globalThis.BikesyBridgeNotices;
test('bridge warnings are based on shown geometry, bidirectional, and not mere endpoint names',()=>{
 for(const [code,points]of [['golden_gate',[[37.808,-122.477],[37.829,-122.480]]],['carquinez',[[38.055,-122.230],[38.066,-122.228]]],['bay_east',[[37.811,-122.363],[37.822,-122.328]]]]){
  assert(notices({points}).some(x=>x.code===code));assert(notices({points:[...points].reverse()}).some(x=>x.code===code));
  assert(!notices({points:points.slice(0,1)}).some(x=>x.code===code));
 }
});
test('through Bay Bridge requests explain missing western connection independently of detour geometry',()=>{
 const a=[37.790,-122.390],b=[37.810,-122.300];for(const[start,end]of[[a,b],[b,a]])assert(notices({points:[],start,end}).some(x=>x.code==='bay_no_through'));
 assert(!notices({start:[37.81,-122.363],end:b}).some(x=>x.code==='bay_no_through'));
});
test('walking notice does not claim that all walking sections are stairs',()=>{
 const r=notices({walking:true})[0];assert.equal(r.code,'walk_bicycle');assert.match(r.text,/may require carrying/);
});
test('actual adapter retains pedestrian maneuver warning without inventing a stair count',()=>{
 const capture=JSON.parse(readFileSync(new URL('./fixtures/valhalla-current-sf-wiggle.json',import.meta.url)));
 const route=structuredClone(capture.route);route.trip.legs[0].maneuvers[0].travel_mode='pedestrian';route.trip.legs[0].maneuvers[0].length=.004;
 const result=convertTrip(route);assert.equal(result.route_warnings[0].code,'walk_bicycle');assert(!JSON.stringify(result.route_warnings).includes('step_count'));
});
