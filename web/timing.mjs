import { readHar } from './har.mjs';

// Resource Timing exposes the current document's measurements without a new request.
export function readPageLoad(timeline, origin) {
  const entries = [];
  for (const kind of ['navigation', 'resource']) {
    for (const entry of timeline.getEntriesByType(kind)) {
      let url;
      try { url = new URL(entry.name); } catch { continue; }
      if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol)) continue;
      if (!(entry.responseEnd > 0)) continue;
      const response = {};
      if (entry.responseStatus > 0) response.status = entry.responseStatus;
      if (entry.encodedBodySize > 0) response.bodySize = entry.encodedBodySize;
      response.content = {};
      if (entry.decodedBodySize > 0) response.content.size = entry.decodedBodySize;
      if (entry.contentType) response.content.mimeType = entry.contentType;
      entries.push({
        _resourceType: kind === 'navigation' ? 'document' : entry.initiatorType,
        request: { url: url.origin + url.pathname },
        response,
        startedDateTime: new Date(timeline.timeOrigin + entry.startTime).toISOString(),
        time: entry.responseEnd - entry.startTime,
      });
    }
  }
  if (!entries.length) throw Error('This browser exposed no completed measurements for this page. Choose an exported HAR instead.');
  const capture = readHar({log: {entries}});
  capture.source = 'Browser Resource Timing · completed same-origin requests';
  return capture;
}
