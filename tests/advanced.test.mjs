import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {sanitizeHar,waterfall,addFingerprints,compareRequests} from '../dist/advanced.mjs';
import {readHar} from '../dist/har.mjs';
import {validateConfig} from '../dist/settings.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const entry=(url,extra={})=>({startedDateTime:'2026-11-23T10:00:00Z',time:40,request:{url,method:'GET'},response:{status:200,bodySize:100},timings:{blocked:0,dns:0,connect:10,ssl:8,send:0,wait:20,receive:10},...extra});
const archive=entries=>({log:{version:'1.2',entries}});

test('sanitization rebuilds the schema and removes secrets from every known container and extension',()=>{
  const secret='private-secret-54321';
  const source=archive([entry(`https://user:${secret}@example.ca/person/${secret}?token=${secret}#${secret}`,{
    comment:secret,serverIPAddress:secret,connection:secret,_webSocketMessages:[{data:secret}],_initiator:{stack:secret},
    request:{url:`https://user:${secret}@example.ca/person/${secret}?token=${secret}#${secret}`,method:'POST',httpVersion:'HTTP/2',comment:secret,
      headers:[{name:'Authorization',value:secret},{name:'X-Unrecognized',value:secret}],cookies:[{name:'sid',value:secret,domain:secret,path:secret}],
      queryString:[{name:'token',value:secret}],postData:{mimeType:'multipart/form-data; boundary='+secret,text:secret,params:[{name:'upload',value:secret,fileName:secret,contentType:secret}]}},
    response:{status:200,statusText:secret,httpVersion:'HTTP/2',redirectURL:`https://example.net/${secret}?token=${secret}`,headers:[{name:'Set-Cookie',value:secret}],cookies:[{name:'serverid',value:secret,comment:secret}],content:{text:secret,encoding:secret,size:12,mimeType:'text/plain; note='+secret,_opaque:secret},_body:secret},
  }),{request:{url:`file:///${secret}`}}]);
  source.log.creator={name:secret};source.log.browser={version:secret};source.log.pages=[{title:secret,id:secret}];source.log._unknown={secret};
  const before=JSON.stringify(source),result=sanitizeHar(source),output=JSON.stringify(result);
  assert.ok(!output.includes(secret));assert.equal(JSON.stringify(source),before);
  assert.equal(result.har.log.entries.length,1);
  const row=result.har.log.entries[0];assert.equal(row.request.url,'https://example.ca/_redacted_?token=%5BREDACTED%5D');assert.equal(row.startedDateTime,'2000-01-01T00:00:00.000Z');
  assert.equal(row.request.postData.params[0].value,'[REDACTED]');assert.equal(row.response.content.text,undefined);assert.equal(row._initiator,undefined);
  assert.equal(result.report.counts.headerValues,3);assert.equal(result.report.counts.cookieValues,2);assert.equal(result.report.counts.skipped,1);
  assert.equal(readHar(result.har).rows.length,1);
});

test('explicit path/date opt-ins retain only those fields and default shifted times preserve intervals',()=>{
  const input=archive([entry('https://example.ca/a?x=secret'),entry('https://example.ca/b',{startedDateTime:'2026-11-23T10:00:02Z'})]);
  const cleaned=sanitizeHar(input);assert.equal(cleaned.har.log.entries[1].startedDateTime,'2000-01-01T00:00:02.000Z');
  const kept=sanitizeHar(input,{keepPaths:true,keepDates:true});assert.ok(kept.har.log.entries[0].request.url.includes('/a?'));assert.ok(!JSON.stringify(kept.har).includes('secret'));assert.equal(kept.har.log.entries[0].startedDateTime,'2026-11-23T10:00:00.000Z');
  assert.throws(()=>sanitizeHar(input,{maxEntries:1}),/entry limit/);
  const missing=sanitizeHar(archive([entry('https://example.ca/',{startedDateTime:null,time:-1})])).har.log.entries[0];assert.equal(missing.startedDateTime,undefined);assert.equal(missing.time,-1);
});

test('waterfall excludes missing timing, does not count TLS twice and uses endpoint ties correctly',()=>{
  const rows=readHar(archive([entry('https://a.ca/'),entry('https://b.ca/',{startedDateTime:'2026-11-23T10:00:00.020Z'}),entry('https://c.ca/',{startedDateTime:null}),entry('https://d.ca/',{startedDateTime:'2026-11-23T10:00:00.040Z',time:0})])).rows;
  const result=waterfall(rows,2);assert.equal(result.measured,3);assert.equal(result.unavailable,1);assert.equal(result.peak,2);assert.equal(result.span,60);assert.equal(result.rows.length,2);assert.equal(result.rows[0].phaseTotal,40);assert.equal(result.rows[0].phaseMismatch,false);assert.ok(!result.rows[0].segments.some(x=>x.key==='ssl'));
  assert.equal(waterfall([{...rows[0],duration:1}]).rows[0].phaseMismatch,true);
});

test('request matching modes distinguish exact URLs while omitting URL data from reports',async()=>{
  const beforeInput=archive([entry('https://example.ca/path-secret?token=before-secret')]);const afterInput=archive([entry('https://example.ca/path-secret?token=after-secret',{response:{status:403,bodySize:0}})]);
  const make=async(input,mode,salt='test')=>addFingerprints(readHar(input),input,{mode,salt});
  const before=await make(beforeInput,'endpoint'),after=await make(afterInput,'endpoint');
  const matched=compareRequests(before.rows,after.rows);assert.equal(matched.length,1);assert.equal(matched[0].change,'changed');assert.equal(matched[0].sizeDelta,-100);assert.ok(!JSON.stringify(matched).includes('secret'));
  const exact=compareRequests((await make(beforeInput,'exact')).rows,(await make(afterInput,'exact')).rows);assert.deepEqual(exact.map(x=>x.change),['removed','added']);
  assert.notEqual(before.rows[0].fingerprint,(await make(beforeInput,'endpoint','different')).rows[0].fingerprint);
});

test('duplicate endpoints pair by occurrence and preserve missing measurements and names',async()=>{
  const b=archive([entry('https://a.ca/a'),entry('https://a.ca/a',{time:-1})]);const a=archive([entry('https://a.ca/a',{time:50}),entry('https://a.ca/a',{time:0}),entry('https://a.ca/a')]);
  const before=await addFingerprints(readHar(b),b),after=await addFingerprints(readHar(a),a);
  after.rows[0].cookieNames=['new-cookie'];before.rows[0].cookieNames=['old-cookie'];
  const rows=compareRequests(before.rows,after.rows);assert.equal(rows.length,3);assert.deepEqual(rows.map(x=>x.occurrence),[1,2,3]);assert.equal(rows[0].durationDelta,10);assert.equal(rows[1].durationDelta,null);assert.equal(rows[2].change,'added');assert.deepEqual(rows[0].fields.cookieNames,{added:['new-cookie'],removed:['old-cookie']});
});

test('editable service configuration accepts another entry without fixed counts',()=>{
  const config=JSON.parse(readFileSync(new URL('../web/config.json',import.meta.url)));
  config.documentedServices['example.ca']={name:'My documented service',source:'https://example.ca/docs'};
  const checked=validateConfig(config),capture=readHar(archive([entry('https://logs.example.ca/')]),checked);
  assert.equal(capture.rows[0].service.name,'My documented service');
  assert.throws(()=>validateConfig({...config,maxEntries:200001}),/configuration/);
});
