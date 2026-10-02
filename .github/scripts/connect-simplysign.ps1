# Connect-SimplySign-Enhanced.ps1
# Ported from blinkdisk/blinkdisk .github/scripts/connect-simplysign.ps1.
# Registry-Enhanced TOTP Authentication for SimplySign Desktop
# Uses registry pre-configuration + TOTP credential injection approach
# Based on Devas.life article: https://www.devas.life/how-to-automate-signing-your-windows-app-with-certum/

param(
    [string]$OtpUri = $env:CERTUM_OTP_URI,
    [string]$UserId = $env:CERTUM_USERNAME,
    [string]$ExePath = $env:CERTUM_EXE_PATH,
    [string]$CertificateSha1 = $env:CERTUM_CERTIFICATE_SHA1
)

$ErrorActionPreference = 'Stop'

# Validate required parameters
if (-not $OtpUri) {
    Write-Host "ERROR: CERTUM_OTP_URI environment variable not provided"
    exit 1
}

if (-not $UserId) {
    Write-Host "ERROR: CERTUM_USERNAME environment variable not provided"
    exit 1
}

$CertificateSha1 = ($CertificateSha1 -replace '\s', '').ToUpperInvariant()
if ($CertificateSha1 -notmatch '^[A-F0-9]{40}$') {
    throw 'CERTUM_CERTIFICATE_SHA1 must be the 40-character SHA-1 certificate thumbprint'
}

if (-not $ExePath) {
    $ExePath = "C:\Program Files\Certum\SimplySign Desktop\SimplySignDesktop.exe"
}

Write-Host "=== REGISTRY-ENHANCED TOTP AUTHENTICATION ==="
Write-Host "Using registry pre-configuration + credential injection"
Write-Host "Executable: $ExePath"
Write-Host ""

# Verify SimplySign Desktop exists
if (-not (Test-Path $ExePath)) {
    Write-Host "ERROR: SimplySign Desktop not found at: $ExePath"
    exit 1
}

# Parse the otpauth:// URI
$uri = [Uri]$OtpUri
if ($uri.Scheme -ne 'otpauth' -or $uri.Host -ne 'totp') {
    throw 'CERTUM_OTP_URI must be an otpauth://totp URI'
}

# Parse query parameters (compatible with both PowerShell 5.1 and 7+)
try {
    $q = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
} catch {
    $q = @{}
    foreach ($part in $uri.Query.TrimStart('?') -split '&') {
        $kv = $part -split '=', 2
        if ($kv.Count -eq 2) {
            $q[$kv[0]] = [Uri]::UnescapeDataString($kv[1])
        }
    }
}

$Base32 = $q['secret']
$Digits = if ($q['digits']) { [int]$q['digits'] } else { 6 }
$Period = if ($q['period']) { [int]$q['period'] } else { 30 }
$Algorithm = if ($q['algorithm']) { $q['algorithm'].ToUpper() } else { 'SHA256' }
if (-not $Base32 -or $Digits -lt 6 -or $Digits -gt 8 -or $Period -le 0) {
    throw 'CERTUM_OTP_URI must contain a secret and valid TOTP digits and period'
}

# Validate supported algorithms
$SupportedAlgorithms = @('SHA1', 'SHA256', 'SHA512')
if ($Algorithm -notin $SupportedAlgorithms) {
    Write-Host "ERROR: Unsupported algorithm: $Algorithm. Supported: $($SupportedAlgorithms -join ', ')"
    exit 1
}

# TOTP Generator (inline C# implementation)
Add-Type -Language CSharp @"
using System;
using System.Security.Cryptography;

public static class Totp
{
    private const string B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    private static byte[] Base32Decode(string s)
    {
        s = s.TrimEnd('=').ToUpperInvariant();
        int byteCount = s.Length * 5 / 8;
        byte[] bytes = new byte[byteCount];

        int bitBuffer = 0, bitsLeft = 0, idx = 0;
        foreach (char c in s)
        {
            int val = B32.IndexOf(c);
            if (val < 0) throw new ArgumentException("Invalid Base32 char: " + c);

            bitBuffer = (bitBuffer << 5) | val;
            bitsLeft += 5;

            if (bitsLeft >= 8)
            {
                bytes[idx++] = (byte)(bitBuffer >> (bitsLeft - 8));
                bitsLeft -= 8;
            }
        }
        return bytes;
    }

    private static HMAC GetHmacAlgorithm(string algorithm, byte[] key)
    {
        switch (algorithm.ToUpper())
        {
            case "SHA1":
                return new HMACSHA1(key);
            case "SHA256":
                return new HMACSHA256(key);
            case "SHA512":
                return new HMACSHA512(key);
            default:
                throw new ArgumentException("Unsupported algorithm: " + algorithm);
        }
    }

