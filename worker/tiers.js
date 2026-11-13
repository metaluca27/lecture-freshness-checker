// 출처 등급. 사용자가 확인한 도메인만으로 정한다.
// 제목이나 저장소 이름에 official 이 들어가도 등급을 올리지 않는다.

function cleanDomain(domain) {
  return String(domain ?? '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
}

function hostMatches(hostname, domain) {
  if (!domain) return false;
  return hostname === domain || hostname.endsWith('.' + domain);
}

/**
 * @param {string} url
 * @param {{ tier1?: string[], tier2?: string[] }} domains
 * @returns {1 | 2 | 3}
 */
export function tierOf(url, domains) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 3;
  }
  if (parsed.protocol !== 'https:') return 3;

  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  const tier1 = (domains?.tier1 ?? []).map(cleanDomain);
  const tier2 = (domains?.tier2 ?? []).map(cleanDomain);

  if (tier1.some((d) => hostMatches(hostname, d))) return 1;
  if (tier2.some((d) => hostMatches(hostname, d))) return 2;
  return 3;
}
