import { expect, it } from 'vitest';
import { inlineStyleHidesContent } from '../src/kwork/inlineVisibility.js';

it.each([
  'margin:0; /* email comment */ padding:0',
  'font-family:"synthetic\\20 font"',
  'content:"display:none;visibility:hidden"',
  '--display:none; -example-visibility:hidden; display:block',
  'display:block; visibility:visible; mso-hide:none',
])('does not confuse unrelated CSS with a hidden declaration: %s', style => {
  expect(inlineStyleHidesContent(style)).toBe(false);
});

it.each([
  'DISPLAY:none !important', 'display:/**/none', 'd\\69 splay:n\\6f ne',
  'visibility:\\68 idden', 'visibility:collapse', 'mso-hide:all',
  'display:var(--unknown)', 'visibility:var(--unknown)', 'display:none; display:block',
  'broken fragment; display:none',
])('continues excluding hidden or unresolved visibility declarations: %s', style => {
  expect(inlineStyleHidesContent(style)).toBe(true);
});

it('bounds oversized inline CSS without parsing it', () => {
  expect(inlineStyleHidesContent(' '.repeat(16_385))).toBe(true);
});
