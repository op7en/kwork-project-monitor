import { expect, it, vi } from 'vitest';
import { parseProjects } from '../src/kwork/parser.js';
import { parseGmailMessage, readKworkProjects } from '../src/gmail/projects.js';
import { TABLE_POLICY, TABLE_HEADER, TABLE_ROW, TABLE_HTML } from './fixtures/kwork-table-v1.js';

const run = (html = TABLE_HTML, source = 'synthetic-table-message') =>
  parseProjects({html:[html],text:[],diagnostics:[]},source,TABLE_POLICY);
const second = TABLE_ROW.replaceAll('9000001','9000002').replace('Синтетический интерфейс','Синтетическая интеграция')
  .replace('Синтетический покупатель','Синтетический покупатель B').replace('5 555 ₽','8 888 ₽').replace('33 проектов','66 проектов').replace('44%','77%');

it('extracts a project from the confirmed three-cell row with a distinct notification price', () => {
  expect(run()).toEqual({projects:[{projectId:'9000001',title:'Синтетический интерфейс',
    url:'https://kwork.ru/new_offer?project=9000001',sourceGmailMessageId:'synthetic-table-message',
    details:'Синтетическое описание, интерфейсы',customerName:'Синтетический покупатель',hireRate:44,
    customerStatistics:{exchangeProjects:33},price:{raw:'5 555 ₽',amount:5555,currency:'RUB'}}],diagnostics:[]});
});
it('binds contrasting titles, prices and statistics within each row of one table', () => {
  const result=run(`<table><tbody>${TABLE_HEADER}${TABLE_ROW}${second}</tbody></table>`);
  expect(result.projects.map(p=>[p.projectId,p.title,p.price?.amount,p.customerName,p.hireRate,p.customerStatistics?.exchangeProjects]))
    .toEqual([['9000001','Синтетический интерфейс',5555,'Синтетический покупатель',44,33],
      ['9000002','Синтетическая интеграция',8888,'Синтетический покупатель B',77,66]]);
});
it('keeps absent optional data absent without borrowing from the next row', () => {
  const first='<tr><td><a href="https://kwork.ru/new_offer?project=9000001">Synthetic A</a></td><td></td><td></td></tr>';
  expect(run(`<table>${TABLE_HEADER}${first}${second}</table>`).projects[0]).toEqual({projectId:'9000001',title:'Synthetic A',
    url:'https://kwork.ru/new_offer?project=9000001',sourceGmailMessageId:'synthetic-table-message'});
});
it.each(['100','до 100 ₽','10–20 ₽','USD 100','100 ₽ 200 ₽'])('does not invent an uncertain notification price: %s', raw => {
  const result=run(TABLE_HTML.replace('5 555 ₽',raw));
  expect(result.projects).toHaveLength(1);expect(result.projects[0]).not.toHaveProperty('price');
  expect(result.projects[0]).not.toHaveProperty('budget');expect(result.diagnostics).toContain('invalid_optional');
});
it.each(['5\u00a0555 ₽','5\u202f555 ₽','0 ₽'])('supports integer RUB notification price %s', raw=>{
  expect(run(TABLE_HTML.replace('5 555 ₽',raw)).projects[0]?.price).toEqual({raw,amount:raw==='0 ₽'?0:5555,currency:'RUB'});
});
it('extracts stats only with confirmed labels and retains zero',()=>{
  const unlabelled=run(TABLE_HTML.replace('33 проектов на бирже','33').replace('44% нанято','44%')).projects[0];
  expect(unlabelled).not.toHaveProperty('hireRate');expect(unlabelled).not.toHaveProperty('customerStatistics');
  const zero=run(TABLE_HTML.replace('33 проектов','0 проектов').replace('44%','0%')).projects[0];
  expect(zero?.hireRate).toBe(0);expect(zero?.customerStatistics).toEqual({exchangeProjects:0});
});
it.each(['101% нанято','-1% нанято','1,2,3% нанято','44% нанято 55% нанято'])('omits invalid or conflicting hire rate: %s', raw=>{
  const result=run(TABLE_HTML.replace('44% нанято',raw));expect(result.projects[0]).not.toHaveProperty('hireRate');
  expect(result.diagnostics).toContain('invalid_optional');
});
it('rejects conflicting repeated counts without merging them',()=>{
  const result=run(TABLE_HTML.replace('33 проектов на бирже','33 проектов на бирже 66 проектов на бирже'));
  expect(result.projects[0]).not.toHaveProperty('customerStatistics');expect(result.diagnostics).toContain('invalid_optional');
});
it.each(['44% нанято -1% нанято','44% нанято abc% нанято'])('rejects a second malformed signed rate: %s', text=>{
  const result=run(TABLE_HTML.replace('44% нанято',text));
  expect(result.projects[0]).not.toHaveProperty('hireRate');expect(result.diagnostics).toContain('invalid_optional');
});
it.each(['33 проектов на бирже -1 проектов на бирже','33 проектов на бирже abc проектов на бирже',
  '33 проектов на бирже 99999999999999999 проектов на бирже'])('rejects a second malformed signed count: %s',text=>{
  const result=run(TABLE_HTML.replace('33 проектов на бирже',text));
  expect(result.projects[0]).not.toHaveProperty('customerStatistics');expect(result.diagnostics).toContain('invalid_optional');
});
it.each(['1 000 проектов на бирже','33 проектов на бирже2'])('never truncates an unsupported signed count: %s',text=>{
  const result=run(TABLE_HTML.replace('33 проектов на бирже',text));
  expect(result.projects[0]).not.toHaveProperty('customerStatistics');expect(result.diagnostics).toContain('invalid_optional');
});
it.each(['- 1% нанято','44% нанято2'])('never truncates a malformed signed rate: %s',text=>{
  const result=run(TABLE_HTML.replace('44% нанято',text));
  expect(result.projects[0]).not.toHaveProperty('hireRate');expect(result.diagnostics).toContain('invalid_optional');
});
it.each(['display:/**/none','display:n\\6f ne','visibility:\\68 idden'])('omits obfuscated inline CSS instead of accepting hidden projects: %s',style=>{
  expect(run(`<div style="${style}">${TABLE_HTML}</div>`).projects).toEqual([]);
});
it.each(['Название|Покупатель|Сумма','Название|Цена|Покупатель','A|B|C'])('ignores service tables without confirmed headers %s', labels=>{
  const header='<tr>'+labels.split('|').map(s=>`<td>${s}</td>`).join('')+'</tr>';
  expect(run(`<table>${header}${TABLE_ROW}</table>`).projects).toEqual([]);
});
it('supports header groups and ignores pseudonymized class names',()=>{
  const result=run(`<table class="unrelated"><thead>${TABLE_HEADER}</thead><tbody>${TABLE_ROW}</tbody></table>`);
  expect(result.projects[0]?.projectId).toBe('9000001');
});
it.each(['rowspan="2"','colspan="2"'])('skips unsupported row ownership %s', attr=>{
  expect(run(TABLE_HTML.replace('<td><div><a',`<td ${attr}><div><a`)).projects).toEqual([]);
});
it('does not merge rows repaired from missing or nested cells',()=>{
  expect(run(`<table>${TABLE_HEADER}<tr><td><a href="https://kwork.ru/new_offer?project=9000001">Title</a></td><td>10 ₽</td></tr>${second}</table>`).projects.map(p=>p.projectId)).toEqual(['9000002']);
  expect(run(TABLE_HTML.replace('5 555 ₽','<table><tr><td>5 555 ₽</td></tr></table>')).projects).toEqual([]);
});
it('accepts missing outer closing wrappers but rejects damage that collapses the three cells',()=>{
  expect(run(TABLE_HTML.replace('</body></html>','')).projects[0]?.projectId).toBe('9000001');
  const collapsed=run(TABLE_HTML.replace('</a></div>','</a>'));
  expect(collapsed.projects).toEqual([]);expect(collapsed.diagnostics).toContain('ambiguous_block');
});
it('rejects conflicting project titles or IDs in the first cell',()=>{
  expect(run(TABLE_HTML.replace('Синтетический интерфейс</a>','Синтетический интерфейс</a><a href="https://kwork.ru/new_offer?project=9000002">Other</a>')).projects).toEqual([]);
});
it('deduplicates by ID and keeps the first price and provenance',async()=>{
  const result=run(`<table>${TABLE_HEADER}${TABLE_ROW}${TABLE_ROW.replace('5 555 ₽','8 888 ₽')}</table>`);
  expect(result.projects).toHaveLength(1);expect(result.projects[0]?.price?.amount).toBe(5555);
  expect(result.diagnostics).toContain('duplicate_project');
  const reader={async getProjectMessage(id:string){return {message:{id,payload:{mimeType:'text/html',body:{data:Buffer.from(TABLE_HTML).toString('base64url')}}},diagnostics:[]};}};
  expect((await readKworkProjects(reader,['first','second'],TABLE_POLICY)).projects[0]?.sourceGmailMessageId).toBe('first');
});
it('runs synthetic Gmail payload through MIME and table parser, without inventing a plain template',()=>{
  const result=parseGmailMessage({id:'synthetic-offline',payload:{mimeType:'multipart/alternative',parts:[
    {mimeType:'text/plain',body:{data:Buffer.from('Unconfirmed plain alternative').toString('base64url')}},
    {mimeType:'text/html',headers:[{name:'Content-Type',value:'text/html; charset=UTF-8'}],body:{data:Buffer.from(TABLE_HTML).toString('base64url')}},
  ]}},TABLE_POLICY);
  expect(result.projects).toHaveLength(1);expect(result.projects[0]?.sourceGmailMessageId).toBe('synthetic-offline');
  expect(result.projects[0]?.price?.amount).toBe(5555);
  expect(parseProjects({html:[],text:['Проект: Fake\nСсылка: https://kwork.ru/new_offer?project=9000001'],diagnostics:[]},'synthetic',TABLE_POLICY).projects).toEqual([]);
});
it('keeps scripts, hidden fields, instructions and images inert without output or network',()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw Error('network_forbidden');});
  const info=vi.spyOn(console,'info').mockImplementation(()=>{});
  try{
    const html=TABLE_HTML.replace('5 555 ₽','5 555 ₽<script>throw Error("SYNTHETIC_PRIVATE")</script><span hidden>999 ₽</span>')+'<iframe src="https://example.invalid"></iframe>';
    expect(run(html).projects[0]?.price?.amount).toBe(5555);
    expect(fetch).not.toHaveBeenCalled();expect(info).not.toHaveBeenCalled();
  }finally{vi.restoreAllMocks();}
});
it('bounds total HTML elements and rows before output',()=>{
  expect(run('<div>'+('<span></span>'.repeat(10001))+TABLE_HTML+'</div>').diagnostics).toContain('html_limit');
  expect(run(`<table>${TABLE_HEADER}${TABLE_ROW.repeat(101)}</table>`).projects).toEqual([]);
});
