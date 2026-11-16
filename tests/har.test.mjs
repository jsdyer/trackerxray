import test from 'node:test';
import assert from 'node:assert/strict';
import { domainOf, parseSite, readHar, summarize } from '../dist/har.mjs';

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
