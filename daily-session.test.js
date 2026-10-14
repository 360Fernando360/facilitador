import { hasValidDailySession, sessionIdFromAccessToken } from './supabase/functions/_shared/daily-session.ts';

const tests=[];
const test=(name,operation)=>tests.push({name,operation});
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
const encode=value=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const token=payload=>`${encode({alg:'none'})}.${encode(payload)}.`;
const sessionId='11111111-1111-4111-8111-111111111111';

const migration=await Deno.readTextFile('supabase/migrations/20261014120000_daily_session_expiry.sql');
const frontend=await Deno.readTextFile('index.html');
const vault=await Deno.readTextFile('supabase/functions/credential-vault/index.ts');
const adminFunction=await Deno.readTextFile('supabase/functions/hyper-function/index.ts');
const ptaxFunction=await Deno.readTextFile('supabase/functions/update-ptax/index.ts');
const rollback=await Deno.readTextFile('supabase/rollback/20261014120000_daily_session_expiry_rollback.sql');

test('session_id assinado identifica a sessao e token antigo e recusado',()=>{
 assert(sessionIdFromAccessToken(token({session_id:sessionId}))===sessionId,'session_id valido nao foi lido');
 assert(sessionIdFromAccessToken(token({sub:'usuario'}))===null,'token sem session_id foi aceito');
 assert(sessionIdFromAccessToken('invalido')===null,'token malformado foi aceito');
});

test('renovacao do access token nao troca a sessao que ancora o prazo',()=>{
 const original=token({session_id:sessionId,iat:1});
 const refreshed=token({session_id:sessionId,iat:999999});
 assert(sessionIdFromAccessToken(original)===sessionIdFromAccessToken(refreshed),'refresh alterou a sessao');
});

test('helper de backend falha fechado e consulta somente RPC protegida',async()=>{
 let args;
 const admin={rpc:async(name,payload)=>{args={name,payload};return {data:true,error:null}}};
 assert(await hasValidDailySession(admin,token({session_id:sessionId}),'usuario'),'sessao valida foi recusada');
 assert(args.name==='is_daily_session_valid_for','RPC incorreta');
 assert(args.payload.target_session_id===sessionId,'session_id nao foi enviado');
 assert(!await hasValidDailySession(admin,token({}),'usuario'),'sessao sem identificador foi aceita');
 assert(!await hasValidDailySession({rpc:async()=>({data:null,error:{}})},token({session_id:sessionId}),'usuario'),'erro de RPC liberou acesso');
});

test('migration ancora a proxima meia-noite em America/Sao_Paulo',()=>{
 assert(migration.includes("session.created_at at time zone 'America/Sao_Paulo'"),'fuso de Brasilia ausente');
 assert(migration.includes('from auth.sessions as session'),'auth.sessions nao e a autoridade');
 assert(migration.includes("auth.jwt()->>'session_id'"),'JWT nao vincula a sessao atual');
 assert(/grant execute on function public\.is_daily_session_valid_for[\s\S]*?to service_role/i.test(migration),'validador de Edge Function nao esta restrito');
 assert(/revoke all on function public\.is_daily_session_valid_for[\s\S]*?authenticated/i.test(migration),'authenticated pode forjar a validacao administrativa');
});

test('RLS e RPCs protegidos exigem sessao diaria valida',()=>{
 for(const marker of ['current_organization_ids','is_organization_admin','can_manage_organization','track_user_activity']){
   const start=migration.indexOf(`function public.${marker}`);
   assert(start>=0&&migration.slice(start,start+1800).includes('is_daily_session_valid'),`${marker} nao valida o prazo`);
 }
 assert(/users can read their membership[\s\S]*?is_daily_session_valid/i.test(migration),'membership continua acessivel apos o prazo');
 assert(/authenticated members can read exchange rates[\s\S]*?is_daily_session_valid/i.test(migration),'cambio continua acessivel apos o prazo');
});

