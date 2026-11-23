import { getDomain } from './vendor/tldts.mjs';

const SIZE = 128 * 1024 * 1024;
const NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/;
const TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;
const signalPath = /(?:^|\/)(?:telemetry|collect|analytics|beacon|pixel|track|tracking|metrics)(?:[.\/-]|$)/i;
const signalQuery = /^(?:utm_\w+|gclid|fbclid|msclkid|dclid|_ga)$/i;

const documentedServices = {
  'google-analytics.com': { name: 'Google Analytics', source: 'https://developers.google.com/tag-platform/security/guides/csp#google_analytics' },
  'googletagmanager.com': { name: 'Google Tag Manager', source: 'https://developers.google.com/tag-platform/security/guides/csp' },
  'clarity.ms': { name: 'Microsoft Clarity', source: 'https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-csp' },
  'cloudflareinsights.com': { name: 'Cloudflare Web Analytics', source: 'https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/' },
};

export const maxFileBytes = SIZE;
const finite = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const mime = x => {
  const part = typeof x === 'string' ? x.split(';', 1)[0].trim() : '';
  return TYPE.test(part) ? part : '';
};

function webURL(input) {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    return /^[httpsw]+:$/.test(url.protocol) && ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}

export function parseSite(input) {
  const value = input.trim();
  if (!value) return '';
  const source = /^[a-z]+:\/\//i.test(value) ? value : 'https://' + value;
  const url = webURL(source);
  if (!url || url.username || url.password || /\s/.test(value)) return '';
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

export function domainOf(host) {
  return getDomain(host, { allowPrivateDomains: true }) || host;
}

function names(list) {
  return Array.isArray(list) ? [...new Set(list.map(x => x?.name).filter(x => typeof x === 'string' && NAME.test(x)))].sort() : [];
}

export function readHar(value, options = {}) {
  const entries = value?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('This JSON has no HAR log.entries array.');
  if (entries.length > (options.maxEntries || 200000)) throw new Error('This capture exceeds the configured entry limit. Export a shorter capture.');
  let earliest = Infinity;
  let skipped = 0;
  let site = '';
  let fallback = '';
  const rows = [];
  for (const [entryIndex, entry] of entries.entries()) {
    const request = entry?.request;
    const url = webURL(request?.url);
    if (!url) { skipped++; continue; }
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const domain = domainOf(host);
    const services = options.documentedServices || documentedServices;
    const service = Object.hasOwn(services, domain) ? services[domain] : null;
    const response = entry.response || {};
    const post = request.postData;
    const requestHeaders = names(request.headers);
    const responseHeaders = names(response.headers);
    const cookieNames = names(request.cookies);
    const responseCookieNames = names(response.cookies);
    const queryNames = names(Array.from(url.searchParams.keys(), name => ({ name })));
    const payloadNames = names(post?.params);
    const started = typeof entry.startedDateTime === 'string' ? Date.parse(entry.startedDateTime) : NaN;
    if (Number.isFinite(started)) earliest = Math.min(earliest, started);
    const resource = typeof entry._resourceType === 'string' && /^[a-z]+$/i.test(entry._resourceType) ? entry._resourceType : '';
    fallback ||= host;
    if (resource.toLowerCase() === 'document') site ||= host;
    const bodySource = finite(response.bodySize) ? 'HTTP body bytes' : 'Content size in capture';
    const size = finite(response.bodySize) ? response.bodySize : (finite(response.content?.size) ? response.content.size : null);
    const rawReason = [signalPath.test(url.pathname) && 'Telemetry-like URL path',
      queryNames.some(name => signalQuery.test(name)) && 'Attribution-style parameter name',
      (cookieNames.length || responseCookieNames.length
        || [...requestHeaders, ...responseHeaders].some(x => /^(?:set-)?cookie$/i.test(x))) && 'Cookie metadata present'].filter(Boolean);
    rows.push({
      entryIndex, host, domain, service,
      method: typeof request.method === 'string' && /^[A-Z!#$%&'*+.^_`|~-]{1,25}$/i.test(request.method) ? request.method.toUpperCase() : 'Unknown',
      resource,
      status: Number.isInteger(response.status) && response.status >= 0 && response.status < 600 ? response.status : null,
      start: Number.isFinite(started) ? started : null,
      duration: finite(entry.time) ? entry.time : null,
      size, bodySource,
      requestHeaders, responseHeaders, queryNames, cookieNames, responseCookieNames, payloadNames,
      payloadType: mime(post?.mimeType), requestSize: finite(request.bodySize) ? request.bodySize : null,
      responseType: mime(response.content?.mimeType),
      hasPayload: Boolean(post) || (finite(request.bodySize) && request.bodySize > 0),
      phases: ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'].filter(key => finite(entry.timings?.[key]))
        .map(key => [key, entry.timings[key]]),
      observations: rawReason,
    });
  }
  for (const row of rows) if (row.start != null) row.start -= earliest;
  return { rows, skipped, site: site || fallback, siteBasis: site ? 'first document' : 'first valid request' };
}

export function summarize(rows, siteHost) {
  const site = domainOf(siteHost);
  const hosts = new Map();
  for (const row of rows) {
    if (!hosts.has(row.host)) hosts.set(row.host, { host: row.host, domain: row.domain, service: row.service?.name || null, same: row.domain === site, count: 0, signals: 0 });
    const host = hosts.get(row.host);
    host.count++;
    if (row.observations.length) host.signals++;
  }
  const byHost = [...hosts.values()].sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
  return {
    rows: rows.length,
    external: byHost.filter(x => !x.same).reduce((n, x) => n + x.count, 0),
    externalSites: new Set(byHost.filter(x => !x.same).map(x => x.domain)).size,
    responseBytes: rows.reduce((n, row) => n + (row.size ?? 0), 0),
    measuredBytes: rows.filter(row => row.size != null).length,
    hosts: byHost,
  };
}
