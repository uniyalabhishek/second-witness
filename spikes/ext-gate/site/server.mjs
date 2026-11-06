// Local test pages. Two listeners: localhost and 127.0.0.1 are different sites, so an iframe across them is out of process.
import { createServer } from 'node:http';
export const WASM = Buffer.from('AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=', 'base64');
const html = b => ['text/html', '<!doctype html><meta charset=utf-8>' + b];
const js = b => ['text/javascript', b];
const routes = {
  '/debugger': html(`<title>dbg</title><script>globalThis.t=0;setInterval(()=>{debugger;globalThis.t++},20)</script><a href=/next id=n>next</a>`),
  '/next': html(`<title>next</title><script src=/next.js></script><script>globalThis.t=0;setInterval(()=>{debugger;globalThis.t++},20)</script>`),
  '/next.js': js(`globalThis.nextLoaded=()=>1;`),
  '/quiet': html(`<title>quiet</title><h1>quiet</h1>`),
  '/all': html(`<title>all</title><script src=/file.js></script><script type=module src=/mod.js></script><script>globalThis.inl=()=>1</script>
    <iframe src="http://CROSS/frame"></iframe><iframe src=/samesite-frame></iframe><iframe srcdoc="<script>globalThis.sd=()=>1</script>"></iframe>
    <script>
      globalThis.ev=eval('(()=>"plain eval")');
      globalThis.ev2=eval('(()=>"named eval")\\n//# sourceURL=https://evil.example/looks-like-a-file.js');
      globalThis.ev3=eval('(()=>"pretends to be an extension")\\n//# sourceURL=chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/inpage.js');
      globalThis.ev4=new Function('return "function ctor"');
      WebAssembly.instantiate(Uint8Array.from(atob('AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags='),c=>c.charCodeAt(0))).then(r=>globalThis.wasm=r);
      globalThis.wk=new Worker('/worker.js');
      globalThis.bw=new Worker(URL.createObjectURL(new Blob(['self.bw=()=>1;onmessage=()=>{};'],{type:'text/javascript'})));
      import(URL.createObjectURL(new Blob(['globalThis.blobmod=()=>1;export default globalThis.blobmod'],{type:'text/javascript'}))).then(m=>globalThis.bm=m);
      import('data:text/javascript,globalThis.datamod=()=>1;export default globalThis.datamod').then(m=>globalThis.dm=m);
      if('serviceWorker' in navigator) navigator.serviceWorker.register('/site-sw.js');
    </script>`),
  '/file.js': js(`globalThis.fileFn=()=>1;`), '/mod.js': js(`globalThis.modFn=()=>1;export default 1;`),
  '/worker.js': js(`self.wfn=()=>1;onmessage=()=>{};`), '/site-sw.js': js(`self.addEventListener('fetch',()=>{});`),
  '/frame': html(`<title>f</title><script src=/frame.js></script><script>globalThis.fi=()=>1</script>`), '/frame.js': js(`globalThis.ff=()=>1;`),
  '/samesite-frame': html(`<script>globalThis.ss=()=>1</script>`),
  // SPA case: real inline, then pushState, then an inline tag built at runtime, then an external file
  '/spa': html(`<title>spa</title><script>globalThis.a=()=>1;history.pushState({},'','/spa/deep?x=1');</script><script>const s=document.createElement('script');s.textContent='globalThis.dyn=()=>"runtime inline"';document.head.append(s);const f=document.createElement('script');f.src='/file.js';document.head.append(f);document.write('<script>globalThis.dw=()=>"document.write inline"<\\/script>');</script>`),
  // nothing retains these scripts once they have run, so V8 may collect them before the button is pressed
  '/gc': html(`<title>gc</title><script src=/oneshot.js></script><script>var x=1+1; /* INLINE-ONESHOT */</script><script>eval('var y=2+2; /* EVAL-ONESHOT */');</script><script src=/retained.js></script>`),
  '/oneshot.js': js(`document.title='oneshot ran'; /* FILE-ONESHOT */`), '/retained.js': js(`globalThis.keep=()=>1; /* RETAINED */`),
};
export function serve(port, host, crossHost) { return new Promise(res => { const srv = createServer((q, s) => { const r = routes[q.url.split('?')[0]];
  if (!r) { s.statusCode = 404; return s.end(); } s.setHeader('content-type', r[0]); s.end(r[1].replaceAll('CROSS', crossHost)); }); srv.listen(port, host, () => res(srv)); }); }
