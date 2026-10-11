import type { UrlPolicy } from './model.js';
export function isUrlPolicy(policy: UrlPolicy | undefined): policy is UrlPolicy {
  if (!policy) return false;
  if ('pathname' in policy) return policy.hostname === 'kwork.ru' && policy.pathname === '/new_offer' && policy.projectParameter === 'project';
  return typeof policy.hostname === 'string' && policy.hostname.length <= 253 &&
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(policy.hostname) && typeof policy.pathPrefix === 'string' &&
    policy.pathPrefix.length <= 200 && /^\/(?:[A-Za-z0-9_-]+\/)+$/.test(policy.pathPrefix);
}
export function validateProjectUrl(input: string, policy: UrlPolicy):
  { projectId: string; url: string } | undefined {
  if (!isUrlPolicy(policy)) return undefined;
  if ('pathname' in policy) {
    // Reject literal ambiguities before WHATWG normalization (including explicit default ports).
    // eslint-disable-next-line no-control-regex -- Untrusted email URL controls must be rejected.
    if (input.length > 2_048 || /[\s\\%#\u0000-\u001f\u007f]/u.test(input)) return undefined;
    try {
      const url = new URL(input);
      if (url.protocol !== 'https:' || url.hostname !== policy.hostname || url.pathname !== policy.pathname ||
          url.username || url.password || url.port) return undefined;
      const ids = url.searchParams.getAll(policy.projectParameter);
      if (ids.length !== 1 || url.searchParams.size !== 1 || !/^[1-9]\d{0,79}$/.test(ids[0]!)) return undefined;
      if (input !== `https://${policy.hostname}${policy.pathname}?${policy.projectParameter}=${ids[0]}`) return undefined;
      return { projectId: ids[0]!, url: url.href };
    } catch { return undefined; }
  }
  // Validate literal authority/path before URL normalization can hide ports or dot segments.
  // eslint-disable-next-line no-control-regex -- Control-byte rejection is an intentional security check.
  if (input.length > 2_048 || !input.startsWith('https://') || /[\s\\%?#\u0000-\u001f\u007f]/u.test(input)) return undefined;
  const authority = input.slice(8).split('/')[0];
  if (authority !== policy.hostname) return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== policy.hostname || url.username || url.password || url.port) return undefined;
    if (!url.pathname.startsWith(policy.pathPrefix)) return undefined;
    const projectId = url.pathname.slice(policy.pathPrefix.length);
    if (!/^[1-9]\d{0,79}$/.test(projectId) || input !== `https://${authority}${url.pathname}`) return undefined;
    return { projectId, url: url.href };
  } catch { return undefined; }
}
