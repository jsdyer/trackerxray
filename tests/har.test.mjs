import test from 'node:test';
import assert from 'node:assert/strict';
import { domainOf, parseSite, readHar, summarize } from '../dist/har.mjs';
import { captureCounts, compareCaptures } from '../dist/compare.mjs';

test('group by registrable domain with private suffixes', () => {
  assert.equal(domainOf('shop.example.co.uk'), 'example.co.uk');
  assert.equal(domainOf('another.github.io'), 'another.github.io');
  assert.equal(parseSite('https://Shop.Example.ca/path'), 'shop.example.ca');
  assert.equal(parseSite('https://name:secret@example.ca'), '');
});

test('omit raw values, retain timing and metadata, skip unsupported URLs', () => {
  const archive = { log: { entries: [
    { startedDateTime: '2025-01-01T00:00:00.000Z', _resourceType: 'document',
      time: 20, request: { method: 'GET', url: 'https://example.ca/case-secret?utm_source=private-query' },
      response: { status: 0, bodySize: -1 } },
    { startedDateTime: '2025-01-01T00:00:01.500Z', _resourceType: 'xhr', time: 900,
      request: { method: 'POST', url: 'https://events.example.org/telemetry',
        postData: { mimeType: 'application/json', text: 'private-payload', params: [{ name: 'eventId', value: 'private-event' }] },
        headers: [{ name: 'Authorization', value: 'private-token' }], cookies: [{ name: 'sid', value: 'private-id' }] },
      response: { status: 200, content: { size: 42, mimeType: 'application/json', text: 'private-response' } } },
    { request: { url: 'file:///private-file' } },
  ] } };
  const parsed = readHar(archive);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.site, 'example.ca');
  assert.equal(parsed.rows[0].status, 0);
  assert.equal(parsed.rows[0].size, null);
  assert.deepEqual(parsed.rows[1].payloadNames, ['eventId']);
  assert.equal(parsed.rows[1].start, 1500);
  assert.equal(parsed.rows[1].size, 42);
  assert.doesNotMatch(JSON.stringify(parsed), /private-|case-secret/);
  const summary = summarize(parsed.rows, 'example.ca');
  assert.equal(summary.externalSites, 1);
  assert.equal(summary.responseBytes, 42);
});

test('reject JSON that is not an HTTP archive', () => assert.throws(() => readHar({ log: {} }), /log.entries/));

test('recognizes documented provider domains without matching lookalikes', () => {
  const urls = ['https://region1.google-analytics.com/g/collect', 'https://google-analytics.com.example.org/', 'https://c.clarity.ms/c.gif'];
  const output = readHar({ log: { entries: urls.map((url) => ({ request: { url } })) } });
  assert.deepEqual(output.rows.map((row) => row.service?.name), ['Google Analytics', undefined, 'Microsoft Clarity']);
});

test('compares valid requests by registrable domain and preserves changes within a domain', () => {
  const capture = urls => captureCounts(readHar({ log: { entries: urls.map(url => ({ request: { url } })) } }));
  const before = capture(['https://page.example.ca/private-path?x=private-value', 'https://old.example.net', 'https://keep.example.org', 'https://gone.github.io']);
  const after = capture(['https://page.example.ca', 'https://new.example.net', 'https://keep.example.org', 'https://keep.example.org', 'https://fresh.github.io', 'file:///private-file']);
  const report = compareCaptures(before, after);
  assert.equal(report.delta, 1);
  assert.equal(report.before.site, 'example.ca');
  assert.equal(report.after.skipped, 1);
  assert.equal(report.addedDomains, 1);
  assert.equal(report.removedDomains, 1);
  assert.deepEqual(report.domains.map(({ domain, change, delta }) => [domain, change, delta]), [
    ['fresh.github.io', 'added', 1], ['gone.github.io', 'removed', -1], ['example.org', 'count', 1],
    ['example.net', 'hosts', 0], ['example.ca', 'unchanged', 0],
  ]);
  assert.deepEqual(report.domains[3].hosts.map(({ host, delta }) => [host, delta]), [['new.example.net', 1], ['old.example.net', -1]]);
  assert.doesNotMatch(JSON.stringify(report), /private-|https:/);
});
