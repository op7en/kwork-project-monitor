import { expect, it } from 'vitest';
import { inlineStyleHidesContent } from '../src/kwork/inlineVisibility.js';

it.each([
  'margin:0; /* email comment */ padding:0',
  'font-family:"synthetic\\20 font"',
  'content:"display:none;visibility:hidden"',
  '--display:none; -example-visibility:hidden; display:block',
  'display:block; visibility:visible; mso-hide:none',
  'color:red; broken fragment', 'display:var(--unknown)', 'visibility:var(--unknown)',
  'display:none block', 'visibility:unknown', 'mso-hide:unknown', 'color:"unterminated',
])('does not confuse unrelated CSS with a hidden declaration: %s', style => {
  expect(inlineStyleHidesContent(style)).toBe(false);
});

it.each([
  'DISPLAY:none !important', 'display:/**/none', 'd\\69 splay:n\\6f ne',
  'visibility:\\68 idden', 'visibility:collapse', 'mso-hide:all',
  'display:none; display:block',
  'broken fragment; display:none',
])('excludes proven hidden declarations: %s', style => {
  expect(inlineStyleHidesContent(style)).toBe(true);
});

it('bounds oversized inline CSS without parsing it', () => {
  expect(inlineStyleHidesContent(' '.repeat(16_385))).toBe(false);
});
