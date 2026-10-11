import { describe, expect, it } from 'vitest';
import type { KworkProject } from '../src/kwork/model.js';
import { formatProjectNotification } from '../src/bot/projectFormatter.js';

const project: KworkProject = {
  projectId: '9000001', url: 'https://kwork.ru/new_offer?project=9000001',
  title: 'Синтетический интерфейс', sourceGmailMessageId: 'synthetic-private-provenance',
  price: { raw: '5 555 ₽', amount: 5555, currency: 'RUB' },
  customerName: 'Synthetic buyer', customerStatistics: { exchangeProjects: 33 },
  hireRate: 44, details: 'Synthetic description\nSynthetic category',
};

describe('Telegram project formatter', () => {
  it('formats confirmed price/statistics and a direct URL button without exposing provenance', () => {
    const result = formatProjectNotification(project);
    expect(result?.text).toBe('Новый проект Kwork\nНазвание: Синтетический интерфейс\nЦена: 5 555 ₽\n' +
      'Покупатель: Synthetic buyer\nПроектов на бирже: 33\nНанято: 44%\n\nОписание:\nSynthetic description\nSynthetic category');
    expect(result?.options).toEqual({ reply_markup: { inline_keyboard: [[{
      text: 'Открыть заказ', url: 'https://kwork.ru/new_offer?project=9000001',
    }]] }, link_preview_options: { is_disabled: true } });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-provenance');
  });

  it('omits absent optional fields instead of inventing values', () => {
    const result = formatProjectNotification({projectId:project.projectId,url:project.url,
      title:'Synthetic minimal',sourceGmailMessageId:'synthetic'});
    expect(result?.text).toBe('Новый проект Kwork\nНазвание: Synthetic minimal');
  });

  it('preserves HTML/Markdown symbols as literal text with no parse mode or entities', () => {
    const result = formatProjectNotification({...project,title:'<b>A & B</b> _*[]()~`>#+-=|{}.!',
      details:'<script>alert("synthetic")</script>\n[click](https://example.invalid)'});
    expect(result?.text).toContain('Название: <b>A & B</b> _*[]()~`>#+-=|{}.!');
    expect(result?.text).toContain('<script>alert("synthetic")</script>\n[click](https://example.invalid)');
    expect(result?.options).not.toHaveProperty('parse_mode');
    expect(result?.options).not.toHaveProperty('entities');
    expect(result?.options.link_preview_options).toEqual({is_disabled:true});
  });

  it('does not reuse untrusted raw price text and retains zero optional values', () => {
    const result=formatProjectNotification({...project,price:{raw:'<b>incorrect</b>',amount:0,currency:'RUB'},
      hireRate:0,customerStatistics:{exchangeProjects:0,postedProjects:0,hiredProjects:0}});
    expect(result?.text).toContain('Цена: 0 ₽');
    expect(result?.text).toContain('Проектов на бирже: 0');
    expect(result?.text).toContain('Нанято: 0%');
    expect(result?.text).toContain('Размещено проектов: 0');
    expect(result?.text).toContain('Нанято проектов: 0');
    expect(result?.text).not.toContain('<b>incorrect</b>');
  });

  it('omits invalid numeric optional values and does not reinterpret a desired budget as price', () => {
    const result=formatProjectNotification({...project,price:{raw:'bad',amount:-1,currency:'RUB'},
      hireRate:101,customerStatistics:{exchangeProjects:-1},
      budget:{desired:{raw:'100 ₽',amount:100,currency:'RUB',kind:'fixed'}}});
    expect(result?.text).not.toContain('Цена:');
    expect(result?.text).not.toContain('Нанято:');
    expect(result?.text).not.toContain('Проектов на бирже:');
  });

  it('keeps long emoji descriptions within the Telegram limit without splitting a surrogate pair', () => {
    const result=formatProjectNotification({...project,details:'🙂'.repeat(5000)});
    expect(result).toBeDefined();
    expect(result!.text.length).toBeLessThanOrEqual(4000);
    expect(result!.text).toContain('Цена: 5 555 ₽');
    expect(result!.text.endsWith('…')).toBe(true);
    expect(result!.text).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(result!.options.reply_markup.inline_keyboard[0]?.[0]).toEqual({text:'Открыть заказ',url:project.url});
  });

  it('keeps the title on one line and strips misleading controls', () => {
    const result=formatProjectNotification({...project,title:'A\nB\u202e',details:'Details\u0000\u2066'});
    expect(result?.text).toContain('Название: A B\n');
    expect(result?.text).toContain('Описание:\nDetails');
    for (const control of ['\u0000','\u202e','\u2066']) expect(result?.text).not.toContain(control);
  });

  it.each(['https://kwork.ru.evil.com/new_offer?project=9000001',
    'https://kwork.ru@evil.com/new_offer?project=9000001',
    'https://kwork.ru/new_offer?project=9000001&project=9000002',
    'https://kwork.ru/redirect?url=https://example.invalid',
    'javascript:alert(1)', 'https://kwork.ru/new_offer?project=9000002'])('rejects unsafe or mismatched URL: %s',url=>{
    expect(formatProjectNotification({...project,url})).toBeUndefined();
  });

  it('rejects an empty title',()=>{
    expect(formatProjectNotification({...project,title:' \n '})).toBeUndefined();
  });

  it.each([' '.repeat(301),'\u202e'.repeat(301)])('never manufactures an ellipsis title from empty/control-only input %#',title=>{
    expect(formatProjectNotification({...project,title})).toBeUndefined();
  });
});
