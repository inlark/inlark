# Install the current Windows 64-bit English release published by Certum.
# Using the supported download page avoids installing an old version whose
# update dialog can intercept the automated login's keystrokes.
$ErrorActionPreference = 'Stop'

$downloadPage = 'https://support.certum.eu/en/software/procertum-smartsign/'
$tempDirectory = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$installerPath = Join-Path $tempDirectory 'SimplySignDesktop.msi'
$logPath = Join-Path $tempDirectory 'simplysign-install.log'
$exePath = 'C:\Program Files\Certum\SimplySign Desktop\SimplySignDesktop.exe'

Write-Host "Finding the latest SimplySign Desktop installer on $downloadPage"
$page = Invoke-WebRequest -Uri $downloadPage -UseBasicParsing -TimeoutSec 60

# Only accept the English x64 MSI on Certum's own HTTPS download host, with
# matching versions in the directory and filename. Ignore EXEs and 32-bit MSIs.
$installerPattern = 'https://files\.certum\.eu/software/SimplySignDesktop/Windows/(?<version>\d+\.\d+\.\d+\.\d+)/SimplySignDesktop-\k<version>-64-bit-en\.msi'
$installers = @([regex]::Matches($page.Content, $installerPattern) |
    Sort-Object { [version]$_.Groups['version'].Value } -Descending)
if ($installers.Count -eq 0) {
    throw "Certum's download page did not contain a Windows 64-bit English SimplySign MSI: $downloadPage"
}
$installerUrl = $installers[0].Value
$installerVersion = $installers[0].Groups['version'].Value
Write-Host "Downloading SimplySign Desktop $installerVersion from $installerUrl"
Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing -TimeoutSec 600

# A pinned SHA-256 would prevent automatic updates. Instead require Windows
# to validate the Authenticode signature and check Certum's software publisher.
$signature = Get-AuthenticodeSignature -LiteralPath $installerPath
if ($signature.Status -ne 'Valid') {
    throw "SimplySign installer signature is not valid: $($signature.Status) ($($signature.StatusMessage))"
}
$publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
if ($publisher -ne 'Asseco Data Systems S.A.') {
    throw "Unexpected SimplySign installer publisher: $publisher"
}
Write-Host "Verified installer signature from $publisher"
Write-Host "Installer SHA-256: $((Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash)"

# Use the same silent installation options as the original BlinkDisk setup,
# but check the actual installer exit code rather than log text or directory existence.
Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
Write-Host "Installing SimplySign Desktop $installerVersion"
$arguments = "/i `"$installerPath`" /quiet /norestart /l*v `"$logPath`" ALLUSERS=1 REBOOT=ReallySuppress"
$installer = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -PassThru
if ($installer.ExitCode -notin @(0, 3010)) {
    if (Test-Path -LiteralPath $logPath) {
        Get-Content -LiteralPath $logPath -Tail 20 | Write-Host
    }
    throw "SimplySign installation failed with exit code $($installer.ExitCode). Installer log: $logPath"
}
if (-not (Test-Path -LiteralPath $exePath)) {
    throw "SimplySign installation completed but the executable was not found: $exePath"
}
Write-Host "SimplySign Desktop installed: $((Get-Item -LiteralPath $exePath).VersionInfo.FileVersion)"
