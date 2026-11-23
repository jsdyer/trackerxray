import { maxFileBytes } from './har.mjs';
import { compareCaptures } from './compare.mjs';
import { compareRequests } from './advanced.mjs';
import { loadConfig } from './settings.mjs';

const $ = id => document.getElementById(`compare-${id}`);
const sides = ['before', 'after'];
const labels = { before: 'Before', after: 'After' };
const changes = { added: 'New domain', removed: 'Missing domain', count: 'Count changed', hosts: 'Hosts changed', unchanged: 'Unchanged' };
const number = new Intl.NumberFormat();
const signed = new Intl.NumberFormat(undefined, { signDisplay: 'exceptZero' });
const config = await loadConfig();
const pageSize = config.comparisonPageSize;
const hostLimit = 60;
const captures = {};
let worker, report, page = 0, requestPage = 0, requestRows = [], salt = crypto.randomUUID();
$('mode').value = config.defaultMatchMode;

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function stopWorker() {
  worker?.terminate();
  worker = null;
  for (const side of sides) $(side).disabled = false;
}

function render() {
  if (!report) return;
  const requested = $('filter').value;
  const query = $('query').value.trim().toLowerCase();
  const matches = report.domains.filter(row => {
    if (requested === 'changes' && row.change === 'unchanged') return false;
    if (requested !== 'all' && requested !== 'changes' && row.change !== requested) return false;
    return !query || row.domain.includes(query) || row.hosts.some(host => host.host.includes(query));
  });
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  page = Math.min(page, pages - 1);
  $('page').textContent = `${number.format(matches.length)} domains · page ${number.format(page + 1)} of ${number.format(pages)}`;
  $('prev').disabled = page === 0;
  $('next').disabled = page + 1 >= pages;
  const rows = matches.slice(page * pageSize, (page + 1) * pageSize).map(row => {
    const tr = element('tr');
    const domain = element('td');
    const detail = element('details', null, 'compare-domain');
    detail.append(element('summary', row.domain));
    detail.addEventListener('toggle', () => {
      if (!detail.open) return;
      const visible = row.domain.includes(query) ? row.hosts : row.hosts.filter(host => host.host.includes(query));
      const list = element('ul');
      for (const host of visible.slice(0, hostLimit)) {
        list.append(element('li', `${host.host} · ${number.format(host.before)} → ${number.format(host.after)} (${signed.format(host.delta)})`, 'meta'));
      }
      detail.append(list);
      if (visible.length > hostLimit) detail.append(element('p', `Showing ${hostLimit} of ${number.format(visible.length)} hosts. Search or export to see the rest.`, 'notes muted'));
    }, { once: true });
    domain.append(detail);
    const sign = row.delta > 0 ? ' compare-positive' : row.delta < 0 ? ' compare-negative' : '';
    tr.append(domain, element('td', changes[row.change], `compare-${row.change}`), element('td', number.format(row.before), 'right'),
      element('td', number.format(row.after), 'right'), element('td', signed.format(row.delta), `right${sign}`));
    return tr;
  });
  if (!rows.length) {
    const row = element('tr');
    const empty = element('td', 'No domains match these filters.', 'muted');
    empty.colSpan = 5;
    row.append(empty);
    rows.push(row);
  }
  $('rows').replaceChildren(...rows);
}

