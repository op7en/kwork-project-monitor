import type { ParserPolicy } from '../../src/kwork/model.js';
import type { MessagePart } from '../../src/gmail/mime.js';
// Invented test grammar, sender, hostname and paths. No real Kwork email data.
export const SYNTHETIC_POLICY = {
  format: 'synthetic-v1', htmlBlockSelector: 'article[data-project]',
  urls: { hostname: 'kwork.example', pathPrefix: '/synthetic-project/' },
} satisfies ParserPolicy;
export const SYNTHETIC_SENDER = 'notifications@example.com';
export const SYNTHETIC_HTML = `<article data-project>
  <h2><a href="https://kwork.example/synthetic-project/101">Синтетический React интерфейс</a></h2>
  <p>Желаемый бюджет: 5 000 ₽</p><p>Максимальный бюджет: до 10 000 ₽</p>
  <p>Заказчик: Synthetic Customer</p><p>Нанимает: 75%</p><p>Размещено проектов: 20</p><p>Нанято проектов: 15</p>
</article><article data-project><h2><a href="https://kwork.example/synthetic-project/102">Синтетическая API интеграция</a></h2>
  <p>Бюджет: 8 000–12 000 руб.</p></article>`;
export const SYNTHETIC_TEXT = 'Проект: Синтетический React интерфейс\nСсылка: https://kwork.example/synthetic-project/101\nБюджет: 5000 ₽';
export function syntheticPart(content: string, mimeType = 'text/html'): MessagePart {
  return { mimeType, body: { data: Buffer.from(content).toString('base64url') } };
}
export function syntheticMessage(id = 'synthetic-message-1') {
  return { id, sizeEstimate: 3_000, payload: {
    mimeType: 'multipart/alternative', headers: [
      { name: 'Subject', value: 'Новые проекты на бирже Kwork' },
      { name: 'From', value: `Synthetic Kwork <${SYNTHETIC_SENDER}>` },
    ], parts: [syntheticPart(SYNTHETIC_TEXT, 'text/plain'), syntheticPart(SYNTHETIC_HTML)],
  } };
}
