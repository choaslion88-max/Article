// One-time, fixed public-page diagnostic. Fresh Chrome contexts, no login,
// credentials, stealth patches, CAPTCHA actions, certificate or sandbox bypass.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const output='probe-output/chrome';
const sources=Object.freeze([
  {id:'suhyup_notice_biz',url:'https://biz.suhyup-bank.com/ib20/mnu/CBM00334',selector:'table.boardList tbody tr'},
  {id:'suhyup_notice_www',url:'https://www.suhyup-bank.com/ib20/mnu/PBM00551',selector:'table.boardList tbody tr'},
  {id:'suhyup_disclosure_biz',url:'https://biz.suhyup-bank.com/ib20/mnu/CBM02846',selector:'table.boardList tbody tr'},
  {id:'suhyup_disclosure_www',url:'https://www.suhyup-bank.com/ib20/mnu/PBM01753',selector:'table.boardList tbody tr'}
]);
const safeError=error=>String(error?.message||error).split('\n')[0].replace(/https?:\/\/\S+/g,'[official URL]').slice(0,250);
await mkdir(output,{recursive:true});
const results=[];
let browser;
try {
  // Standard ubuntu-24.04 GitHub images already include vendor Google Chrome.
  // Keep Chromium's sandbox enabled. If it cannot start, report that failure.
  browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true,timeout:20000});
  console.log(JSON.stringify({browser:browser.version(),transport:'Chrome public page navigation',certificatesVerified:true,sandboxEnabled:true}));
  for(const source of sources) {
    const started=Date.now(),origin=new URL(source.url).origin;
    const result={source:source.id,url:source.url,startedUtc:new Date().toISOString(),status:null,
      protocol:null,tlsProtocol:null,mainRequestFailure:null,structureVerified:false,count:0,error:null};
    const context=await browser.newContext({ignoreHTTPSErrors:false,acceptDownloads:false,
      serviceWorkers:'block',locale:'ko-KR',viewport:{width:1280,height:900}});
    const page=await context.newPage();
    // Allow this official origin's public assets. Never follow navigation to a
    // login, challenge, other domain or another path. No form submissions.
    await context.route('**/*',async route=>{
      const request=route.request();let url;
      try {url=new URL(request.url());}catch {return route.abort('blockedbyclient');}
      if(url.origin!==origin)return route.abort('blockedbyclient');
      if(request.isNavigationRequest()&&request.frame()===page.mainFrame()&&url.href!==source.url)
        return route.abort('blockedbyclient');
      return route.continue();
    });
    page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
    page.on('requestfailed',request=>{
      if(request.isNavigationRequest()&&request.url()===source.url)
        result.mainRequestFailure=request.failure()?.errorText||'unknown';
    });
    const session=await context.newCDPSession(page);
    await session.send('Network.enable');
    session.on('Network.responseReceived',event=>{
      if(event.type!=='Document'||event.response.url!==source.url)return;
      result.status=event.response.status;
      result.protocol=event.response.protocol||null;
      result.tlsProtocol=event.response.securityDetails?.protocol||null;
      if(event.response.timing) {
        const t=event.response.timing;
        result.connectionTiming={dnsStart:t.dnsStart,dnsEnd:t.dnsEnd,connectStart:t.connectStart,
          connectEnd:t.connectEnd,sslStart:t.sslStart,sslEnd:t.sslEnd,receiveHeadersEnd:t.receiveHeadersEnd};
      }
    });
    // Close the isolated context if a browser command hangs beyond the bound.
    const deadline=setTimeout(()=>context.close().catch(()=>{}),35000);
    try {
      const response=await page.goto(source.url,{waitUntil:'domcontentloaded',timeout:25000});
      result.status=response?.status()??result.status;
      result.title=await page.title();
      if(result.status!==200)throw Error('Official document HTTP '+result.status);
      await page.locator(source.selector).first().waitFor({state:'attached',timeout:4000});
      const records=await page.evaluate(({id,selector})=>{
        const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
        return [...document.querySelectorAll(selector)].map(row=>{
          const anchor=row.querySelector('.alignLeft a[onclick]');
          const onclick=anchor?.getAttribute('onclick')||'';
          const notice=id.startsWith('suhyup_notice');
          const match=notice?/goDetail\(\s*(\d+)\s*\)/.exec(onclick):/movePage\(\s*['"](\d+)['"]\s*,\s*['"]26['"]\s*\)/.exec(onclick);
          const date=[...row.querySelectorAll('td')].map(cell=>clean(cell.textContent))
            .find(text=>/^20\d{2}[.\-/]\d{2}[.\-/]\d{2}$/.test(text))||'';
          return {id:match?((notice?'js:goDetail:':'suhyup:26:')+match[1]):null,title:clean(anchor?.textContent),date};
        });
      },source);
      result.count=records.length;
      result.structureVerified=records.length>0&&records.every(record=>record.id&&record.title&&/^20\d{2}[.\-/]\d{2}[.\-/]\d{2}$/.test(record.date));
      if(!result.structureVerified)throw Error('Expected public list absent or malformed; no interaction attempted');
      result.records=records;
      const html=await page.content();
      if(Buffer.byteLength(html,'utf8')>2000000)throw Error('Rendered public HTML exceeds 2MB');
      await writeFile(output+'/'+source.id+'.html',html,'utf8');
      result.htmlSaved=true;
    }catch(error) {
      result.error=safeError(error);
      result.structureVerified=false;
    }finally {
      clearTimeout(deadline);
      await context.close().catch(()=>{});
      result.seconds=Number(((Date.now()-started)/1000).toFixed(2));
      results.push(result);
      console.log(JSON.stringify(result));
      await writeFile(output+'/result.json',JSON.stringify(results,null,2),'utf8');
    }
  }
}catch(error) {
  console.error(JSON.stringify({infrastructureError:safeError(error)}));
  await writeFile(output+'/infrastructure-error.json',JSON.stringify({error:safeError(error)}),'utf8');
  process.exitCode=1;
}finally {
  if(browser)await browser.close().catch(()=>{});
}
// Source connection failures are data, not a false claim that the probe crashed.

