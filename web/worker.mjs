import { readHar, maxFileBytes } from './har.mjs';

self.addEventListener('message', async ({ data }) => {
  try {
    const file = data.file;
    if (file.size > maxFileBytes) throw new Error('This capture is larger than 128 MB. Export a shorter capture.');
    let parsed;
    try { parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
    catch { throw new Error('Could not parse this file as JSON. Export a .har file from the browser Network panel.'); }
    self.postMessage({ result: readHar(parsed) });
  } catch (error) { self.postMessage({ error: error.message || 'Could not read this capture.' }); }
});