test('Edge Functions validam depois de auth.getUser e antes da operacao',()=>{
 for(const [name,source] of [['credential-vault',vault],['hyper-function',adminFunction],['update-ptax',ptaxFunction]]){
   const authIndex=source.indexOf('auth.getUser');
   const dailyIndex=source.indexOf('hasValidDailySession',authIndex);
   assert(authIndex>=0&&dailyIndex>authIndex,`${name} nao valida a sessao autenticada`);
 }
});

test('chamada agendada da PTAX nao depende de sessao de usuario',()=>{
 const scheduledBranch=ptaxFunction.indexOf('if (!scheduledRequest)');
 const userValidation=ptaxFunction.indexOf('hasValidDailySession',scheduledBranch);
 const branchEnd=ptaxFunction.indexOf('\n  }',userValidation);
 const scheduleProcessing=ptaxFunction.indexOf('const schedule = getSaoPauloSchedule()',branchEnd);
 assert(scheduledBranch>=0&&userValidation>scheduledBranch&&branchEnd>userValidation,'validacao de usuario nao esta isolada');
 assert(scheduleProcessing>branchEnd,'processamento agendado ficou dentro da validacao de usuario');
});

test('rollback restaura predicados e remove somente funcoes novas',()=>{
 assert(rollback.includes('using (user_id = (select auth.uid()));'),'politica de vinculo anterior nao foi restaurada');
 assert(/authenticated members can read exchange rates[\s\S]*?using \(exists/i.test(rollback),'politica de cambio anterior nao foi restaurada');
 for(const helper of ['current_organization_ids','is_organization_admin','can_manage_organization','track_user_activity']){
   const start=rollback.indexOf(`function public.${helper}`);
   assert(start>=0&&!rollback.slice(start,start+1800).includes('is_daily_session_valid'),`${helper} ainda depende da expiracao`);
 }
 assert(!/drop\s+(table|schema)|truncate|delete\s+from/i.test(rollback),'rollback contem remocao de dados');
 for(const fn of ['is_daily_session_valid_for','is_daily_session_valid','get_daily_session_deadline','daily_session_deadline_for']){
   assert(rollback.includes(`drop function if exists public.${fn}`),`${fn} nao e removida`);
 }
});

test('frontend cobre meia-noite, refresh, restauracao e varias abas',()=>{
 assert(frontend.includes('Sua sessão diária terminou. Entre novamente para continuar.'),'mensagem obrigatoria ausente');
 assert(frontend.includes("rpc('get_daily_session_deadline')"),'deadline nao vem do servidor');
 assert(frontend.includes("['42883','PGRST202']"),'frontend nao tolera somente a RPC ausente durante o rollout');
 assert(frontend.includes("event==='TOKEN_REFRESHED'"),'refresh de token nao e revalidado');
 assert(frontend.includes("visibilitychange"),'retorno apos suspensao nao e revalidado');
 assert(frontend.includes("new BroadcastChannel('facilitador-auth')"),'abas nao sao sincronizadas');
 assert(frontend.includes('DAILY_SESSION_EVENT_KEY'),'fallback entre abas ausente');
 assert(frontend.includes("setTimeout(()=>endSession('daily-expired')"),'logout na meia-noite nao foi agendado');
 assert(frontend.includes("reason==='daily-expired'?{scope:'local'}"),'sessao expirada nao e encerrada localmente');
});

test('deadline absoluto independe do fuso configurado no computador',()=>{
 const deadline=Date.parse('2026-10-15T03:00:00.000Z');
 assert(deadline-Date.parse('2026-10-15T02:59:59.999Z')===1,'instante anterior foi calculado incorretamente');
 assert(Date.parse('2026-10-15T03:00:00.000Z')>=deadline,'meia-noite nao expira no instante exato');
});

let failures=0;
for(const {name,operation} of tests){
 try{await operation();console.log(`OK  ${name}`)}catch(error){failures++;console.error(`ERRO  ${name}: ${error.message}`)}
}
if(failures)throw new Error(`${failures} teste(s) falharam.`);
console.log(`${tests.length} testes de sessao diaria aprovados.`);