    public static string Now(string secret, int digits, int period, string algorithm = "SHA256")
    {
        byte[] key = Base32Decode(secret);
        long counter = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / period;

        byte[] cnt = BitConverter.GetBytes(counter);
        if (BitConverter.IsLittleEndian) Array.Reverse(cnt);

        byte[] hash;
        using (var hmac = GetHmacAlgorithm(algorithm, key))
        {
            hash = hmac.ComputeHash(cnt);
        }

        int offset = hash[hash.Length - 1] & 0x0F;
        int binary =
            ((hash[offset] & 0x7F) << 24) |
            ((hash[offset + 1] & 0xFF) << 16) |
            ((hash[offset + 2] & 0xFF) << 8) |
            (hash[offset + 3] & 0xFF);

        int otp = binary % (int)Math.Pow(10, digits);
        return otp.ToString(new string('0', digits));
    }
}
"@

function Get-TotpCode {
    param([string]$Secret, [int]$Digits = 6, [int]$Period = 30, [string]$Algorithm = 'SHA256')
    [Totp]::Now($Secret, $Digits, $Period, $Algorithm)
}

if ($existing = Get-Process -Name "SimplySignDesktop" -ea Ignore) {
   Write-Host "Killing existing SimplySign Desktop process..."
   $existing.Kill()
}


# Launch SimplySign Desktop (registry should auto-open login dialog)
Write-Host "Launching SimplySign Desktop..."
Write-Host "Registry pre-configuration should auto-open login dialog"
$proc = Start-Process -FilePath $ExePath -PassThru
Write-Host "Process started with ID: $($proc.Id)"
Write-Host ""

# Wait for the application to initialize
Write-Host "Waiting for SimplySign Desktop to initialize..."
Start-Sleep -Seconds 3

# Create WScript.Shell for window interaction
$wshell = New-Object -ComObject WScript.Shell

# Try to focus the SimplySign Desktop window
Write-Host "Attempting to focus SimplySign Desktop window..."
$focused = $false

# Method 1: Focus by process ID (most reliable)
$focused = $wshell.AppActivate($proc.Id)

# Method 2: Focus by window title (fallback)
if (-not $focused) {
    $focused = $wshell.AppActivate('SimplySign Desktop')
}

# Method 3: Multiple attempts with slight delays
for ($i = 0; (-not $focused) -and ($i -lt 10); $i++) {
    Start-Sleep -Milliseconds 500
    $focused = $wshell.AppActivate($proc.Id) -or $wshell.AppActivate('SimplySign Desktop')
    Write-Host "Focus attempt $($i + 1): $focused"
}

if (-not $focused) {
    Write-Host "ERROR: Could not bring SimplySign Desktop to foreground"
    Write-Host "Login dialog may not be visible for credential injection"
    exit 1
}

Write-Host "Successfully focused SimplySign Desktop window"
Write-Host ""

# Small delay to ensure window is ready for input
Start-Sleep -Milliseconds 400

# Inject credentials: Username + TAB + TOTP + ENTER
Write-Host "Injecting credentials into login dialog..."
Write-Host "Sending: Username -> TAB -> TOTP -> ENTER"

# Send the credential sequence
# SendKeys treats these characters as commands; send the username literally.
$escapedUserId = [regex]::Replace($UserId, '[+^%~(){}\[\]]', { param($match) '{' + $match.Value + '}' })
$wshell.SendKeys($escapedUserId)
Start-Sleep -Milliseconds 200
$wshell.SendKeys("{TAB}")
Start-Sleep -Milliseconds 200

# Generate current TOTP code
# Avoid submitting a code that is about to expire during credential injection.
$remaining = $Period - ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() % $Period)
if ($remaining -le 5) {
    Start-Sleep -Seconds ($remaining + 1)
}
$otp = Get-TotpCode -Secret $Base32 -Digits $Digits -Period $Period -Algorithm $Algorithm
if ($env:GITHUB_ACTIONS -eq 'true') {
    Write-Host "::add-mask::$otp"
}
Write-Host "Generated TOTP using $Algorithm algorithm"
Write-Host ""

$wshell.SendKeys($otp)
Start-Sleep -Milliseconds 200
$wshell.SendKeys("{ENTER}")

Write-Host "Credentials injected successfully"
Write-Host ""

# A running UI does not establish that login succeeded. Wait for the exact
# signing certificate to become available before electron-builder starts.
Write-Host 'Waiting for the Certum signing certificate...'
$deadline = [DateTime]::UtcNow.AddSeconds(60)
do {
    if (-not (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) {
        throw 'SimplySign Desktop exited before the signing certificate became available'
    }
    $certificate = Get-ChildItem -Path Cert:\CurrentUser\My, Cert:\LocalMachine\My -CodeSigningCert |
        Where-Object { $_.Thumbprint -eq $CertificateSha1 } |
        Select-Object -First 1
    if ($certificate) {
        $now = Get-Date
        if ($certificate.NotBefore -gt $now -or $certificate.NotAfter -le $now) {
            throw 'The Certum signing certificate is not currently valid'
        }
        Write-Host 'Certum signing certificate is available'
        exit 0
    }
    Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $deadline)

throw 'Certum login did not make the requested signing certificate available within 60 seconds'
