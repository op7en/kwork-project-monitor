// Synthetic resource probe. No startup, config, OAuth construction or network calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const metric = name => readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim();
try {
  assert.equal(process.getuid(), 21001);
  assert.equal(process.getgid(), 21001);
  const { Bot } = await import('grammy');
  const { google } = await import('googleapis');
  assert.equal(typeof Bot, 'function');
  assert.equal(typeof google.gmail, 'function');
  const { decodeMime, MAX_MESSAGE_BYTES } = await import('../dist/gmail/mime.js');
  const { parseProjects, KWORK_TABLE_POLICY } = await import('../dist/kwork/parser.js');
  const { classifyProject } = await import('../dist/filters/projectFilter.js');
  const header = '<tr><td>Название</td><td>Покупатель</td><td>Цена</td></tr>';
  const row = '<tr><td><a href="https://kwork.ru/new_offer?project=9000001">React исправить интерфейс</a>' +
    '<div>Синтетическое описание</div></td><td>Синтетический покупатель</td><td>5000 ₽</td></tr>';
  const prefix = `<table>${header}${row}</table><!--`;
  const html = prefix + 'x'.repeat(MAX_MESSAGE_BYTES - Buffer.byteLength(prefix) - 3) + '-->';
  assert.equal(Buffer.byteLength(html), MAX_MESSAGE_BYTES);
  // Retain loaded libraries, repeatedly decode/parse the maximum accepted message size.
  // Comments exercise the byte bound without pretending to cover every hostile DOM shape.
  for (let i = 0; i < 20; i++) {
    const body = decodeMime({ mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } });
    const parsed = parseProjects(body, 'synthetic-profile-only', KWORK_TABLE_POLICY);
    assert.equal(parsed.projects.length, 1);
    assert.equal(classifyProject(parsed.projects[0]).classification, 'match');
  }
  // Exercise many labels as the existing offline resource regression does.
  const text = 'Проект: React исправить интерфейс\nСсылка: https://kwork.example/synthetic-project/1\n' +
    'X:a\n'.repeat(100000) + 'Бюджет: 1 ₽\n'.repeat(10000);
  const parsed = parseProjects({ html: [], text: [text], diagnostics: [] }, 'synthetic-profile-only', {
    format: 'synthetic-v1', htmlBlockSelector: 'article[data-project]',
    urls: { hostname: 'kwork.example', pathPrefix: '/synthetic-project/' },
  });
  assert.equal(parsed.projects.length, 1);
  assert.equal(classifyProject(parsed.projects[0]).classification, 'match');
  console.info(JSON.stringify({ status: 'shared_probe_ok', uid: process.getuid(), gid: process.getgid(),
    rssPeakKiB: process.resourceUsage().maxRSS, cgroupPeakBytes: Number(metric('memory.peak')),
    memoryLimitBytes: Number(metric('memory.max')), swapLimitBytes: Number(metric('memory.swap.max')),
    cpuQuota: metric('cpu.max') }));
} catch {
  console.error('shared_probe_failed'); process.exitCode = 1;
}
