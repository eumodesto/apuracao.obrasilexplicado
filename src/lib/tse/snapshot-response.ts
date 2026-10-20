import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
/** Full municipal frames must stay within the hosting response limit. */
export function snapshotResponse(request:Request,payload:unknown){
 const text=JSON.stringify(payload);
 const gzip=text.length>32768&&(request.headers.get('accept-encoding')??'').split(',').some(value=>/^\s*gzip\s*(?:;\s*q=(?:1(?:\.0*)?|0\.[1-9]\d*))?\s*$/.test(value));
 const etag='"'+createHash('sha256').update(text).update(gzip?'gzip':'identity').digest('hex')+'"';
 const headers=new Headers({'ETag':etag,'Cache-Control':'private, no-cache','Vary':'Accept-Encoding'});
 if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});
 headers.set('Content-Type','application/json; charset=utf-8');
 if(gzip){headers.set('Content-Encoding','gzip');return new Response(new Uint8Array(gzipSync(text)),{headers});}
 const bytes=new TextEncoder().encode(text);
 if(bytes.length<=4_000_000)return new Response(bytes,{headers});
 let offset=0;
 return new Response(new ReadableStream<Uint8Array>({pull(controller){if(offset===bytes.length){controller.close();return;}const end=Math.min(offset+65536,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;}}),{headers});
}
