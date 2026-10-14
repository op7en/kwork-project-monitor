import { beforeEach, expect, it, vi } from 'vitest';
import { createGmailProjectReader, GmailError, GMAIL_READONLY_SCOPE } from '../src/gmail/client.js';
import { readKworkProjects, parseGmailMessage } from '../src/gmail/projects.js';
import { SYNTHETIC_POLICY, SYNTHETIC_SENDER, syntheticMessage, syntheticPart } from './fixtures/synthetic-v1.js';
import { TABLE_POLICY, TABLE_HTML } from './fixtures/kwork-table-v1.js';
const api = vi.hoisted(() => ({
  setCredentials: vi.fn(), getAccessToken: vi.fn(), getTokenInfo: vi.fn(), getProfile: vi.fn(), get: vi.fn(), gmail: vi.fn(),
}));
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class {
  setCredentials = api.setCredentials; getAccessToken = api.getAccessToken; getTokenInfo = api.getTokenInfo;
} }, gmail: api.gmail } }));
const config = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh', expectedAccountEmail: 'owner@example.com' };
beforeEach(() => {
  vi.resetAllMocks(); api.getAccessToken.mockResolvedValue({ token: 'synthetic-access' });
  api.getTokenInfo.mockResolvedValue({ scopes: [GMAIL_READONLY_SCOPE] });
  api.getProfile.mockResolvedValue({ data: { emailAddress: 'owner@example.com' } });
  api.gmail.mockReturnValue({ users: { getProfile: api.getProfile, messages: { get: api.get } } });
  api.get.mockResolvedValue({ data: syntheticMessage() });
});
it('runs full offline Google boundary → MIME → parser with metadata before full and no mutation capability', async () => {
  const reader = await createGmailProjectReader(config, [SYNTHETIC_SENDER]);
  const result = await readKworkProjects(reader, ['synthetic-message-1'], SYNTHETIC_POLICY);
  expect(result.projects.map(p => [p.projectId, p.sourceGmailMessageId])).toEqual([['101', 'synthetic-message-1'], ['102', 'synthetic-message-1']]);
  expect(api.get.mock.calls.map(c => c[0].format)).toEqual(['metadata', 'full']);
  expect(api.get.mock.calls[0]?.[0]).toEqual({ userId: 'me', id: 'synthetic-message-1', format: 'metadata', metadataHeaders: ['Subject','From'], fields: 'id,sizeEstimate,payload/headers' });
  expect(api.get.mock.calls[1]?.[0]).toEqual({ userId: 'me', id: 'synthetic-message-1', format: 'full', fields: 'id,sizeEstimate,payload' });
  expect(Object.keys(reader)).toEqual(['getProjectMessage']);
});
it('runs metadata-first reader → MIME → confirmed table using only synthetic Google responses', async () => {
  const metadata = syntheticMessage();
  const full = { ...metadata, payload: { headers: metadata.payload.headers, mimeType:'multipart/alternative', parts:[
    syntheticPart('Unconfirmed plain text','text/plain'), syntheticPart(TABLE_HTML),
  ] } };
  api.get.mockResolvedValueOnce({data:metadata}).mockResolvedValueOnce({data:full});
  const reader=await createGmailProjectReader(config,[SYNTHETIC_SENDER]);
  const result=await readKworkProjects(reader,['synthetic-message-1'],TABLE_POLICY);
  expect(result.projects.map(p=>[p.projectId,(p.price?.kind === 'fixed' ? p.price.amount : undefined),p.sourceGmailMessageId])).toEqual([['9000001',5555,'synthetic-message-1']]);
  expect(api.get.mock.calls.map(c=>c[0].format)).toEqual(['metadata','full']);
});
it('requires explicit sender policy before authentication or access', async () => {
  await expect(createGmailProjectReader(config, [])).rejects.toThrow(GmailError);
  expect(api.getAccessToken).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
});
it.each([
  [{name:'Subject',value:'Новые проекты на бирже Kwork!'}, {name:'From',value:SYNTHETIC_SENDER}],
  [{name:'Subject',value:'Новые проекты на бирже Kwork'}, {name:'From',value:'attacker@example.com'}],
  [{name:'Subject',value:'Новые проекты на бирже Kwork'}, {name:'From',value:`${SYNTHETIC_SENDER}, attacker@example.com`}],
  [{name:'Subject',value:'Новые проекты на бирже Kwork'}, {name:'From',value:`${SYNTHETIC_SENDER}\r\nBcc: attacker@example.com`}],
  [{name:'Subject',value:'Новые проекты на бирже Kwork'}],
  [{name:'Subject',value:'Новые проекты на бирже Kwork'}, {name:'From',value:SYNTHETIC_SENDER}, {name:'From',value:SYNTHETIC_SENDER}],
  [{name:'Subject',value:'Новые проекты на бирже Kwork'}, {name:'Subject',value:'Новые проекты на бирже Kwork'}, {name:'From',value:SYNTHETIC_SENDER}],
].map(headers => ({ headers })))('rejects untrusted/ambiguous metadata without fetching full %j', async ({ headers }) => {
  api.get.mockResolvedValue({ data: { ...syntheticMessage(), payload: { headers } } });
  const reader = await createGmailProjectReader(config, [SYNTHETIC_SENDER]);
  expect(await reader.getProjectMessage('synthetic-message-1')).toEqual({ diagnostics: ['message_rejected'] });
  expect(api.get.mock.calls.map(c => c[0].format)).toEqual(['metadata']);
});
it.each(['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.modify', 'openid'])('requires actual read-only scope before mail operations %s', async scope => {
  api.getTokenInfo.mockResolvedValue({ scopes: [scope] });
  await expect(createGmailProjectReader(config, [SYNTHETIC_SENDER])).rejects.toThrow(GmailError);
  expect(api.get).not.toHaveBeenCalled(); expect(api.getProfile).not.toHaveBeenCalled();
});
it('rejects a wrong account before mail operations', async () => {
  api.getProfile.mockResolvedValue({ data: { emailAddress: 'wrong@example.com' } });
  await expect(createGmailProjectReader(config, [SYNTHETIC_SENDER])).rejects.toThrow(GmailError);
  expect(api.get).not.toHaveBeenCalled();
});
it.each([undefined, 1_048_577, -1, NaN])('rejects invalid metadata size estimate %s before full', async sizeEstimate => {
  api.get.mockResolvedValue({ data: { ...syntheticMessage(), sizeEstimate } });
  const reader = await createGmailProjectReader(config, [SYNTHETIC_SENDER]);
  expect((await reader.getProjectMessage('synthetic-message-1')).message).toBeUndefined();
  expect(api.get.mock.calls.map(c => c[0].format)).toEqual(['metadata']);
});
it('rechecks full response identity and headers after metadata gate', async () => {
  api.get.mockResolvedValueOnce({ data: syntheticMessage() }).mockResolvedValueOnce({ data: syntheticMessage('wrong-id') });
  const reader = await createGmailProjectReader(config, [SYNTHETIC_SENDER]);
  expect(await reader.getProjectMessage('synthetic-message-1')).toEqual({ diagnostics: ['message_rejected'] });
});
it.each(['subject','sender','size'])('rejects altered full %s after a valid metadata gate', async field => {
  const full=syntheticMessage();
  if(field==='size')full.sizeEstimate=1_048_577;
  else full.payload.headers=field==='subject' ? [{name:'Subject',value:'Wrong'}, {name:'From',value:SYNTHETIC_SENDER}] :
    [{name:'Subject',value:'Новые проекты на бирже Kwork'},{name:'From',value:'attacker@example.com'}];
  api.get.mockResolvedValueOnce({data:syntheticMessage()}).mockResolvedValueOnce({data:full});
  const reader=await createGmailProjectReader(config,[SYNTHETIC_SENDER]);
  expect(await reader.getProjectMessage('synthetic-message-1')).toEqual({diagnostics:['message_rejected']});
});
it('full errors are sanitized and do not contaminate the remaining batch', async () => {
  api.get.mockResolvedValueOnce({ data: syntheticMessage() }).mockRejectedValueOnce(new Error('PRIVATE_SENTINEL synthetic-secret Authorization'));
  const reader = await createGmailProjectReader(config, [SYNTHETIC_SENDER]);
  const result = await readKworkProjects(reader, ['synthetic-message-1'], SYNTHETIC_POLICY);
  expect(result).toEqual({ projects: [], diagnostics: ['message_read_failed'] });
});
it('offline decoding preserves provenance, handles missing optional fields and dedups batch by first input order', async () => {
  expect(parseGmailMessage(syntheticMessage(), SYNTHETIC_POLICY).projects[1]?.projectId).toBe('102');
  const reader = { async getProjectMessage(id: string) { return { message: syntheticMessage(id), diagnostics: [] }; } };
  const result = await readKworkProjects(reader, ['b', 'a'], SYNTHETIC_POLICY);
  expect(result.projects.map(p => p.sourceGmailMessageId)).toEqual(['b','b']);
  expect(result.diagnostics).toContain('duplicate_project');
});
it('retains independent multipart/mixed HTML siblings instead of treating them as alternatives', () => {
  const content = (id: string) => `<article data-project><h2><a href="https://kwork.example/synthetic-project/${id}">Synthetic ${id}</a></h2></article>`;
  const result = parseGmailMessage({id:'synthetic-id',payload:{mimeType:'multipart/mixed',parts:[syntheticPart(content('101')),syntheticPart(content('102'))]}}, SYNTHETIC_POLICY);
  expect(result.projects.map(p => p.projectId)).toEqual(['101','102']);
});
it('missing parser policy prevents all mail reading', async () => {
  const reader = { getProjectMessage: vi.fn() };
  expect(await readKworkProjects(reader, ['a'])).toEqual({ projects: [], diagnostics: ['unconfirmed_policy'] });
  expect(reader.getProjectMessage).not.toHaveBeenCalled();
});
it.each([
  { ...SYNTHETIC_POLICY, htmlBlockSelector: 'a'.repeat(201) },
  { ...SYNTHETIC_POLICY, htmlBlockSelector: '[broken' },
  { ...SYNTHETIC_POLICY, urls: { hostname: 'https://evil.test', pathPrefix: '/synthetic-project/' } },
  { ...SYNTHETIC_POLICY, urls: { hostname: 'kwork.example', pathPrefix: '/a/../' } },
])('invalid parser policy prevents all mail access: %j', async policy => {
  const reader = { getProjectMessage: vi.fn() };
  expect(await readKworkProjects(reader, ['a'], policy)).toEqual({ projects: [], diagnostics: ['unconfirmed_policy'] });
  expect(reader.getProjectMessage).not.toHaveBeenCalled();
});
