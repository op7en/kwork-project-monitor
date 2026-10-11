import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
it('runs synthetic-v1 offline CLI in an empty environment without loading credentials', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/kwork/check.ts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: {}, encoding: 'utf8', timeout: 10_000,
  });
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.fixture).toBe('synthetic-v1');
  expect(output.projects.map((p: { projectId: string }) => p.projectId)).toEqual(['101','102']);
  expect(output.confirmedTableExample.projects.map((p: {projectId:string;price?:{amount:number}})=>[p.projectId,p.price?.amount]))
    .toEqual([['9000001',5555],['9000002',8888]]);
  expect(output.confirmedTableExample.diagnostics).toEqual([]);
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toMatch(/Authorization|refresh_token|client_secret|owner@example.com/);
});
