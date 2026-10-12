// Admission describes the exact reconstructed request, not a worker-supplied token estimate.
// Only the recorded profile exists. Live endpoint/tokenizer evidence needs a later reviewed contract.
import { createHash } from 'node:crypto';
import { unwrapOpenRouter } from './openrouter-request';
export function budgetManifest(bytes: Uint8Array, contract: any) {
  const envelope=JSON.parse(Buffer.from(bytes).toString('utf8'));
  const request=envelope?.schema==='reviseit/openrouter-request@1'?unwrapOpenRouter(envelope,contract):envelope;
  if (!request || typeof request!=='object' || Array.isArray(request)
      || Object.keys(request).some(k=>!['model','max_tokens','stream','tools','messages','pins'].includes(k))
      || contract.mode!=='recorded' || request.model!==contract.model || request.stream!==false
      || request.pins?.bundle!==contract.bundle_sha256 || !Number.isSafeInteger(request.max_tokens) || request.max_tokens<1
      || request.max_tokens>contract.max_output_tokens || !Array.isArray(request.messages) || !Array.isArray(request.tools))
    throw new Error('Budget request violates pinned contract');
  let images=0;
  for(const message of request.messages){
    if(!message || !['system','user','assistant','tool'].includes(message.role))throw new Error('Budget request message is invalid');
    if(Object.keys(message).some(k=>!['role','content','tool_calls','tool_call_id'].includes(k))
      || (message.content!==null && typeof message.content!=='string' && !Array.isArray(message.content)))throw new Error('Budget message shape is unsupported');
    if(Array.isArray(message.content))for(const part of message.content){
      if(part?.type==='image_url'){
        if(typeof part.image_url?.url!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(part.image_url.url))throw new Error('Budget image must be an inline pinned PNG');
        images++;
      }else if(part?.type!=='text'||typeof part.text!=='string')throw new Error('Budget content type is unsupported');
    }
  }
  const input=bytes.byteLength+images*contract.image_token_ceiling;
  if(bytes.byteLength<1||bytes.byteLength>contract.max_request_bytes||images>contract.max_images||input>contract.max_input_tokens)throw new Error('Budget request exceeds pinned capability');
  return {requestDigest:createHash('sha256').update(bytes).digest('hex'),contractId:contract.id,bundleDigest:contract.bundle_sha256,
    capabilityDigest:contract.capability_sha256,pricingDigest:contract.pricing_sha256,model:contract.model,endpoint:contract.endpoint,
    requestBytes:bytes.byteLength,imageCount:images,inputTokenBound:input,outputTokens:request.max_tokens};
}