function update() {
  report = captures.before && captures.after ? compareCaptures(captures.before, captures.after) : null;
  $('report').hidden = !report;
  $('rows').replaceChildren();
  $('stats').replaceChildren();
  $('context').textContent = '';
  $('page').textContent = '';
  $('query').value = '';
  $('filter').value = 'changes';
  page = 0;
  requestRows = report ? compareRequests(captures.before.rows, captures.after.rows) : [];
  requestPage = 0;
  if (!report) return;
  report.matchMode = $('mode').value;
  report.matching = 'Method and URL identity; repeated matches are paired by occurrence order. Salted fingerprints apply only to this comparison. URL paths and query values are omitted.';
  report.requests = requestRows;
  renderRequests();
  const { before, after, delta, addedDomains, removedDomains } = report;
  const stats = [
    [`${number.format(before.requests)} → ${number.format(after.requests)}`, 'Recorded requests'],
    [signed.format(delta), 'Request difference'],
    [number.format(addedDomains), 'New domains'],
    [number.format(removedDomains), 'Missing domains'],
  ];
  $('stats').replaceChildren(...stats.map(([value, label]) => {
    const block = element('div', null, 'stat');
    block.append(element('strong', value), element('span', label));
    return block;
  }));
  const site = before.site && before.site === after.site ? `Inferred site in both captures: ${before.site}.`
    : `Inferred sites: Before ${before.site || 'unavailable'}, After ${after.site || 'unavailable'}. Check the starting pages when interpreting the difference.`;
  const skipped = before.skipped || after.skipped ? ` Skipped unsupported or invalid entries: Before ${number.format(before.skipped)}, After ${number.format(after.skipped)}.` : '';
  $('context').textContent = site + skipped;
  render();
  status('Comparison ready. Changes describe the recorded requests in each capture.');
}

function setCapture(side, capture, prefix = '') {
  captures[side] = capture;
  $(`${side}-label`).textContent = `${prefix}${number.format(capture.requests)} recorded requests`;
}

function clear() {
  stopWorker();
  salt = crypto.randomUUID();
  requestRows = [];
  $('request-rows').replaceChildren();
  if($('detail').open)$('detail').close();
  for (const side of sides) {
    delete captures[side];
    $(side).value = '';
    $(`${side}-label`).textContent = 'No file selected';
  }
  $('clear').disabled = true;
  update();
  status('Load one file for each side.');
}

