import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
it('finishes within a bounded process for repeated untrusted labels and retains duplicate-field ambiguity', () => {
  const program = `
    import {parseProjects} from './src/kwork/parser.ts';
    const text = 'Проект: Synthetic\\nСсылка: https://kwork.example/synthetic-project/1\\n' + 'X:a\\n'.repeat(100000) + 'Бюджет: 1 ₽\\n'.repeat(10000);
    const result = parseProjects({html:[],text:[text],diagnostics:[]}, 'synthetic-resource', {format:'synthetic-v1',htmlBlockSelector:'article[data-project]',urls:{hostname:'kwork.example',pathPrefix:'/synthetic-project/'}});
    console.log(JSON.stringify({projects:result.projects.length,budget:result.projects[0]?.budget ?? null,diagnostics:result.diagnostics}));
  `;
  const child = spawnSync(process.execPath, ['--import','tsx','--input-type=module','-e',program], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: {}, encoding: 'utf8', timeout: 5_000,
  });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({projects:1,budget:null,diagnostics:['invalid_optional']});
}, 10_000);
it('bounds repeated signed table statistics without array copying and rejects their ambiguity', () => {
  const program = `
    import {parseProjects} from './src/kwork/parser.ts';
    import {TABLE_HTML,TABLE_POLICY} from './tests/fixtures/kwork-table-v1.ts';
    const html=TABLE_HTML.replace('33 проектов на бирже','33 проектов на бирже '.repeat(20000));
    const result=parseProjects({html:[html],text:[],diagnostics:[]},'synthetic-resource',TABLE_POLICY);
    console.log(JSON.stringify({projects:result.projects.length,stats:result.projects[0]?.customerStatistics??null,diagnostics:result.diagnostics}));
  `;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',program],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),env:{},encoding:'utf8',timeout:5_000,
  });
  expect(child.error).toBeUndefined();expect(child.status).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({projects:1,stats:null,diagnostics:['invalid_optional']});
},10_000);
it('rejects a long malformed base64url padding run within bounded time but accepts its canonical envelope', () => {
  const program = `
    import {decodeMime} from './src/gmail/mime.ts';
    const raw='='.repeat(300000)+'!';
    const invalid=decodeMime({mimeType:'text/html',body:{data:raw}});
    const valid=decodeMime({mimeType:'text/html',body:{data:Buffer.from(raw).toString('base64url')}});
    console.log(JSON.stringify({invalid:invalid.diagnostics,canonicalAccepted:valid.html[0]===raw,valid:valid.diagnostics}));
  `;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',program],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),env:{},encoding:'utf8',timeout:3_000,
  });
  expect(child.error).toBeUndefined();expect(child.status).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({invalid:['invalid_base64url','empty_body'],canonicalAccepted:true,valid:[]});
},10_000);
