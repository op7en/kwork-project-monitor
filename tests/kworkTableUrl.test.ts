import {expect,it} from 'vitest';
import {validateProjectUrl} from '../src/kwork/url.js';
import {TABLE_POLICY} from './fixtures/kwork-table-v1.js';
it('accepts the confirmed direct query URL with a dynamic string ID',()=>{
  expect(validateProjectUrl('https://kwork.ru/new_offer?project=9000001',TABLE_POLICY.urls))
    .toEqual({projectId:'9000001',url:'https://kwork.ru/new_offer?project=9000001'});
  expect(validateProjectUrl('https://kwork.ru/new_offer?project=98765432109876543210',TABLE_POLICY.urls)?.projectId).toBe('98765432109876543210');
});
it.each([
  'http://kwork.ru/new_offer?project=1','https://www.kwork.ru/new_offer?project=1','https://kwork.ru.evil.com/new_offer?project=1',
  'https://evil-kwork.ru/new_offer?project=1','https://kwork.ru@evil.com/new_offer?project=1',
  'https://user@kwork.ru/new_offer?project=1','https://kwork.ru:443/new_offer?project=1','https://kwork.ru:8443/new_offer?project=1',
  'https://kwork.ru/new_offer','https://kwork.ru/new_offer?project=','https://kwork.ru/new_offer?project=0',
  'https://kwork.ru/new_offer?project=-1','https://kwork.ru/new_offer?project=01','https://kwork.ru/new_offer?project=1.2',
  'https://kwork.ru/new_offer?project=1&project=1','https://kwork.ru/new_offer?project=1&project=2',
  'https://kwork.ru/new_offer?%70roject=1','https://kwork.ru/new_offer?project=%31',
  'https://kwork.ru/new_offer?project=1&url=https://evil.test','https://kwork.ru/new_offer?project=1&utm_source=test',
  'https://kwork.ru/new_offer?project=1#x','https://kwork.ru/new_offer/?project=1',
  'https://kwork.ru/x/../new_offer?project=1','https://kwork.ru/%6eew_offer?project=1',
  'javascript:alert(1)','data:text/html,foo','//kwork.ru/new_offer?project=1',
])('rejects unconfirmed or ambiguous project URL %s',input=>{
  expect(validateProjectUrl(input,TABLE_POLICY.urls)).toBeUndefined();
});
