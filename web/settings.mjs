export function validateConfig(value) {
  const out = {};
  for (const [key, min, max] of [['pageSize',10,200],['comparisonPageSize',10,100],['waterfallRows',10,300],['maxEntries',1,200000],['maxFileMegabytes',1,128]]) {
    if (!Number.isInteger(value?.[key]) || value[key] < min || value[key] > max) throw new Error(`Invalid configuration: ${key}.`);
    out[key] = value[key];
  }
  if (!['endpoint','exact'].includes(value.defaultMatchMode)) throw new Error('Invalid default matching mode.');
  out.defaultMatchMode = value.defaultMatchMode;
  out.documentedServices = Object.create(null);
  for (const [domain, service] of Object.entries(value.documentedServices || {})) {
    if (!/^[a-z0-9.-]+$/.test(domain) || !service?.name || typeof service.name !== 'string' || service.name.length > 100 || typeof service.source !== 'string' || !service.source.startsWith('https://')) throw new Error('Invalid documented service configuration.');
    const source = new URL(service.source);
    if (source.username || source.password) throw new Error('Service source cannot contain credentials.');
    out.documentedServices[domain] = {name:service.name,source:source.href};
  }
  return out;
}
export async function loadConfig() {
  const response = await fetch('./config.json');
  if (!response.ok) throw new Error('Configuration could not be loaded. Reload the page.');
  return validateConfig(await response.json());
}
