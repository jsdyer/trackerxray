import { domainOf } from './har.mjs';

export function captureCounts(capture) {
  const domains = new Map();
  for (const { domain, host } of capture.rows) {
    if (!domains.has(domain)) domains.set(domain, { domain, count: 0, hosts: new Map() });
    const group = domains.get(domain);
    group.count++;
    group.hosts.set(host, (group.hosts.get(host) ?? 0) + 1);
  }
  return {
    requests: capture.rows.length,
    skipped: capture.skipped,
    site: capture.site ? domainOf(capture.site) : '',
    domains: Array.from(domains.values(), group => ({ ...group, hosts: [...group.hosts] })),
  };
}

function hostChanges(before, after) {
  const previous = new Map(before);
  const current = new Map(after);
  return [...new Set([...previous.keys(), ...current.keys()])].map(host => {
    const beforeCount = previous.get(host) ?? 0;
    const afterCount = current.get(host) ?? 0;
    return { host, before: beforeCount, after: afterCount, delta: afterCount - beforeCount };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.host.localeCompare(b.host));
}

export function compareCaptures(before, after) {
  const previous = new Map(before.domains.map(domain => [domain.domain, domain]));
  const current = new Map(after.domains.map(domain => [domain.domain, domain]));
  const domains = [...new Set([...previous.keys(), ...current.keys()])].map(domain => {
    const previousGroup = previous.get(domain);
    const currentGroup = current.get(domain);
    const beforeCount = previousGroup?.count ?? 0;
    const afterCount = currentGroup?.count ?? 0;
    const delta = afterCount - beforeCount;
    const hosts = hostChanges(previousGroup?.hosts ?? [], currentGroup?.hosts ?? []);
    let change = 'unchanged';
    if (!previousGroup) change = 'added';
    else if (!currentGroup) change = 'removed';
    else if (delta) change = 'count';
    else if (hosts.some(host => host.delta)) change = 'hosts';
    return { domain, before: beforeCount, after: afterCount, delta, change, hosts };
  });
  const order = { added: 0, removed: 1, count: 2, hosts: 3, unchanged: 4 };
  domains.sort((a, b) => order[a.change] - order[b.change] || Math.abs(b.delta) - Math.abs(a.delta) || a.domain.localeCompare(b.domain));
  return {
    format: 'trackerxray-capture-comparison-v1',
    before: { requests: before.requests, domains: before.domains.length, skipped: before.skipped, site: before.site },
    after: { requests: after.requests, domains: after.domains.length, skipped: after.skipped, site: after.site },
    delta: after.requests - before.requests,
    addedDomains: domains.filter(row => row.change === 'added').length,
    removedDomains: domains.filter(row => row.change === 'removed').length,
    domains,
  };
}
