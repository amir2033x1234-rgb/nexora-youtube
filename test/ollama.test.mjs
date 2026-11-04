import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaProvider } from '../src/ollama.mjs';

test('AI script generation stays unavailable until a local model is named',async()=>{
  const provider=createOllamaProvider({env:{}}); assert.equal(provider.status().status,'MODEL_REQUIRED'); assert.equal(provider.status().paidServicesUsed,false); await assert.rejects(()=>provider.generateScript({topic:'Test'}),/local model/);
});

test('configured local model returns a draft that is marked for fact checking',async()=>{
  let request;
  const provider=createOllamaProvider({env:{NEXORA_OLLAMA_URL:'http://127.0.0.1:11434/',NEXORA_OLLAMA_MODEL:'local-test'},fetchImpl:async(url,options)=>{request={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({response:JSON.stringify({hook:'A useful hook',sections:[{title:'Explain',narration:'Carefully explain',visualIdeas:['Diagram'],sourceNeeded:true}],ending:'Review the evidence',estimatedSeconds:45,factCheckNotes:['Verify the claim']})}),{status:200})}});
  const result=await provider.generateScript({topic:'Water reuse',format:'short',keyPoints:['Use cited data']});
  assert.equal(request.url,'http://127.0.0.1:11434/api/generate'); assert.equal(request.body.model,'local-test'); assert.equal(result.factCheckStatus,'required'); assert.equal(result.sections[0].sourceNeeded,true); assert.match(result.generatedBy,/local Ollama/);
});
