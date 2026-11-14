param(
  [int]$Port = 4317,
  [string]$BaseUrl = $env:GITHOK_AI_BASE_URL,
  [string]$Model = $env:GITHOK_AI_MODEL,
  [switch]$NoOpen,
  [switch]$NoAi,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) {
  throw "PORT must be between 1024 and 65535 (got $Port)."
}

$root = $PSScriptRoot
$serverScript = Join-Path $root 'server.mjs'
if (-not (Test-Path $serverScript)) {
  throw "server.mjs not found under $root"
}

$hadKey = Test-Path Env:GITHOK_AI_KEY
$prevKey = $env:GITHOK_AI_KEY
$hadBase = Test-Path Env:GITHOK_AI_BASE_URL
$prevBase = $env:GITHOK_AI_BASE_URL
$hadModel = Test-Path Env:GITHOK_AI_MODEL
$prevModel = $env:GITHOK_AI_MODEL
$hadPort = Test-Path Env:PORT
$prevPort = $env:PORT

function Restore-EnvVar {
  param([string]$Name, [bool]$Existed, [string]$OldValue)
  if ($Existed) {
    Set-Item -Path ("Env:{0}" -f $Name) -Value $OldValue
  } else {
    Remove-Item -Path ("Env:{0}" -f $Name) -ErrorAction SilentlyContinue
  }
}

try {
  $aiConfigured = $false
  if (-not $NoAi) {
    $resolvedKey = if ($env:GITHOK_AI_KEY) { $env:GITHOK_AI_KEY.Trim() } else { '' }
    if (-not $resolvedKey -and -not $DryRun) {
      $secret = Read-Host 'API credential (hidden; press Enter to run without AI)' -AsSecureString
      try {
        if ($secret.Length -gt 0) {
          $resolvedKey = [System.Net.NetworkCredential]::new('', $secret).Password.Trim()
        }
      } finally {
        $secret.Dispose()
      }
    }

    if ($resolvedKey) {
      $resolvedBase = if ($BaseUrl) { $BaseUrl.Trim() } else { '' }
      if (-not $resolvedBase -and -not $DryRun) {
        $resolvedBase = (Read-Host 'AI Base URL (e.g. https://api.openai.com/v1)').Trim()
      }
      $resolvedModel = if ($Model) { $Model.Trim() } else { '' }
      if (-not $resolvedModel -and -not $DryRun) {
        $resolvedModel = (Read-Host 'AI Model name').Trim()
      }

      if ($resolvedBase -and $resolvedModel) {
        $env:GITHOK_AI_KEY = $resolvedKey
        $env:GITHOK_AI_BASE_URL = $resolvedBase
        $env:GITHOK_AI_MODEL = $resolvedModel
        $aiConfigured = $true
      } else {
        Write-Warning 'AI Base URL or Model missing; starting GitHok without AI summaries.'
      }
    }
  }

  $env:PORT = "$Port"
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $listeners) {
    if (-not $procId) { continue }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    $cmdLine = if ($proc) { [string]$proc.CommandLine } else { '' }
    $matchesRepoPath = ($cmdLine -like "*$root*") -and ($cmdLine -match 'server\.mjs')
    $relativeServerCmd = $proc -and ($proc.Name -eq 'node.exe') -and ($cmdLine -match '^(?:"[^"]*node\.exe"|node)\s+["'']?server\.mjs["'']?(?:\s|$)')
    $isGitHokServer = $matchesRepoPath -or $relativeServerCmd
    if (-not $isGitHokServer) {
      throw "Port $Port is already used by PID $procId ($($proc.Name)). Use -Port to choose another port."
    }
    if ($DryRun) {
      Write-Output "DRYRUN_WOULD_STOP_PID=$procId"
    } else {
      Write-Output "Stopping existing GitHok process PID $procId on port $Port..."
      Stop-Process -Id $procId -Force
      Start-Sleep -Milliseconds 300
    }
  }

  if ($DryRun) {
    Write-Output "DRYRUN_OK port=$Port aiConfigured=$aiConfigured root=$root"
    exit 0
  }

  $nodeArgs = @($serverScript)
  if (-not $NoOpen) { $nodeArgs += '--open' }
  $modeLabel = if ($aiConfigured) { 'AI-enabled' } else { 'original-text fallback' }
  Write-Output "Starting GitHok on http://127.0.0.1:$Port ($modeLabel)..."
  Set-Location $root
  & node @nodeArgs
  exit $LASTEXITCODE
} finally {
  Restore-EnvVar -Name 'GITHOK_AI_KEY' -Existed $hadKey -OldValue $prevKey
  Restore-EnvVar -Name 'GITHOK_AI_BASE_URL' -Existed $hadBase -OldValue $prevBase
  Restore-EnvVar -Name 'GITHOK_AI_MODEL' -Existed $hadModel -OldValue $prevModel
  Restore-EnvVar -Name 'PORT' -Existed $hadPort -OldValue $prevPort
}
