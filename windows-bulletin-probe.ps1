# Fixed public bulletin connectivity test. No credentials, login, or TLS bypass.
param([string]$OutputDirectory = 'probe-output/windows')
$ErrorActionPreference = 'Stop'
$sources = @(
    @{ id='nhbank_notice'; uri='https://www.nhbank.com/goSubPage.do'; method='POST'; body='srchGb=KO_NHMN_14&pageIndex=1&srchWrd=A&srchNo=&searchKeyword='; referer='https://www.nhbank.com/goSubPage.do?srchGb=KO_NHMN_14'; marker='boardType02' },
    @{ id='kfcc_tender'; uri='https://www.kfcc.co.kr/noticeofTender/noticeofTenderList.do'; method='POST'; body='pageNo=1&no=&schCategoryId=&schType=all&schValue='; referer='https://www.kfcc.co.kr/noticeofTender/noticeofTenderList.do'; marker='magazine' },
    @{ id='nhfg_tender'; uri='https://www.nhfngroup.com/user/boardList.do?boardId=5177627&siteId=nhfngroup&command=list&page=1'; method='GET'; referer='https://www.nhfngroup.com/user/indexSub.do?codyMenuSeq=1102093359&siteId=nhfngroup'; marker='board_list' },
    @{ id='nhfg_earnings'; uri='https://www.nhfngroup.com/user/indexSub.do?codyMenuSeq=1219938669&siteId=nhfngroup'; method='GET'; marker='manage-notice' },
    @{ id='kfcc_notice'; uri='https://www.kfcc.co.kr/mgNotice/mgNoticeList.do'; method='GET'; marker='mgnotice' }
)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$outRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outRoot) | Out-Null
$results = @()
foreach ($source in $sources) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $headers = @{ 'Accept-Language'='ko-KR,ko;q=0.9' }
    if ($source.referer) { $headers['Referer'] = $source.referer }
    $request = @{
        Uri=$source.uri; Method=$source.method; Headers=$headers;
        UserAgent='Mozilla/5.0 (compatible; FinanceMonitor/1.0; Google-Apps-Script)';
        TimeoutSec=25; UseBasicParsing=$true; MaximumRedirection=5
    }
    if ($source.body) {
        $request['Body'] = $source.body
        $request['ContentType'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    }
    $result = [ordered]@{
        source=$source.id; url=$source.uri; method=$source.method;
        powershell=$PSVersionTable.PSVersion.ToString(); edition=$PSVersionTable.PSEdition;
        startedUtc=[DateTime]::UtcNow.ToString('o'); status=$null; marker=$source.marker;
        hasExpectedMarker=$false; chars=0; error=$null; seconds=0
    }
    $body = ''
    try {
        $response = Invoke-WebRequest @request
        $result.status = [int]$response.StatusCode
        $body = [string]$response.Content
        $result.hasExpectedMarker = $body.Contains($source.marker)
    } catch {
        $failure = $_
        $result.error = $failure.Exception.Message
        $errorResponse = $failure.Exception.Response
        if ($null -ne $errorResponse) {
            try { $result.status = [int]$errorResponse.StatusCode } catch { }
            try {
                if ($errorResponse.PSObject.Methods.Name -contains 'GetResponseStream') {
                    $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
                    try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
                } elseif ($null -ne $errorResponse.Content) {
                    $body = $errorResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                }
            } catch { }
        }
        if (-not $body -and $failure.ErrorDetails) { $body = [string]$failure.ErrorDetails.Message }
    }
    $watch.Stop()
    $result.seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 2)
    $result.chars = $body.Length
    if ($body.Length -gt 2000000) {
        $result.error = 'Public response exceeded diagnostic size limit.'
        $result.hasExpectedMarker = $false
        $body = $body.Substring(0, 2000000)
    }
    if ($body) {
        [System.IO.File]::WriteAllText((Join-Path $outRoot ($source.id + '.html')), $body, $utf8)
        if ($result.status -ne 200) {
            $excerpt = [regex]::Replace($body, '<[^>]+>', ' ')
            $excerpt = [regex]::Replace($excerpt, '\s+', ' ').Trim()
            $result['publicErrorExcerpt'] = $excerpt.Substring(0, [Math]::Min(350, $excerpt.Length))
        }
    }
    $results += [pscustomobject]$result
    Write-Output ($result | ConvertTo-Json -Depth 5 -Compress)
}
$json = ConvertTo-Json -InputObject $results -Depth 5
[System.IO.File]::WriteAllText((Join-Path $outRoot 'result.json'), $json, $utf8)
# Requests failing are diagnostic results, not script execution failures.

