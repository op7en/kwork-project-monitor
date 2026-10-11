import { parseGmailMessage } from '../gmail/projects.js';
import { KWORK_TABLE_POLICY } from './parser.js';
// Deliberately invented fixture. Never loads .env, credentials, files from the mailbox or external resources.
const html = `<article data-project><h2><a href="https://kwork.example/synthetic-project/101">Синтетический React интерфейс</a></h2>
<p>Желаемый бюджет: 5 000 ₽</p><p>Максимальный бюджет: до 10 000 ₽</p></article>
<article data-project><h2><a href="https://kwork.example/synthetic-project/102">Синтетическая API интеграция</a></h2>
<p>Бюджет: 8 000–12 000 ₽</p></article>`;
const result = parseGmailMessage({ id: 'synthetic-v1-message', payload: {
  mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') },
} }, { format: 'synthetic-v1', htmlBlockSelector: 'article[data-project]',
  urls: { hostname: 'kwork.example', pathPrefix: '/synthetic-project/' } });
// Independent invented table using only owner-confirmed public structure, not the private sample.
const table = `<table><tr><td>Название</td><td>Покупатель</td><td>Цена</td></tr>
<tr><td><div><a href="https://kwork.ru/new_offer?project=9000001">Синтетический интерфейс</a></div>
<div>Синтетическое описание, интерфейсы</div></td><td><a href="https://kwork.ru/user/synthetic">Синтетический покупатель</a>
<div>33 проектов на бирже</div><div>44% нанято</div></td><td>5 555 ₽</td></tr>
<tr><td><a href="https://kwork.ru/new_offer?project=9000002">Синтетическая интеграция</a></td><td></td><td>8 888 ₽</td></tr></table>`;
const confirmedTableExample = parseGmailMessage({id:'synthetic-table-message',payload:{
  mimeType:'text/html',body:{data:Buffer.from(table).toString('base64url')},
}},KWORK_TABLE_POLICY);
console.info(JSON.stringify({ fixture: 'synthetic-v1', ...result,
  confirmedTableExample: {fixture:'fully-synthetic-kwork-table-v1',...confirmedTableExample},
}, null, 2));
if (result.projects.length !== 2 || confirmedTableExample.projects.length !== 2 || confirmedTableExample.diagnostics.length) process.exitCode = 1;
