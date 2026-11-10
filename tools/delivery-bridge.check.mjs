import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDeliveryReader, createHandler, readConfig } from './delivery-bridge.mjs';

const robotId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222';
const stepId='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444';
const otherId='55555555-5555-4555-8555-555555555555';
const config={base:'https://example.invalid',host:'127.0.0.1',port:0,pairingKey:'x'.repeat(40),robotId,robotCode:'test',deviceSecret:'test-secret',username:'test',password:'test',viewerToken:'',origins:['http://localhost:8081']};
function fixture(options={}) {
 let jobReads=0; const calls=[];
 const step={jobStepId:stepId,stepTypeSnapshot:'AUTHENTICATE',stepCodeSnapshot:'AUTH_SENDER',status:'RUNNING',resolvedInputsJson:{method:'QR_CODE',authorization:{token:'DO-NOT-EXPOSE'}},resultJson:{verification_id:'DO-NOT-EXPOSE'}};
 const job={jobId,robotId,serviceRequestId:requestId,status:'RUNNING',selectedJobStepId:stepId};
 const delivery={request:{serviceRequestId:requestId,requestType:'DELIVERY',status:'IN_PROGRESS'},expectedSenderAccountId:otherId,expectedReceiverAccountId:otherId,items:[{itemName:'Private cargo',sensitive:true,quantity:1}],pickedUpAt:null,deliveredAt:null};
 const qr={jobId,authJobStepId:stepId,challengeId:otherId,purpose:'DELIVERY_SENDER',qrPayload:'MARQR1.test.not-valid-for-real-use',expiresAt:new Date(Date.now()+60000).toISOString()};
 const fetcher=async(url,init)=>{
  const u=new URL(url);calls.push({path:u.pathname,method:init.method});
  const reply=(value,status=200)=>new Response(status===204?null:JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  if(u.pathname.endsWith('/auth/login'))return reply({accessToken:'viewer-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString()});
  if(u.pathname.endsWith('/auth/me'))return reply({role:'STAFF',status:'ACTIVE',mustChangePassword:false});
  if(u.pathname.endsWith('/pi/auth/token'))return reply({accessToken:'device-token',robotId:options.wrongDevice?otherId:robotId,expiresAt:new Date(Date.now()+3600000).toISOString()});
  if(u.pathname.endsWith('/jobs'))return reply({content:u.searchParams.get('status')==='RUNNING'?[job,...(options.ambiguous?[{...job,jobId:otherId}]:[])]:[],totalPages:1});
  if(u.pathname.includes('/delivery-requests/'))return reply(delivery);
  if(u.pathname.endsWith('/qr-challenge'))return options.noQr?reply(null,204):reply({...qr,...options.qr});
  if(u.pathname.includes('/jobs/')){jobReads++;return reply({job:{...job,...options.job,...(options.race&&jobReads>1?{cancelRequestedAt:'now'}:{})},steps:[step]});}
  throw Error('Unexpected route '+u.pathname);
 };
 return {fetcher,calls,job,step,delivery,qr};
}
test('aggregate uses actual account/device reads and strips execution secrets',async()=>{
 const f=fixture();const reader=createDeliveryReader(config,f.fetcher);const result=await reader.snapshot();
 assert.equal(result.robotId,robotId);assert.equal(result.mission.jobId,jobId);assert.equal(result.challenge.authJobStepId,stepId);
 assert.equal(result.mission.step.resolvedInputsJson.purpose,'DELIVERY_SENDER');
 assert.equal(result.mission.items[0].itemName,'Hàng cần bảo mật');
 assert.equal(JSON.stringify(result).includes('DO-NOT-EXPOSE'),false);
 assert.deepEqual(f.calls.filter(x=>x.method==='POST').map(x=>x.path).sort(),['/api/v1/auth/login','/api/v1/pi/auth/token']);
});
test('device identity mismatch and cross-robot job cannot leak QR',async()=>{
 await assert.rejects(createDeliveryReader(config,fixture({wrongDevice:true}).fetcher).snapshot(jobId),e=>e.code==='DEVICE_SCOPE');
 await assert.rejects(createDeliveryReader(config,fixture({job:{robotId:otherId}}).fetcher).snapshot(jobId),e=>e.code==='JOB_SCOPE');
});
test('204 and expired challenge are no QR; never renewed by the bridge',async()=>{
 assert.equal((await createDeliveryReader(config,fixture({noQr:true}).fetcher).snapshot(jobId)).challenge,null);
 const f=fixture({qr:{expiresAt:new Date(0).toISOString()}});
 assert.equal((await createDeliveryReader(config,f.fetcher).snapshot(jobId)).challenge,null);
 assert.equal(f.calls.some(x=>x.path.endsWith('/qr-challenges')),false);
});
test('wrong step/purpose blocks a challenge',async()=>{
 for(const qr of [{authJobStepId:otherId},{purpose:'DELIVERY_RECEIVER'}]){
  await assert.rejects(createDeliveryReader(config,fixture({qr}).fetcher).snapshot(jobId),e=>e.code==='QR_SCOPE');
 }
});
test('cancellation during QR fetch suppresses display',async()=>{
 assert.equal((await createDeliveryReader(config,fixture({race:true}).fetcher).snapshot(jobId)).challenge,null);
});
test('ambiguous active robot jobs are not guessed',async()=>{
 await assert.rejects(createDeliveryReader(config,fixture({ambiguous:true}).fetcher).snapshot(),e=>e.code==='AMBIGUOUS_JOB');
});
test('concurrent reads coalesce and terminal state remains visible',async()=>{
 const f=fixture();const reader=createDeliveryReader(config,f.fetcher);let time=Date.now();
 const [a,b]=await Promise.all([reader.snapshot(jobId),reader.snapshot(jobId)]);
 assert.deepEqual(a,b);assert.equal(f.calls.filter(x=>x.path==='/api/v1/auth/login').length,1);
 const g=fixture();const tracked=createDeliveryReader(config,g.fetcher,()=>time);
 await tracked.snapshot();g.job.status='SUCCEEDED';g.delivery.request.status='COMPLETED';g.delivery.deliveredAt=new Date().toISOString();time+=2000;
 const last=await tracked.snapshot();assert.equal(last.mission.jobStatus,'SUCCEEDED');assert.equal(last.challenge,null);
});
test('old cached challenge expires even before cache timeout',async()=>{
 let time=Date.now();const f=fixture({qr:{expiresAt:new Date(time+100).toISOString()}});
 const reader=createDeliveryReader(config,f.fetcher,()=>time);
 assert.ok((await reader.snapshot(jobId)).challenge);time+=200;
 assert.equal((await reader.snapshot(jobId)).challenge,null);
});
test('configuration enforces private credentials and deliberate LAN binding',()=>{
 assert.throws(()=>readConfig({}),e=>e.code==='CONFIG');
 const env={MAR_ROBOT_ID:robotId,MAR_ROBOT_CODE:'r',MAR_DEVICE_SECRET:'s',MAR_VIEWER_USERNAME:'u',MAR_VIEWER_PASSWORD:'p',MAR_DELIVERY_PAIRING_KEY:'k'.repeat(40)};
 assert.equal(readConfig(env).host,'127.0.0.1');
 assert.throws(()=>readConfig({...env,MAR_DELIVERY_HOST:'0.0.0.0'}));
 assert.equal(readConfig({...env,MAR_DELIVERY_HOST:'0.0.0.0',MAR_DELIVERY_ALLOW_LAN_HTTP:'true'}).host,'0.0.0.0');
 assert.throws(()=>readConfig({...env,MAR_BACKEND_URL:'https://host.invalid/proxy?token=x'}));
});
test('HTTP pairing, origin and route allowlist protect a read-only snapshot',async t=>{
 let reads=0;
 const server=http.createServer(createHandler(config,{snapshot:async()=>{reads++;return {mission:null,challenge:null,robotId};}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(url+'/health')).status,200);
 assert.equal((await fetch(url+'/delivery/snapshot')).status,401);
 assert.equal((await fetch(url+'/delivery/snapshot',{headers:{'X-MAR-Display-Key':config.pairingKey,Origin:'https://untrusted.invalid'}})).status,403);
 assert.equal((await fetch(url+'/delivery/snapshot',{method:'POST',headers:{'X-MAR-Display-Key':config.pairingKey}})).status,405);
 assert.equal((await fetch(url+'/delivery/snapshot?url=https://bad.invalid',{headers:{'X-MAR-Display-Key':config.pairingKey}})).status,400);
 const response=await fetch(url+'/delivery/snapshot',{headers:{'X-MAR-Display-Key':config.pairingKey}});
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(reads,1);
});
