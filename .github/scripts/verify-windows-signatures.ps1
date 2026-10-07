param(
    [string]$CertificateSha1 = $env:CERTUM_CERTIFICATE_SHA1,
    [string]$ReleaseDirectory = 'apps/desktop/release'
)

$ErrorActionPreference = 'Stop'
$CertificateSha1 = ($CertificateSha1 -replace '\s', '').ToUpperInvariant()
if ($CertificateSha1 -notmatch '^[A-F0-9]{40}$') {
    throw 'CERTUM_CERTIFICATE_SHA1 must be the 40-character SHA-1 certificate thumbprint'
}

$app = Join-Path $ReleaseDirectory 'win-unpacked/inlark.exe'
if (-not (Test-Path -LiteralPath $app -PathType Leaf)) {
    throw "Packaged Windows app not found: $app"
}
$installers = @(Get-ChildItem -LiteralPath $ReleaseDirectory -Filter '*-setup.exe' -File)
if ($installers.Count -ne 1) {
    throw "Expected one Windows installer, found $($installers.Count)"
}

foreach ($file in @($app, $installers[0].FullName)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid') {
        throw "Invalid Windows signature on ${file}: $($signature.Status)"
    }
    if ($signature.SignerCertificate.Thumbprint -ne $CertificateSha1) {
        throw "Unexpected signing certificate on $file"
    }
    if (-not $signature.TimeStamperCertificate) {
        throw "Missing signing timestamp on $file"
    }
    Write-Host "Verified Certum signature and timestamp: $file"
}