function load(side, file) {
  if (!file) return;
  delete captures[side];
  $('clear').disabled = false;
  $(`${side}-label`).textContent = 'Reading file…';
  update();
  function fail(message) {
    $(side).value = '';
    $(`${side}-label`).textContent = 'File could not be used';
    status(`${labels[side]} HAR: ${message}`, true);
  }
  if (file.size > config.maxFileMegabytes * 1024 * 1024) return fail(`This capture exceeds the configured ${config.maxFileMegabytes} MB limit. Export a shorter capture.`);
  for (const name of sides) $(name).disabled = true;
  status(`Reading the ${labels[side]} HAR locally…`);
  try {
    const reader = new Worker('./worker.mjs', { type: 'module' });
    worker = reader;
    reader.addEventListener('message', ({ data: reply }) => {
      if (worker !== reader) return;
      stopWorker();
      if (reply.error) return fail(reply.error);
      if (!reply.result.requests && reply.result.skipped) return fail('No valid HTTP or WebSocket requests were present.');
      setCapture(side, reply.result);
      status(`Load the ${side === 'before' ? 'After' : 'Before'} HAR to compare.`);
      update();
    });
    reader.addEventListener('error', () => {
      if (worker !== reader) return;
      stopWorker();
      fail('The capture reader stopped. Try a smaller or newly exported HAR.');
    });
    reader.postMessage({ file, compare: true, mode: $('mode').value, salt });
  } catch {
    stopWorker();
    fail('The capture reader could not start. Reload this page and retry.');
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = element('a');
  link.href = url;
  link.download = 'trackerxray-comparison.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

for (const side of sides) $(side).addEventListener('change', event => load(side, event.target.files[0]));
for (const id of ['query', 'filter']) $(id).addEventListener('input', () => { page = 0; render(); });
$('clear').addEventListener('click', clear);
$('export').addEventListener('click', download);
$('prev').addEventListener('click', () => { page--; render(); });
$('next').addEventListener('click', () => { page++; render(); });

const value = input => input == null ? 'Unavailable' : String(input);
const metric = (input, unit) => input == null ? 'Unavailable' : `${signed.format(Math.round(input * 100) / 100)} ${unit}`;
const requestChanges = {added:'New', removed:'Missing', changed:'Changed', unchanged:'Unchanged'};
function renderRequests(){
  const query = $('request-query').value.trim().toLowerCase(), filter = $('request-filter').value;
  const matches = requestRows.filter(row => (filter === 'all' || filter === 'changes' && row.change !== 'unchanged' || filter === row.change) && (!query || [row.host,row.method,row.fingerprint].some(text=>text.toLowerCase().includes(query))));
  const pages = Math.max(1,Math.ceil(matches.length/pageSize));requestPage=Math.min(requestPage,pages-1);
  $('request-count').textContent=`${number.format(matches.length)} of ${number.format(requestRows.length)} paired, new or missing requests. Differences use only measured values; unavailable data is not zero.`;
  $('request-page').textContent=`Page ${requestPage+1} of ${pages}`;$('request-prev').disabled=requestPage===0;$('request-next').disabled=requestPage+1>=pages;
  const rows=matches.slice(requestPage*pageSize,(requestPage+1)*pageSize).map(row=>{
    const tr=element('tr'),identity=element('td');identity.append(element('strong',`${row.method} ${row.host}`),element('span',`${row.fingerprint.slice(0,12)} · occurrence ${row.occurrence}`,'meta'));
    const details=element('td'),button=element('button','Compare details');button.type='button';button.addEventListener('click',()=>inspectRequest(row));details.append(button);
    tr.append(identity,element('td',requestChanges[row.change],`request-${row.change}`),element('td',`${value(row.before?.status)} / ${value(row.after?.status)}`),element('td',metric(row.durationDelta,'ms')),element('td',metric(row.sizeDelta,'B')),details);return tr;
  });
  if(!rows.length){const tr=element('tr'),td=element('td','No requests match these filters.');td.colSpan=6;tr.append(td);rows.push(tr);}
  $('request-rows').replaceChildren(...rows);
}
function inspectRequest(row){
  $('detail-title').textContent=`${row.method} ${row.host}`;const content=$('detail-body');content.replaceChildren();
  content.append(element('p',`Fingerprint ${row.fingerprint.slice(0,12)} · occurrence ${row.occurrence}. ${requestChanges[row.change]}. Repeated matching endpoints are paired by their order in each capture.`));
  const dl=element('dl');
  for(const [key,label] of [['status','HTTP status'],['duration','Duration (ms)'],['size','Response bytes'],['requestSize','Request bytes'],['responseType','Response MIME type'],['payloadType','Request MIME type'],['resource','Resource type']])dl.append(element('dt',label),element('dd',`${value(row.before?.[key])} / ${value(row.after?.[key])}`));
  content.append(dl,element('h3','Timing phases: before / after'));
  const phases=element('dl'),before=new Map(row.before?.phases||[]),after=new Map(row.after?.phases||[]);
  for(const key of ['blocked','dns','connect','ssl','send','wait','receive'])phases.append(element('dt',key),element('dd',`${value(before.get(key))} / ${value(after.get(key))} ms`));
  content.append(phases,element('h3','Field-name changes'));
  const fields=element('dl'),labels={requestHeaders:'Request headers',responseHeaders:'Response headers',queryNames:'Query parameters',cookieNames:'Sent cookies',responseCookieNames:'Received cookies',payloadNames:'Form fields'};
  for(const [key,change]of Object.entries(row.fields))fields.append(element('dt',labels[key]),element('dd',`Added: ${change.added.join(', ')||'none'}. Removed: ${change.removed.join(', ')||'none'}.`));
  content.append(fields);$('detail').showModal();
}
$('mode').addEventListener('change',clear);
for(const id of ['request-query','request-filter'])$(id).addEventListener('input',()=>{requestPage=0;renderRequests();});
$('request-prev').addEventListener('click',()=>{requestPage--;renderRequests();});
$('request-next').addEventListener('click',()=>{requestPage++;renderRequests();});
