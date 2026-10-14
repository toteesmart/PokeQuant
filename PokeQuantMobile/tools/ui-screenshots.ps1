#Requires -Version 5.1
<#
.SYNOPSIS
  Run the Maestro UI flows and harvest screenshots into artifacts/ui-screens/.

.DESCRIPTION
  1. Checks `adb devices` for a connected device or emulator. If none is found,
     starts the Pixel_10_Pro AVD and waits for boot to complete.
  2. Runs every flow in maestro/flows via `maestro test`.
  3. Copies screenshots written under ~/.maestro/tests into
     artifacts/ui-screens/<flow-name>/ with a run timestamp on each file.

  Requires: adb, maestro on PATH, and a dev-client build of the app already
  installed on the device (npx expo run:android or an EAS build).

.PARAMETER AvdName
  AVD to boot when no device is connected. Default: Pixel_10_Pro.

.PARAMETER BootTimeoutSec
  Seconds to wait for sys.boot_completed. Default: 180.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\ui-screenshots.ps1
#>
param(
  [string]$AvdName = 'Pixel_10_Pro',
  [int]$BootTimeoutSec = 180
)

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path -Parent $PSScriptRoot
$flowsDir   = Join-Path $repoRoot 'maestro\flows'
$outRoot    = Join-Path $repoRoot 'artifacts\ui-screens'
$maestroOut = Join-Path $HOME '.maestro\tests'
$emulator   = Join-Path $env:LOCALAPPDATA 'Android\Sdk\emulator\emulator.exe'

# --- Locate adb --------------------------------------------------------------
$adb = 'adb'
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  $sdkAdb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
  if (Test-Path $sdkAdb) { $adb = $sdkAdb }
}
if (-not (Get-Command $adb -ErrorAction SilentlyContinue) -and -not (Test-Path $adb)) {
  throw 'adb not found on PATH or in the Android SDK platform-tools directory.'
}

# --- Locate maestro ----------------------------------------------------------
if (-not (Get-Command maestro -ErrorAction SilentlyContinue)) {
  throw 'maestro not found on PATH. Install it: https://docs.maestro.dev/getting-started/installing-maestro'
}

# --- Device check ------------------------------------------------------------
function Get-ReadyDevice {
  & $adb devices 2>$null |
    Where-Object { $_ -match '^(?<serial>\S+)\s+device\s*$' } |
    ForEach-Object { $Matches.serial }
}

$devices = @(Get-ReadyDevice)
if ($devices.Count -eq 0) {
  if (-not (Test-Path $emulator)) {
    throw "No device connected and emulator not found at $emulator"
  }
  Write-Host "No device detected. Starting emulator '$AvdName'..."
  Start-Process -FilePath $emulator -ArgumentList '-avd', $AvdName | Out-Null

  & $adb wait-for-device
  $deadline = (Get-Date).AddSeconds($BootTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $booted = (& $adb shell getprop sys.boot_completed 2>$null) -join ''
    if ($booted.Trim() -eq '1') { break }
    Start-Sleep -Seconds 3
  }
  if ($booted.Trim() -ne '1') {
    throw "Emulator did not finish booting within $BootTimeoutSec seconds."
  }
  # Dismiss the keyguard so taps land on the app, not the lock screen.
  & $adb shell input keyevent 82 | Out-Null
  Write-Host 'Emulator booted.'
} else {
  Write-Host "Device(s) connected: $($devices -join ', ')"
}

# --- Run flows ---------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $maestroOut | Out-Null
New-Item -ItemType Directory -Force -Path $outRoot | Out-Null

$flows = Get-ChildItem -Path $flowsDir -Filter '*.yaml' | Sort-Object Name
if (-not $flows) { throw "No flows found in $flowsDir" }

$results = @()
foreach ($flow in $flows) {
  $flowName = $flow.BaseName
  $stamp    = Get-Date -Format 'yyyyMMdd-HHmmss'
  $runStart = Get-Date
  Write-Host "`n=== $flowName ==="

  & maestro test $flow.FullName
  $exitCode = $LASTEXITCODE
  $status   = if ($exitCode -eq 0) { 'PASS' } else { "FAIL ($exitCode)" }

  # Collect every PNG Maestro wrote since this flow started.
  $destDir = Join-Path $outRoot $flowName
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  $pngs = Get-ChildItem -Path $maestroOut -Recurse -Filter '*.png' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt $runStart }
  $count = 0
  foreach ($png in $pngs) {
    $dest = Join-Path $destDir "$stamp-$($png.Name)"
    Copy-Item $png.FullName $dest -Force
    $count++
  }
  Write-Host "$status - captured $count screenshot(s) -> $destDir"
  $results += [pscustomobject]@{
    Flow        = $flowName
    Status      = $status
    Screenshots = $count
  }
}

# --- Summary -----------------------------------------------------------------
Write-Host "`n================ Summary ================"
$results | Format-Table -AutoSize
$total = ($results | Measure-Object -Property Screenshots -Sum).Sum
Write-Host "Total PNGs captured: $total under $outRoot"
