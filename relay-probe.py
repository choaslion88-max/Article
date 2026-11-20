"""One-time public bulletin connectivity test; no login or bot credentials."""
import concurrent.futures, json, pathlib, time, urllib.request, urllib.error

SOURCES = {
    'nhbank_notice': 'https://www.nhbank.com/goSubPage.do?srchGb=KO_NHMN_14',
    'kfcc_tender': 'https://www.kfcc.co.kr/noticeofTender/noticeofTenderList.do',
    'nhfg_tender': 'https://www.nhfngroup.com/user/boardList.do?boardId=5177627&siteId=nhfngroup&command=list&page=1',
}
def collect(pair):
    name, url = pair
    started = time.monotonic()
    result = {'source': name, 'url': url}
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; FinanceDisclosureMonitor/1.0)', 'Accept-Language': 'ko-KR,ko;q=0.9'})
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read(2_000_001)
            result.update(status=response.status, bytes=len(body))
        if len(body)>2_000_000: raise ValueError('Response too large')
        pathlib.Path('probe-output',name+'.html').write_bytes(body)
    except urllib.error.HTTPError as error:
        result.update(status=error.code,error=str(error))
    except Exception as error:
        result['error']=str(error)
    result['seconds']=round(time.monotonic()-started,2)
    return result

pathlib.Path('probe-output').mkdir(exist_ok=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results=list(pool.map(collect,SOURCES.items()))
pathlib.Path('probe-output/result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))

