import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('out');
const port=Number(process.env.PORT||3000);
const base=process.env.NEXT_PUBLIC_BASE_PATH||'/quantum-battery-xas-lab';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
http.createServer(async(req,res)=>{
 try{
  let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname===base||pathname.startsWith(base+'/'))pathname=pathname.slice(base.length)||'/';
  const target=path.resolve(root,'.'+pathname);
  if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
  let file=target;const info=await stat(file);if(info.isDirectory())file=path.join(file,'index.html');
  const body=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(body);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found. Build the static export with npm run build first.');}
}).listen(port,'127.0.0.1',()=>console.log(`Static laboratory: http://127.0.0.1:${port}${base}/`));
