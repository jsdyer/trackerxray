import { readPageLoad } from './timing.mjs';
import { domainOf, maxFileBytes, parseSite, summarize } from './har.mjs';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat();
const pageSize = 40;
const el = (tag, content, className) => {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
};
const ms = value => value == null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
function bytes(value) {
  if (value == null) return '—';
  if (value < 1024) return `${number.format(value)} B`;
  const power = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** power).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB'][power]}`;
}
const rowButton = (name, action) => {
  const button = el('button', name);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
};

let data, site, selectedHost = '', page = 0, worker, sourceVersion = 0;
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function clearCapture() {
  sourceVersion++;
  worker?.terminate();
  worker = null;
  data = null;
  $('report').hidden = true;
  $('clear').hidden = true;
  $('open').value = '';
  $('requests').replaceChildren();
  $('hosts').replaceChildren();
  $('detail-fields').replaceChildren();
  if ($('detail').open) $('detail').close();
  status('Open a HAR or inspect the resources this page has already loaded.');
}

function openResult(result, label) {
  data = result;
  site = result.site;
  $('site').value = site;
  $('capture-title').textContent = label;
  $('report').hidden = false;
  $('clear').hidden = false;
  status(`${number.format(result.rows.length)} HTTP or WebSocket requests parsed.${result.skipped ? ` ${number.format(result.skipped)} unsupported or invalid entries skipped.` : ''} Comparison site inferred from the ${result.siteBasis}; change it below if needed.`);
  $('query').value = '';
  $('scope').value = '';
  $('sort').value = 'recorded';
  $('characteristic').value = '';
  selectedHost = '';
  page = 0;
  renderOverview();
  renderRows();
}

function openFile(file) {
  if (!file) return;
  clearCapture();
  if (file.size > maxFileBytes) { status('This capture is larger than 128 MB. Export a shorter capture.', true); return; }
  const current = sourceVersion;
  $('clear').hidden = false;
  status('Reading the capture locally…');
  worker = new Worker('./worker.mjs', { type: 'module' });
  const run = worker;
  run.addEventListener('message', ({ data: reply }) => {
    if (current !== sourceVersion) return;
    run.terminate();
    worker = null;
    if (reply.error) return status(reply.error, true);
    if (!reply.result.rows.length) return status('No valid HTTP or WebSocket requests were present in this capture.', true);
    openResult(reply.result, file.name);
  });
  run.addEventListener('error', () => {
    if (current !== sourceVersion) return;
    run.terminate();
    worker = null;
    status('The capture reader stopped. Try a smaller or newly exported HAR.', true);
  });
  run.postMessage({ file });
}

function renderOverview() {
  const stats = summarize(data.rows, site);
  const chips = [
    [number.format(stats.rows), 'Valid requests'],
    [number.format(stats.hosts.length), 'Contacted hosts'],
    [number.format(stats.externalSites), 'Other registrable domains'],
    [stats.measuredBytes ? bytes(stats.responseBytes) : 'Unavailable', 'Recorded response bytes'],
  ];
  $('stats').replaceChildren(...chips.map(([n, label]) => {
    const block = el('div', null, 'stat');
    block.append(el('strong', n), el('span', label));
    return block;
  }));
  const limit = stats.hosts.length > 12 ? 12 : stats.hosts.length;
  $('hosts').replaceChildren(...stats.hosts.slice(0, limit).map(host => {
    const button = rowButton('', () => {
      selectedHost = selectedHost === host.host ? '' : host.host;
      $('scope').value = '';
      $('query').value = '';
      page = 0;
      renderOverview();
      renderRows();
      $('result-count').scrollIntoView({ block: 'nearest' });
    });
    button.setAttribute('aria-pressed', String(selectedHost === host.host));
    const row = el('div', null, 'barrow');
    const identity = [host.host, host.same ? 'same site' : 'other site', host.service].filter(Boolean).join(' · ');
    row.append(el('span', identity), el('span', number.format(host.count), 'meta'));
    const bar = el('meter');
    bar.max = stats.hosts[0].count;
    bar.value = host.count;
    bar.setAttribute('aria-label', 'Request count relative to the largest host');
    button.append(row, bar);
    return button;
  }));
  if (stats.hosts.length > limit) $('hosts').append(el('p', `Showing ${limit} of ${number.format(stats.hosts.length)} hosts. Search any host in the requests table.`, 'chart-caption'));
}

