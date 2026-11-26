"""One-time fixed official Suhyup public-board probe; no login or bot credentials."""
import concurrent.futures, html, json, os, pathlib, re, time, urllib.request, urllib.error
from datetime import datetime, timezone

SOURCES = {
    'suhyup_notice_biz': 'https://biz.suhyup-bank.com/ib20/mnu/CBM00334',
    'suhyup_notice_www': 'https://www.suhyup-bank.com/ib20/mnu/PBM00551',
    'suhyup_disclosure_biz': 'https://biz.suhyup-bank.com/ib20/mnu/CBM02846',
    'suhyup_disclosure_www': 'https://www.suhyup-bank.com/ib20/mnu/PBM01753',
}

def records_of(name, text):
    table = re.search(r'<table\b[^>]*\bclass=[\"\']boardList[\"\'][^>]*>([\s\S]*?)</table>', text, re.I)
    if not table:
        raise ValueError('Expected bulletin table absent')
    records = []
    for row in re.findall(r'<tr\b[^>]*>([\s\S]*?)</tr>', table.group(1), re.I):
        notice = name.startswith('suhyup_notice')
        ident = re.search(r'goDetail\(\s*(\d+)\s*\)' if notice else r'movePage\(\s*[\"\'](\d+)[\"\']\s*,\s*[\"\']26[\"\']\s*\)', row)
        if not ident:
            continue
        anchor = re.search(r'<a\b[^>]*onclick=[\"\'][^>]*>([\s\S]*?)</a>', row, re.I)
        date = re.search(r'\b(20\d{2})[-.](\d{2})[-.](\d{2})\b', row)
        if not anchor or not date:
            raise ValueError('Incomplete bulletin row')
        title = ' '.join(html.unescape(re.sub(r'<[^>]*>', ' ', anchor.group(1))).split())
        records.append({'id': ('js:goDetail:' if notice else 'suhyup:26:') + ident.group(1), 'title': title, 'date': '-'.join(date.groups())})
    if not records or len({row['id'] for row in records}) != len(records):
        raise ValueError('Missing or duplicate posts')
    return records

def collect(pair):
    name, url = pair
    started = time.monotonic()
    result = {'source': name, 'url': url, 'startedAt': datetime.now(timezone.utc).isoformat(), 'ok': False}
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; FinanceDisclosureMonitor/1.0)', 'Accept-Language': 'ko-KR,ko;q=0.9'})
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read(2_000_001)
            result.update(status=response.status, bytes=len(body), finalUrl=response.geturl())
            encoding = response.headers.get_content_charset() or 'utf-8'
        if len(body) > 2_000_000:
            raise ValueError('Response too large')
        text = body.decode(encoding)
        records = records_of(name, text)
        result.update(ok=result['status'] == 200, count=len(records), latest3=records[:3])
        pathlib.Path('probe-output', name + '.html').write_text(text, encoding='utf-8')
    except urllib.error.HTTPError as error:
        result.update(status=error.code, error=str(error))
    except Exception as error:
        result['error'] = str(error)[:300]
    result['seconds'] = round(time.monotonic() - started, 2)
    return result

if __name__ == '__main__':
    pathlib.Path('probe-output').mkdir(exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(collect, SOURCES.items()))
    output = json.dumps(results, ensure_ascii=False, indent=2)
    pathlib.Path('probe-output/result.json').write_text(output, encoding='utf-8')
    print(output)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
            summary.write('Suhyup official public-board diagnostic\n\n```json\n' + output + '\n```\n')
