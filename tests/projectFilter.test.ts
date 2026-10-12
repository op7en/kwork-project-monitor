import { expect, it } from 'vitest';
import { classifyProject } from '../src/filters/projectFilter.js';
import type { KworkProject } from '../src/kwork/model.js';
const project = (title: string, details?: string): KworkProject => ({
  projectId: '123', url: 'https://kwork.ru/new_offer?project=123', sourceGmailMessageId: 'synthetic-message',
  title, ...(details === undefined ? {} : { details }),
});
it.each([
  ['Исправить ошибку React TypeScript', 'match'],
  ['Добавить кнопку в React UI', 'match'],
  ['Node.js скрипт: интеграция REST API', 'match'],
  ['PostgreSQL: исправить SQL запрос', 'match'],
  ['Небольшой Python скрипт автоматизации', 'match'],
  ['Простой Telegram бот: добавить команду', 'match'],
  ['React', 'review'],
  ['Git разработчик', 'review'],
  ['Создать сервис на Python', 'review'],
  ['Исправить сайт WordPress', 'exclude'],
  ['Доработка Битрикс 1C', 'exclude'],
  ['Переписать WordPress frontend на React', 'review'],
  ['React: большой интернет-магазин с нуля', 'review'],
  ['Сложный reverse engineering Node.js приложения', 'review'],
  ['Разработать логотип', 'exclude'],
  ['Нужен специалист', 'review'],
] as const)('classifies evidence from %s as %s', (title, classification) => {
  expect(classifyProject(project(title)).classification).toBe(classification);
});
it('uses details and available optional metrics without inventing missing values', () => {
  expect(classifyProject(project('Нужно исправить баг', 'React TypeScript интерфейс')).classification).toBe('match');
  expect(classifyProject({ ...project('Исправить React баг'), hireRate: 10,
    customerStatistics: { exchangeProjects: 20 } })).toMatchObject({ classification: 'review', reasons: ['customer_caution'] });
  expect(classifyProject({ ...project('React: большой магазин с нуля'), price: { currency: 'RUB', amount: 1000, raw: '1000 ₽' } })
    .reasons).toContain('scope_budget_caution');
});
it.each([
  ['Добавить кнопку, не React', undefined],
  ['Небольшой скрипт без JavaScript', undefined],
  ['Нужен баг fix', 'Цитата чужой вакансии: «React TypeScript». Наша задача не связана с этим стеком.'],
  ['Добавить функционал fullstack React Node.js платформы с нуля', undefined],
  ['Нужна доработка', 'Ранее использовали React. Сейчас нужна другая технология.'],
] as const)('does not confidently match ambiguous or negated stack: %s', (title, details) => {
  expect(classifyProject({ ...project(title, details), price: { amount: 1000, currency: 'RUB', raw: '1000 ₽' } }).classification).toBe('review');
});
it.each([
  ['Добавить кнопку в WordPress, JavaScript', 'review'],
  ['WordPress: отдельная небольшая React доработка UI', 'review'],
  ['Python script автоматизации', 'review'],
  ['Неопределённая работа', 'review'],
  ['Исправить баг, React не используется', 'review'],
  ['Fix bug, we do not use React', 'review'],
  ['Исправить баг', 'Перечень технологий конкурента: React, Node.js, TypeScript', 'review'],
  ['Небольшой TypeScript bug fix', 'match'],
  ['Node.js REST API integration', 'match'],
] as const)('adversarial corpus %s yields %s', (title, ...rest) => {
  const classification = rest.at(-1);
  const details = rest.length === 2 ? rest[0] : undefined;
  expect(classifyProject(project(title, details)).classification).toBe(classification);
});
it('does not invent price or customer statistics when evidence is otherwise positive', () => {
  expect(classifyProject({ ...project('Небольшой TypeScript bug fix'), hireRate: 10,
    customerStatistics: {} }).classification).toBe('match');
});