function matchedRows() {
  const query = $('query').value.trim().toLowerCase();
  const scope = $('scope').value;
  const characteristic = $('characteristic').value;
  const chosen = domainOf(site);
  const rows = data.rows.filter(row => {
    if (selectedHost && row.host !== selectedHost) return false;
    if (scope && (scope === 'same') !== (row.domain === chosen)) return false;
    if (characteristic === 'signal' && !row.observations.length) return false;
    if (characteristic === 'body' && !row.hasPayload) return false;
    if (characteristic === 'cookies' && !row.cookieNames.length && !row.responseCookieNames.length && !row.requestHeaders.some(name => /^cookie$/i.test(name)) && !row.responseHeaders.some(name => /^set-cookie$/i.test(name))) return false;
    if (characteristic === 'service' && !row.service) return false;
    if (characteristic === 'error' && !(row.status == null || row.status === 0 || row.status >= 400)) return false;
    return !query || [row.host, row.service?.name || '', row.method, row.resource, ...row.requestHeaders, ...row.responseHeaders, ...row.queryNames, ...row.cookieNames, ...row.responseCookieNames, ...row.payloadNames, ...row.observations]
      .some(value => value.toLowerCase().includes(query));
  });
  if ($('sort').value === 'slow') rows.sort((a, b) => (b.duration ?? -1) - (a.duration ?? -1));
  if ($('sort').value === 'size') rows.sort((a, b) => (b.size ?? -1) - (a.size ?? -1));
  return rows;
}

function renderRows() {
  const rows = matchedRows();
  const chosen = domainOf(site);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Math.min(page, pages - 1);
  $('result-count').textContent = `${number.format(rows.length)} matched`;
  $('page').textContent = `Page ${number.format(page + 1)} of ${number.format(pages)}`;
  $('prev').disabled = page === 0;
  $('next').disabled = page + 1 >= pages;
  $('host-selection').hidden = !selectedHost;
  $('host-selection').textContent = selectedHost ? `Host filter: ${selectedHost}` : '';
  $('requests').replaceChildren(...rows.slice(page * pageSize, (page + 1) * pageSize).map(row => {
    const tr = el('tr');
    const identity = el('td');
    identity.append(el('strong', row.host), el('span', row.domain === chosen ? 'Same site' : 'Other site', 'meta muted'));
    const request = el('td');
    request.append(el('strong', row.method), el('span', row.resource || 'Resource type unavailable', 'meta muted'));
    const details = el('td');
    const button = rowButton('Inspect', () => inspect(row));
    button.setAttribute('aria-label', `Inspect ${row.method} request to ${row.host}`);
    details.append(button);
    tr.append(identity, request, el('td', row.status == null ? '—' : row.status === 0 ? 'No status' : row.status),
      el('td', `${ms(row.start)} / ${ms(row.duration)}`, 'right'), el('td', bytes(row.size), 'right'), details);
    return tr;
  }));
  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', 'No requests match these filters.', 'muted');
    td.colSpan = 6;
    tr.append(td); $('requests').append(tr);
  }
}

