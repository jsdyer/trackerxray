import { readHar } from './har.mjs';
import { captureCounts } from './compare.mjs';
import { loadConfig } from './settings.mjs';
import { sanitizeHar, addFingerprints } from './advanced.mjs';

self.addEventListener('message', async ({ data }) => {
  try {
    const config = await loadConfig();
    const file = data.file;
    if (file.size > config.maxFileMegabytes * 1024 * 1024) throw new Error(`This capture exceeds the configured ${config.maxFileMegabytes} MB limit. Export a shorter capture.`);
    let parsed;
    try { parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
    catch { throw new Error('Could not parse this file as JSON. Export a .har file from the browser Network panel.'); }
    if(data.sanitize){self.postMessage({result:sanitizeHar(parsed,{...data.options,maxEntries:config.maxEntries})});return;}
    const capture = readHar(parsed, config);
    if(data.compare){await addFingerprints(capture,parsed,{mode:data.mode,salt:data.salt});self.postMessage({result:{...captureCounts(capture),rows:capture.rows}});}
    else self.postMessage({result:capture});
  } catch (error) { self.postMessage({ error: error.message || 'Could not read this capture.' }); }
});
