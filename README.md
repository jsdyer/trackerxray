# Tracker X-Ray

[Open on CoolCode.ca](https://coolcode.ca/trackerxray/). Use a browser HAR (HTTP Archive) to review which hosts a page contacted, when requests started, which cookie and header names appear, and what payload metadata was captured. The file is parsed in a browser worker and is never uploaded. Try the synthetic capture to explore without a file.

## Use

1. In Chrome DevTools, open Network, reload the page, and choose **Export HAR (sanitized)**. A sanitized HAR may omit Cookie, Set-Cookie, and Authorization values and headers. [Chrome documentation](https://developer.chrome.com/docs/devtools/network/reference/#save-as-har)
2. Drop the capture on Tracker X-Ray. Check the inferred comparison site and adjust it if the HAR started on another page or follows multiple sites.
3. Click a host to review its requests. Open **Inspect** for recorded body size and type, form field names, query parameter names, header names, cookie names, and timing phases. Raw request/response bodies, URL paths, query values, credentials, and header/cookie values are omitted.
4. Export a host-level summary if needed. It includes host names; review before sharing.

The app groups by registrable domain using the Public Suffix List, including private suffixes. Different registrable domains can have the same owner. Known service names link to provider documentation for exact registrable-domain matches. Metrics-looking paths and parameter names can guide your review. A HAR describes captured network activity. It cannot establish what data a script read, whether clipboard data was collected, or what was happening outside the recorded session.

The built-in list has four services. [Google Analytics](https://developers.google.com/tag-platform/security/guides/csp#google_analytics) · [Google Tag Manager](https://developers.google.com/tag-platform/security/guides/csp) · [Microsoft Clarity](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-csp) · [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/)

## Build and test

```sh
python3 scripts/build.py
node --test tests/har.test.mjs
python3 -m http.server --directory dist 8000
```

Python 3 uses the npm registry to fetch the pinned, SHA-512-checked [tldts](https://github.com/remusao/tldts) distribution with its MIT licence. The bundled trie is based on the [Public Suffix List](https://publicsuffix.org/list/). No dependencies are fetched during browser use. The app does not redistribute Tracker Radar data or contact a captured domain. Static assets work under a Pages project subdirectory. Browser limits are 128 MB and 200,000 entries per file. Missing metadata is displayed as unavailable rather than treated as a measured zero.