const showNames = values => values.length ? values.join(', ') : data.source ? 'Unavailable in this measurement' : 'None listed';
function inspect(row) {
  $('detail-title').textContent = row.host;
  const service = row.service ? el('a', row.service.name) : 'No match in the built-in list';
  if (row.service) {
    service.href = row.service.source;
    service.target = '_blank';
    service.rel = 'noopener noreferrer';
  }
  const cases = [
    ['Documented service', service],
    ['Request', [row.method, row.resource].filter(Boolean).join(' · ')],
    ['Site relationship', row.domain === domainOf(site) ? 'Same registrable domain' : 'Different registrable domain'],
    ['HTTP status', row.status == null ? 'Unavailable' : row.status === 0 ? 'No HTTP status recorded' : row.status],
    ['Response type', row.responseType || 'Unavailable'],
    ['Response bytes', row.size == null ? 'Unavailable' : `${bytes(row.size)} · ${row.bodySource}`],
    ['Request body', data.source ? 'Not exposed by browser timing' : row.hasPayload ? `${row.payloadType || 'Type unavailable'} · ${bytes(row.requestSize)}` : 'None listed'],
    ['Body field names', showNames(row.payloadNames)],
    ['Query parameter names', showNames(row.queryNames)],
    ['Request header names', showNames(row.requestHeaders)],
    ['Response header names', showNames(row.responseHeaders)],
    ['Cookie names sent', showNames(row.cookieNames)],
    ['Cookie names received', showNames(row.responseCookieNames)],
    ['Timing phases', row.phases.length ? row.phases.map(([key, value]) => `${key} ${ms(value)}`).join(' · ') : 'None listed'],
    ['Review signals', row.observations.length ? row.observations.join(' · ') : 'None detected'],
  ];
  $('detail-fields').replaceChildren(...cases.flatMap(([label, value]) => {
    const description = el('dd');
    description.append(value);
    return [el('dt', label), description];
  }));
  $('detail').showModal();
}

function applySite() {
  const parsed = parseSite($('site').value);
  if (!parsed) { status('Enter a site hostname or a full HTTP(S) URL.', true); return; }
  site = parsed;
  $('site').value = site;
  status(`Comparison site set to ${site} (registrable domain: ${domainOf(site)}).`);
  page = 0;
  renderOverview();
  renderRows();
}
function download() {
  const content = { format: 'trackerxray-host-summary-v1', source: data.source ?? 'Imported HAR', comparisonSite: site, ...summarize(data.rows, site) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
  const link = el('a');
  link.href = url; link.download = 'trackerxray-summary.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadRequests() {
  const content = {
    format: 'trackerxray-request-metadata-v1', source: data.source ?? 'Imported HAR',
    comparisonSite: site,
    requests: matchedRows(),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
  const link = el('a');
  link.href = url; link.download = 'trackerxray-requests.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function inspectPage() {
  clearCapture();
  try {
    const capture = readPageLoad(performance, location.origin);
    openResult(capture, 'This page’s measured load');
    status(`${capture.rows.length} completed same-origin requests in this tab, including cached resources when recorded. Times run from request start through response end. Browser timing omits request methods, headers, cookies and body fields.`);
  } catch (error) {
    status(error.message, true);
  }
}

$('choose').addEventListener('click', () => $('open').click());
$('open').addEventListener('change', event => openFile(event.target.files[0]));
$('measure').addEventListener('click', inspectPage);
$('clear').addEventListener('click', clearCapture);
$('export').addEventListener('click', download);
$('export-requests').addEventListener('click', downloadRequests);
$('apply-site').addEventListener('click', applySite);
$('site').addEventListener('keydown', event => { if (event.key === 'Enter') applySite(); });
for (const id of ['query', 'scope', 'sort', 'characteristic']) $(id).addEventListener('input', () => { page = 0; renderRows(); });
$('reset-filter').addEventListener('click', () => {
  $('query').value = ''; $('sort').value = 'recorded'; $('scope').value = ''; $('characteristic').value = '';
  selectedHost = ''; page = 0;
  renderOverview(); renderRows();
});
$('prev').addEventListener('click', () => { page--; renderRows(); });
$('next').addEventListener('click', () => { page++; renderRows(); });
const drop = $('drop');
drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('active'); });
drop.addEventListener('dragleave', () => drop.classList.remove('active'));
drop.addEventListener('drop', event => {
  event.preventDefault(); drop.classList.remove('active'); openFile(event.dataTransfer.files[0]);
});
