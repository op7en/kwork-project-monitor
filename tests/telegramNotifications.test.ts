import { Api } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import type { OwnerChatContext } from '../src/bot/privateChat.js';
import { createProjectNotifier } from '../src/bot/projectNotifications.js';
import type { KworkProject } from '../src/kwork/model.js';

const ownerId=7654321;
const project:KworkProject={projectId:'9000001',url:'https://kwork.ru/new_offer?project=9000001',
  title:'<b>Synthetic & _project_</b>',details:'[Synthetic](https://example.invalid)',
  sourceGmailMessageId:'SYNTHETIC_PRIVATE_PROVENANCE',price:{raw:'5 555 ₽',amount:5555,currency:'RUB'}};
const privateContext:OwnerChatContext={from:{id:ownerId,is_bot:false,first_name:'Synthetic owner'},
  chat:{id:ownerId,type:'private',first_name:'Synthetic owner'}};

function mockApi(failure?:'telegram'|'transport') {
  const api=new Api('test-only-placeholder');
  const requests:{method:string;payload:unknown}[]=[];
  api.config.use((previous,method,payload)=>{
    if(method!=='sendMessage') throw Error('Unexpected mock API call');
    requests.push({method,payload});
    if(failure==='transport') return Promise.reject(Error('SYNTHETIC_PRIVATE_ERROR'));
    if(failure==='telegram') return Promise.resolve({ok:false,error_code:403,description:'SYNTHETIC_PRIVATE_ERROR'}) as ReturnType<typeof previous<typeof method>>;
    return Promise.resolve({ok:true,result:{message_id:1,date:0,chat:{id:ownerId,type:'private',first_name:'Synthetic owner'},
      text:'Synthetic API response'}}) as ReturnType<typeof previous<typeof method>>;
  });
  return {api,requests};
}

describe('Private project notifications with mock Telegram API',()=>{
  it('sends literal text and the validated button only after a private owner context confirms the destination',async()=>{
    const {api,requests}=mockApi();const notifier=createProjectNotifier(api,ownerId);
    expect(notifier.confirmDestination(privateContext)).toBe(true);
    expect(await notifier.send(project)).toEqual({status:'sent'});
    expect(requests).toEqual([{method:'sendMessage',payload:{chat_id:ownerId,
      text:'Новый проект Kwork\nНазвание: <b>Synthetic & _project_</b>\nЦена: 5 555 ₽\n\nОписание:\n[Synthetic](https://example.invalid)',
      reply_markup:{inline_keyboard:[[{text:'Открыть заказ',url:'https://kwork.ru/new_offer?project=9000001'}]]},
      link_preview_options:{is_disabled:true}}}]);
    expect(JSON.stringify(requests)).not.toContain('SYNTHETIC_PRIVATE_PROVENANCE');
  });

  it('never invokes Telegram without a confirmed destination',async()=>{
    const {api,requests}=mockApi();const notifier=createProjectNotifier(api,ownerId);
    expect(await notifier.send(project)).toEqual({status:'destination_unconfirmed'});
    expect(requests).toEqual([]);
  });

  it.each([
    {...privateContext,chat:{id:-10001,type:'group' as const,title:'Synthetic group'}},
    {...privateContext,chat:{id:-10002,type:'supergroup' as const,title:'Synthetic group'}},
    {from:{id:ownerId+1,is_bot:false,first_name:'Other'},chat:{id:ownerId+1,type:'private' as const,first_name:'Other'}},
    {...privateContext,chat:{id:ownerId+1,type:'private' as const,first_name:'Other'}},
    {...privateContext,from:undefined},
    {...privateContext,chat:undefined},
    {...privateContext,from:{id:ownerId,is_bot:true,first_name:'Synthetic bot'}},
  ])('does not authorize a non-owner/private context %#',async ctx=>{
    const {api,requests}=mockApi();const notifier=createProjectNotifier(api,ownerId);
    expect(notifier.confirmDestination(ctx)).toBe(false);
    expect(await notifier.send(project)).toEqual({status:'destination_unconfirmed'});
    expect(requests).toEqual([]);
  });

  it('cannot replace a confirmed destination with a group chat',async()=>{
    const {api,requests}=mockApi();const notifier=createProjectNotifier(api,ownerId);
    notifier.confirmDestination(privateContext);
    expect(notifier.confirmDestination({...privateContext,chat:{id:-10001,type:'group',title:'Synthetic group'}})).toBe(false);
    expect(await notifier.send(project)).toEqual({status:'sent'});
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({payload:{chat_id:ownerId}});
  });

  it('requires fresh private confirmation after restart/new sender instance',async()=>{
    const {api,requests}=mockApi();const first=createProjectNotifier(api,ownerId);
    first.confirmDestination(privateContext);expect(await first.send(project)).toEqual({status:'sent'});
    const restarted=createProjectNotifier(api,ownerId);
    expect(await restarted.send(project)).toEqual({status:'destination_unconfirmed'});
    expect(requests).toHaveLength(1);
    expect(restarted.confirmDestination(privateContext)).toBe(true);
    expect(await restarted.send(project)).toEqual({status:'sent'});
    expect(requests).toHaveLength(2);
  });

  it.each(['telegram','transport'] as const)('contains %s errors without returning or logging API/private data or retrying',async failure=>{
    const spies=[vi.spyOn(console,'error'),vi.spyOn(console,'warn'),vi.spyOn(console,'info'),vi.spyOn(console,'log')];
    try {
      const {api,requests}=mockApi(failure);const notifier=createProjectNotifier(api,ownerId);
      notifier.confirmDestination(privateContext);
      expect(await notifier.send(project)).toEqual({status:'telegram_error'});
      expect(requests).toHaveLength(1);
      for(const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {vi.restoreAllMocks();}
  });

  it('rejects a project link with a different ID before any API call',async()=>{
    const {api,requests}=mockApi();const notifier=createProjectNotifier(api,ownerId);
    notifier.confirmDestination(privateContext);
    expect(await notifier.send({...project,url:'https://kwork.ru/new_offer?project=9000002'})).toEqual({status:'invalid_project'});
    expect(requests).toEqual([]);
  });
});
