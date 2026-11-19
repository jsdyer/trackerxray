import { maxFileBytes } from './har.mjs';
import { compareCaptures } from './compare.mjs';

const $ = id => document.getElementById(`compare-${id}`);
const sides = ['before', 'after'];
const labels = { before: 'Before', after: 'After' };
const changes = { added: 'New domain', removed: 'Missing domain', count: 'Count changed', hosts: 'Hosts changed', unchanged: 'Unchanged' };
const number = new Intl.NumberFormat();
const signed = new Intl.NumberFormat(undefined, { signDisplay: 'exceptZero' });
const pageSize = 30;
const hostLimit = 60;
const captures = {};
let worker, report, page = 0;

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
  if (!report) return;
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
  if (file.size > maxFileBytes) return fail('This capture is larger than 128 MB. Export a shorter capture.');
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
    reader.postMessage({ file, compare: true });
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
