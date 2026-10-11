import { expect, it } from 'vitest';
import { validateProjectUrl } from '../src/kwork/url.js';
// synthetic-v1: neither this hostname nor pathname is a production Kwork policy.
const policy = { hostname: 'kwork.example', pathPrefix: '/synthetic-project/' };
it('preserves direct validated URL and decimal string identity without numeric precision loss', () => {
  expect(validateProjectUrl('https://kwork.example/synthetic-project/12345678901234567890', policy))
    .toEqual({ projectId: '12345678901234567890', url: 'https://kwork.example/synthetic-project/12345678901234567890' });
});
it.each([
  'https://kwork.example.evil.com/synthetic-project/1',
  'https://evil-kwork.example/synthetic-project/1',
  'https://kwork.example@evil.com/synthetic-project/1',
  'https://evil.com@kwork.example/synthetic-project/1',
  'javascript:https://kwork.example/synthetic-project/1', 'data:text/plain,hello',
  'http://kwork.example/synthetic-project/1', '//kwork.example/synthetic-project/1',
  '/synthetic-project/1', 'https://kwork.example:8443/synthetic-project/1',
  'https://kwork.example:443/synthetic-project/1',
  'https://kwork.example/synthetic-project/%31', 'https://kwork.example/a/../synthetic-project/1',
  'https://kwork.example/synthetic-project/0', 'https://kwork.example/synthetic-project/01',
  'https://kwork.example/synthetic-project/1e3', 'https://kwork.example/synthetic-project/1evil',
  'https://kwork.example/redirect?url=https://evil.com',
  'https://kwork.example/synthetic-project/1?redirect=https://evil.com',
  'https://kwork.example/synthetic-project/1#fragment',
  'https://kwork.example/synthetic-project/1\n', 'https://kwork.example\\synthetic-project\\1',
  'https://kwоrk.example/synthetic-project/1', 'https://kwork.example./synthetic-project/1',
])('rejects unsafe or unconfirmed direct-link form: %s', (url) => {
  expect(validateProjectUrl(url, policy)).toBeUndefined();
});
