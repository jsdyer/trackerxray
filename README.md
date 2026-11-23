# Tracker X-Ray

[Open on CoolCode.ca](https://coolcode.ca/trackerxray/). Use a browser HAR (HTTP Archive) to review which hosts a page contacted, when requests started, which cookie and header names appear, and what payload metadata was captured. The file is parsed in a browser worker and is never uploaded. Choose **Inspect this page’s load** to inspect completed same-origin browser timing entries from the open tab, including its navigation, scripts and styles. It reads the browser’s existing measurements. No URLs are replayed. Timings end at response completion and sizes use the encoded HTTP body when available. The browser timing API does not expose request methods, cookies, headers or request bodies. The source is identified in JSON exports.

## Use

1. In Chrome DevTools, open Network, reload the page, and choose **Export HAR (sanitized)**. A sanitized HAR may omit Cookie, Set-Cookie, and Authorization values and headers. [Chrome documentation](https://developer.chrome.com/docs/devtools/network/reference/#save-as-har)
2. Drop the capture on Tracker X-Ray. Check the inferred comparison site and adjust it if the HAR started on another page or follows multiple sites.
3. Click a host to review its requests. Open **Inspect** for recorded body size and type, form field names, query parameter names, header names, cookie names, and timing phases. Raw request/response bodies, URL paths, query values, credentials, and header/cookie values are omitted.
4. Narrow requests by review signals, request body, cookie metadata, documented service, or HTTP error. Search also covers field and cookie names.
5. Export a host-level summary or the matching requests as JSON. The request export includes hostnames and field names; review these before sharing.

Open **Compare two HAR captures** and load Before and After files. The original domain-count table remains. The **Individual requests** table adds new/missing requests and matched status, duration, size, timing phase, header-name, cookie-name and form-field differences. Choose either **Method + endpoint + query names** (query values ignored) or **Method + exact URL**. The worker hashes the selected URL identity with a fresh random salt shared by this pair; raw paths and values never enter the ordinary report. Repeated matches are paired by occurrence order, so this is a reproducible alignment rule rather than proof of the same transaction. Different sessions get different fingerprints. Changing the matching mode clears both files. Query/body/header value changes are not inspected or reported; exact URL mode will classify changed query values as a missing/new pair.

For cookie-consent research, capture the same starting page for similar durations. Caching, page activity and endpoint order can change measurements. A missing value produces **Unavailable**, not a measured zero. Request counts are not a finding that a service tracked someone.

## Waterfall

The waterfall follows the current request filters, orders measured requests by start time and labels each request's start/duration. Click its host label for the existing metadata inspector. It displays blocked, DNS, Connect, Send, Wait and Receive phases when recorded. **TLS is included within Connect**, so it is shown in the inspector but not added again in the bar. Grey portions have no reported phase; an asterisk flags a phase sum that disagrees with the recorded total. Unknown timing is excluded from the plotted span and reported separately. Peak overlap describes measured request activity, not TCP connections. A row limit keeps large captures usable; all matching rows remain available in the normal table and export.

## Make a sanitized copy

Expand **Make a sanitized HAR copy**, choose a HAR and select **Build sanitized copy**. This creates a new file from an allowlist of HAR fields; it does not modify your original. Review the redaction report, then choose **Download sanitized HAR**. Option changes invalidate the prepared download.

Default behaviour:

- Replace **every header, cookie, URL-query and form value**, including unfamiliar headers, with `[REDACTED]`.
- Remove request/response body text, encodings, upload filenames, comments, page metadata, browser metadata, server IPs, connection IDs and all unrecognized/vendor fields, including WebSocket messages and initiator stacks.
- Remove URL credentials and fragments. Replace non-root paths with `/_redacted_`; retain hostnames, ports and valid field names.
- Shift valid timestamps together so the first valid exported request starts on **1 January 2000**. Relative intervals remain. Missing input dates and measurements are not invented.
- Retain recorded size/timing measurements, method, status, resource/MIME type, and valid header/cookie/query/form names. Sizes describe the original recorded traffic, not the smaller sanitized JSON.

**Keep original URL paths** and **Keep original request dates** are explicit opt-ins. Paths can contain account numbers, tokens or personal information. Even the default copy is **not anonymous**: hosts, field names, types, sizes and patterns can identify people or services. Inspect the copy before sharing. This is a reduced HAR for investigation, not a byte-faithful replay archive. Browser importers differ; Tracker X-Ray can reopen its exported captures. No requests are replayed.

The app groups by registrable domain using the Public Suffix List, including private suffixes. Different registrable domains can have the same owner. Known service names link to provider documentation for exact registrable-domain matches. Metrics-looking paths and parameter names can guide your review. A HAR describes captured network activity. It cannot establish what data a script read, whether clipboard data was collected, or what was happening outside the recorded session.

The default documented-service list is editable in `web/config.json`. It currently includes four services. [Google Analytics](https://developers.google.com/tag-platform/security/guides/csp#google_analytics) · [Google Tag Manager](https://developers.google.com/tag-platform/security/guides/csp) · [Microsoft Clarity](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-csp) · [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/)

## Build and test

```sh
python3 scripts/build.py
node --test tests/*.test.mjs
python3 -m http.server --directory dist 8000
```

Python 3 uses the npm registry to fetch the pinned, SHA-512-checked [tldts](https://github.com/remusao/tldts) distribution with its MIT licence. The bundled trie is based on the [Public Suffix List](https://publicsuffix.org/list/). No dependencies are fetched during browser use. The app does not redistribute Tracker Radar data or contact a captured domain. Static assets work under a Pages project subdirectory. The default browser limits are 128 MB and 200,000 entries per file; config may lower them. Sanitization and matching also run in workers. Missing metadata is displayed as unavailable rather than treated as a measured zero.


## Expand or customize

Edit `web/config.json` and push to `main`; **Build and publish to GitHub Pages** rebuilds, tests and publishes. There is no scheduled fetch or server-side HAR collection. `pageSize`, `comparisonPageSize` and `waterfallRows` control visible rows. `maxEntries` and `maxFileMegabytes` are bounded safeguards (maximum 200,000 and 128 respectively). `defaultMatchMode` accepts `endpoint` or `exact`. The default shortcuts never restrict which valid HAR or hostname you can inspect.

To add another documented provider, add its exact registrable domain with a provider-owned HTTPS reference under `documentedServices`, for example:

```json
"example.ca": {
  "name": "My documented service",
  "source": "https://example.ca/privacy/network-collection"
}
```

A domain match only labels the documented service; it is not a tracker verdict. Tests add an extra service and verify that lookups do not rely on the starter count. The Public Suffix List parser is pinned separately in `scripts/build.py`; update its version and integrity together when deliberately upgrading.

The CI browser test records real local Chrome HAR files, exercises comparison and the waterfall, and verifies a sensitive test fixture's sanitized download. It does not send the fixture to a server. Model tests cover nested vendor fields, body/header/cookie/query redaction, duplicate matching, absent measurements and TLS accounting.

<!-- coolcode:guide -->
Inspect this page’s load, or import your own HAR to see its request waterfall and metadata. Compare two captures by endpoint or exact URL, then inspect individual changes. Make a sanitized copy to remove values, bodies and vendor fields; review what remains before sharing it. All capture processing stays in your browser.
<!-- /coolcode:guide -->
