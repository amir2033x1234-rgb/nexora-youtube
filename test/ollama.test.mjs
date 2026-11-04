import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaProvider } from '../src/ollama.mjs';

test('AI script generation stays unavailable until a model is explicitly configured',async()=>{
  const provider=createOllamaProvider({env:{}}); assert.equal(provider.status().status,'MODEL_REQUIRED'); assert.equal(provider.status().paidServicesUsed,false); await assert.rejects(()=>provider.generateScript({topic:'Test'}),/disabled/);
});

test('laptop and loopback model processing are blocked by policy',async()=>{
  let called=false;const provider=createOllamaProvider({env:{NEXORA_OLLAMA_URL:'http://127.0.0.1:11434',NEXORA_OLLAMA_MODEL:'local-test'},fetchImpl:async()=>{called=true}});
  assert.equal(provider.status().status,'PROVIDER_REQUIRED');await assert.rejects(()=>provider.generateScript({topic:'Test'}),/Laptop and loopback/);assert.equal(called,false);
});

test('approved remote HTTPS model endpoint returns a draft marked for fact checking',async()=>{
  let request;
  const provider=createOllamaProvider({env:{NEXORA_OLLAMA_URL:'https://models.example.net/',NEXORA_OLLAMA_MODEL:'zero-cost-model'},fetchImpl:async(url,options)=>{request={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({response:JSON.stringify({hook:'A useful hook',sections:[{title:'Explain',narration:'Carefully explain',visualIdeas:['Diagram'],sourceNeeded:true}],ending:'Review the evidence',estimatedSeconds:45,factCheckNotes:['Verify the claim']})}),{status:200})}});
  const result=await provider.generateScript({topic:'Water reuse',format:'short',keyPoints:['Use cited data']});
  assert.equal(request.url,'https://models.example.net/api/generate'); assert.equal(request.body.model,'zero-cost-model'); assert.equal(result.factCheckStatus,'required'); assert.equal(result.sections[0].sourceNeeded,true); assert.match(result.generatedBy,/Ollama-compatible/);
});
