// HAR is untrusted input. Rebuild a small known schema rather than deleting known secrets.
const NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/;
const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const numeric = value => finite(value) ? value : -1;
const list = value => Array.isArray(value) ? value : [];
const cleanMime = value => typeof value === 'string' && MIME.test(value.split(';')[0].trim()) ? value.split(';')[0].trim() : 'application/octet-stream';
const httpVersion = value => typeof value === 'string' && /^(?:HTTP\/[0-9.]+|h2|h3)$/i.test(value) ? value : '';
const method = value => typeof value === 'string' && /^[A-Z!#$%&'*+.^_`|~-]{1,25}$/i.test(value) ? value.toUpperCase() : 'UNKNOWN';
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const safeUrl = value => {try {const url=new URL(value);return ['http:','https:','ws:','wss:'].includes(url.protocol)?url:null;}catch{return null;}};
export const phaseOrder = ['blocked','dns','connect','send','wait','receive'];

export function sanitizeHar(input, {keepPaths=false,keepDates=false,maxEntries=200000}={}) {
  if (!Array.isArray(input?.log?.entries)) throw new Error('This JSON has no HAR log.entries array.');
  if (input.log.entries.length > maxEntries) throw new Error('The capture exceeds the configured entry limit.');
  const counts={entries:0,skipped:0,headerValues:0,cookieValues:0,queryValues:0,formValues:0,requestBodies:0,responseBodies:0,paths:0,redirects:0,timestamps:0};
  let first=Infinity;
  for(const entry of input.log.entries){const date=validDate(entry?.startedDateTime);if(date!==null&&safeUrl(entry?.request?.url))first=Math.min(first,date);}
  const named = (items,key) => list(items).filter(x=>x && typeof x.name==='string' && NAME.test(x.name)).map(x=>{counts[key]++;return {name:x.name,value:'[REDACTED]'};});
  const scrubUrl = value => {
    const url=safeUrl(value); if(!url)return null;
    url.username='';url.password='';url.hash='';
    const query=[...url.searchParams].filter(([name])=>NAME.test(name)).map(([name])=>({name,value:'[REDACTED]'}));
    counts.queryValues+=query.length;url.search='';
    for(const row of query)url.searchParams.append(row.name,row.value);
    if(!keepPaths && url.pathname!=='/'){url.pathname='/_redacted_';counts.paths++;}
    return {url:url.href,query};
  };
  const entries=[];
  for(const entry of input.log.entries){
    const request=entry?.request||{}, response=entry?.response||{}, cleaned=scrubUrl(request.url);
    if(!cleaned){counts.skipped++;continue;}
    const date=validDate(entry.startedDateTime);
    const out={time:numeric(entry.time),request:{method:method(request.method),url:cleaned.url,httpVersion:httpVersion(request.httpVersion),headers:named(request.headers,'headerValues'),cookies:named(request.cookies,'cookieValues'),queryString:cleaned.query,headersSize:numeric(request.headersSize),bodySize:numeric(request.bodySize)},response:{status:Number.isInteger(response.status)&&response.status>=0&&response.status<600?response.status:0,statusText:'',httpVersion:httpVersion(response.httpVersion),headers:named(response.headers,'headerValues'),cookies:named(response.cookies,'cookieValues'),content:{size:numeric(response.content?.size),mimeType:cleanMime(response.content?.mimeType)},redirectURL:'',headersSize:numeric(response.headersSize),bodySize:numeric(response.bodySize)},cache:{},timings:Object.fromEntries([...phaseOrder,'ssl'].map(key=>[key,numeric(entry.timings?.[key])]))};
    if(date!==null){out.startedDateTime=new Date(keepDates?date:Date.UTC(2000,0,1)+date-first).toISOString();if(!keepDates)counts.timestamps++;}
    if(request.postData){
      out.request.postData={mimeType:cleanMime(request.postData.mimeType),params:named(request.postData.params,'formValues')};
      if(Object.hasOwn(request.postData,'text'))counts.requestBodies++;
    }
    if(Object.hasOwn(response.content||{},'text'))counts.responseBodies++;
    if(response.redirectURL){const target=scrubUrl(response.redirectURL);out.response.redirectURL=target?.url||'';counts.redirects++;}
    if(typeof entry._resourceType==='string' && /^[a-z]{1,30}$/i.test(entry._resourceType))out._resourceType=entry._resourceType;
    entries.push(out);counts.entries++;
  }
  return {har:{log:{version:'1.2',creator:{name:'Tracker X-Ray sanitized export',version:'2'},entries}},report:{format:'trackerxray-sanitization-v1',counts,keepPaths,keepDates,removed:['All request and response header values','All cookie values and attributes','All URL query values, credentials and fragments','All body text, content encodings and uploaded filenames','All comments, page metadata, server IPs, connection IDs and unrecognized/vendor fields'],retained:['Hostnames and ports','Valid header, cookie, query and form field names','Methods, HTTP status, resource type, recorded sizes and timing measurements',keepPaths?'Original URL paths — may identify people or contain secrets':'URL paths replaced except the root path',keepDates?'Original absolute request dates':'Dates shifted together to 1 January 2000; relative timing remains'],limitations:'A reduced capture is not anonymous. Hostnames, field names, sizes and request patterns can still identify people or services. Inspect it before sharing. Missing input measurements remain unavailable; redaction placeholders are not original values.'}};
}

export function waterfall(rows, limit=80) {
  const timed=rows.filter(row=>finite(row.start)&&finite(row.duration));
  const span=timed.reduce((end,row)=>Math.max(end,row.start+row.duration),0);
  const ordered=[...timed].sort((a,b)=>a.start-b.start);
  const marks=[];
  for(const row of timed){if(row.duration>0){marks.push([row.start,1],[row.start+row.duration,-1]);}}
  marks.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,peak=0;for(const [,delta] of marks){active+=delta;peak=Math.max(peak,active);}
  return {span,peak,measured:timed.length,unavailable:rows.length-timed.length,rows:ordered.slice(0,limit).map(row=>{
    const phases=new Map(row.phases||[]);let offset=0;const segments=[];
    for(const key of phaseOrder){const duration=phases.get(key);if(finite(duration)){segments.push({key,start:offset,duration});offset+=duration;}}
    return {row,segments,phaseTotal:offset,phaseMismatch:segments.length>0&&Math.abs(offset-row.duration)>Math.max(1,row.duration*.02)};
  })};
}

export async function addFingerprints(capture, input, {mode='endpoint',salt=''}={}) {
  const cache=new Map();
  for(const row of capture.rows){
    const entry=input.log.entries[row.entryIndex],url=safeUrl(entry.request.url);url.username='';url.password='';url.hash='';
    if(mode==='endpoint'){const names=[...url.searchParams.keys()].sort();url.search='';for(const name of names)url.searchParams.append(name,'');}
    const identity=JSON.stringify([row.method,url.href]);
    if(!cache.has(identity)){
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+'\n'+identity));
      cache.set(identity,Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join(''));
    }
    row.fingerprint=cache.get(identity);
  }
  return capture;
}
const difference=(before,after,ignoreCase=false)=>{const norm=x=>ignoreCase?x.toLowerCase():x;const b=new Set(before.map(norm)),a=new Set(after.map(norm));return {added:after.filter(x=>!b.has(norm(x))),removed:before.filter(x=>!a.has(norm(x)))};};
const delta=(before,after)=>finite(before)&&finite(after)?after-before:null;
export function compareRequests(before,after) {
  const buckets=new Map();
  for(const row of after){if(!buckets.has(row.fingerprint))buckets.set(row.fingerprint,[]);buckets.get(row.fingerprint).push(row);}
  const seen=new Map(),matches=[],used=new Map();
  for(const row of before){const occurrence=(seen.get(row.fingerprint)||0)+1;seen.set(row.fingerprint,occurrence);const index=used.get(row.fingerprint)||0,target=buckets.get(row.fingerprint)?.[index];if(target)used.set(row.fingerprint,index+1);matches.push(pair(row,target,occurrence));}
  for(const [fingerprint,rows] of buckets)for(const row of rows.slice(used.get(fingerprint)||0)){const occurrence=(seen.get(row.fingerprint)||0)+1;seen.set(row.fingerprint,occurrence);matches.push(pair(null,row,occurrence));}
  return matches;
}
function pair(before,after,occurrence){
  const row=after||before;
  const fields=['requestHeaders','responseHeaders','queryNames','cookieNames','responseCookieNames','payloadNames'];
  const changes=Object.fromEntries(fields.map(key=>[key,difference(before?.[key]||[],after?.[key]||[],key.endsWith('Headers'))]));
  const measurements=['status','duration','size','requestSize','responseType','payloadType','hasPayload','resource'];
  const changed=before&&after&&(measurements.some(key=>before[key]!==after[key])||Object.values(changes).some(x=>x.added.length||x.removed.length)||JSON.stringify(before.phases)!==JSON.stringify(after.phases));
  return {fingerprint:row.fingerprint,occurrence,host:row.host,method:row.method,change:!before?'added':!after?'removed':changed?'changed':'unchanged',before:before||null,after:after||null,durationDelta:delta(before?.duration,after?.duration),sizeDelta:delta(before?.size,after?.size),fields:changes};
}
