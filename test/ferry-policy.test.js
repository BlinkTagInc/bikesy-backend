import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdapter,parseQuery} from '../src/adapter.js';
import {loadConfig} from '../src/config.js';
import {encode} from '../src/polyline.js';
const config=loadConfig({});
const q=()=>new URLSearchParams('lat1=37.77&lng1=-122.43&lat2=37.771&lng2=-122.43&scenario=3');
const shape=encode([[37.77,-122.43],[37.771,-122.43]],6);
const trip=ferry=>({trip:{status:0,units:'kilometers',summary:{length:.111,has_ferry:ferry},legs:[{shape,maneuvers:[{type:1,begin_shape_index:0,street_names:['Road']}]}]}});
const heights={range_height:[[0,10],[111.195,11]],encoded_polyline:shape};
const response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
test('hard land request, single certified ferry retry, unchanged legacy success shape',async()=>{
 const calls=[];
 const fetch=async(url,opt)=>{calls.push({url:String(url),body:JSON.parse(opt.body)});return response(calls.length===1?{error_code:470,error:'Bikesy certified land disconnection'}:String(url).endsWith('/route')?trip(true):heights)};
 const out=await createAdapter(config,fetch)(q());assert.equal(out.total_distance,111);assert.equal(calls.length,3);assert.equal(calls[0].body.costing_options.bicycle.use_ferry,0);assert.equal(calls[1].body.costing_options.bicycle.use_ferry,.5);assert.deepEqual(calls[0].body.locations,calls[1].body.locations);
});
test('generic no-path, snapping, connectivity, search limits and malformed proof never allow ferries',async()=>{
 for(const code of [170,171,154,442,443,470,499,504]){let count=0;await assert.rejects(createAdapter(config,async()=>{count++;return response({error_code:code,error:'unproven'})})(q()));assert.equal(count,1,'code '+code)}
});
test('timeout, cancellation and endpoint bounds cannot trigger ferry fallback',async()=>{
 let calls=0;await assert.rejects(createAdapter({...config,timeoutMs:1},async(_u,{signal})=>{calls++;await new Promise(r=>setTimeout(r,10));signal.throwIfAborted()})(q()),e=>e.status===504);assert.equal(calls,1);
 const stop=new AbortController();stop.abort();calls=0;await assert.rejects(createAdapter(config,async()=>{calls++})(q(),stop.signal),e=>e.status===499);assert.equal(calls,0);
 const bad=q();bad.set('lat1','39');assert.throws(()=>parseQuery(bad,config),/bounds/);
});
test('land pass cannot silently return a ferry and ferry retry cannot recurse',async()=>{
 let count=0;await assert.rejects(createAdapter(config,async()=>{count++;return response(trip(true))})(q()),e=>e.status===502);assert.equal(count,1);
 count=0;await assert.rejects(createAdapter(config,async()=>{count++;return response({error_code:470,error:'Bikesy certified land disconnection'})})(q()),e=>e.status===502);assert.equal(count,2);
});
test('certified fallback shares the original deadline and abort signal',async()=>{
 const calls=[];const fetch=async(_url,{signal,body})=>{calls.push({signal,body:JSON.parse(body)});if(calls.length===1)return response({error_code:470,error:'Bikesy certified land disconnection'});await new Promise(r=>setTimeout(r,35));signal.throwIfAborted();return response(trip(true))};
 await assert.rejects(createAdapter({...config,timeoutMs:15},fetch)(q()),e=>e.status===504);
 assert.equal(calls.length,2);assert.equal(calls[0].signal,calls[1].signal);assert.equal(calls[1].body.costing_options.bicycle.use_ferry,.5);
});
test('a proof arriving after deadline cannot start a ferry retry',async()=>{
 let calls=0;await assert.rejects(createAdapter({...config,timeoutMs:10},async()=>{calls++;await new Promise(r=>setTimeout(r,25));return response({error_code:470,error:'Bikesy certified land disconnection'})})(q()),e=>e.status===504);assert.equal(calls,1);
});
test('network failure and cancellation during fallback stop without another attempt',async()=>{
 let calls=0;await assert.rejects(createAdapter(config,async()=>{calls++;throw Error('connection reset')})(q()),e=>e.status===502);assert.equal(calls,1);
 const client=new AbortController();calls=0;await assert.rejects(createAdapter(config,async(_url,{signal})=>{calls++;if(calls===1)return response({error_code:470,error:'Bikesy certified land disconnection'});client.abort();signal.throwIfAborted()})(q(),client.signal),e=>e.status===499);assert.equal(calls,2);
});
