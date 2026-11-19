param([switch]$NoBrowser)

# One-click launcher for "A Cigarette's Life".
# Fast and proxy-independent: all port checks / readiness checks use raw TCP sockets
# (Windows PowerShell 5.1's Invoke-WebRequest can hang on networks with proxy auto-detect,
# which previously made the launcher appear stuck right after the banner).
#
# What it does:
#   1. checks Node.js / npm (installs dependencies on the very first run)
#   2. reuses an already-running game server if one is found
#   3. otherwise starts the Vite dev server on a free port (3000-3010)
#   4. waits until the game page really responds, then opens the default browser
#   5. the game itself plays public/beginning.html before the main menu

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logFile = Join-Path $root 'launcher.log'

try {
  Add-Content -Path $logFile -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] ----- launcher start -----") -Encoding UTF8
} catch {
  # Logging is best-effort only.
}

function Write-Log([string]$text) {
  try {
    Add-Content -Path $logFile -Value ("[" + (Get-Date -Format 'HH:mm:ss') + "] " + $text) -Encoding UTF8
  } catch {
    # ignore
  }
}

function Write-Step([string]$text) {
  Write-Host ""
  Write-Host ("  " + $text) -ForegroundColor Cyan
  Write-Log $text
}

function Write-Detail([string]$text) {
  Write-Host ("  " + $text) -ForegroundColor DarkGray
  Write-Log $text
}

function Write-Fail([string]$text) {
  Write-Host ""
  Write-Host ("  [启动失败] " + $text) -ForegroundColor Red
  Write-Log ("FAIL: " + $text)
  Write-Host ("  详细日志: " + $logFile) -ForegroundColor DarkGray
  Write-Host ""
  exit 1
}

# --- raw TCP / HTTP helpers (no WinHTTP / proxy involvement) -----------------

function Test-PortOpen([string]$hostName, [int]$port, [int]$timeoutMs) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connect = $client.BeginConnect($hostName, $port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne($timeoutMs)) { return $false }
    $client.EndConnect($connect)
    return $true
  } catch {
    return $false
  } finally {
    try { $client.Close() } catch { }
  }
}

function Test-AppHttp([string]$hostName, [int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connect = $client.BeginConnect($hostName, $port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(800)) { return $false }
    $client.EndConnect($connect)
    $stream = $client.GetStream()
    $stream.ReadTimeout = 2500
    $stream.WriteTimeout = 2500
    $requestBytes = [System.Text.Encoding]::ASCII.GetBytes("GET / HTTP/1.1`r`nHost: " + $hostName + "`r`nConnection: close`r`n`r`n")
    $stream.Write($requestBytes, 0, $requestBytes.Length)
    $buffer = New-Object byte[] 8192
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { return $false }
    $response = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
    return ($response -match '200' -and $response -match 'A Cigarette')
  } catch {
    return $false
  } finally {
    try { $client.Close() } catch { }
  }
}

function Get-AppUrl([int]$port) {
  foreach ($hostName in @('127.0.0.1', 'localhost')) {
    if (Test-AppHttp $hostName $port) {
      return ("http://{0}:{1}/" -f $hostName, $port)
    }
  }
  return $null
}

function Test-PortFree([int]$port) {
  return -not (Test-PortOpen '127.0.0.1' $port 250)
}

# Fast port discovery through the OS table (Get-NetTCPConnection). Returns a hashtable
# @{ Ok = $bool; Ports = @{ port = $true } }; Ok=$false means the cmdlet is unavailable.
function Get-ListeningPortInfo {
  $map = @{}
  try {
    $connections = Get-NetTCPConnection -State Listen -ErrorAction Stop
    foreach ($connection in $connections) {
      $map[[int]$connection.LocalPort] = $true
    }
    return @{ Ok = $true; Ports = $map }
  } catch {
    return @{ Ok = $false; Ports = $map }
  }
}

# --- banner ----------------------------------------------------------------

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor DarkGray
Write-Host "    A Cigarette's Life / 香烟的一生 - 一键启动" -ForegroundColor Yellow
Write-Host "  ============================================================" -ForegroundColor DarkGray
Write-Log "launcher start, root=$root"

# --- environment -----------------------------------------------------------

Write-Step "检查运行环境..."
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node -eq $null) {
  Write-Fail "未找到 Node.js。请先安装 Node.js 18+（https://nodejs.org）后重试。"
}
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm -eq $null) {
  Write-Fail "未找到 npm。请重新安装 Node.js（包含 npm）后重试。"
}
if (-not (Test-Path (Join-Path $root 'package.json'))) {
  Write-Fail "当前目录不是游戏项目目录（未找到 package.json）。"
}
Write-Detail ("Node: " + (& node --version))
Write-Detail ("项目目录: " + $root)

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Step "首次启动：正在安装依赖（可能需要几分钟，仅此一次）..."
  & npm install
  if ($LASTEXITCODE -ne 0) { Write-Fail "npm install 失败，请检查上面的 npm 报错。" }
}

# --- reuse a running server ------------------------------------------------

Write-Step "检查游戏服务是否已在运行..."
$listenInfo = Get-ListeningPortInfo
$existingUrl = $null
foreach ($candidate in 3000..3005) {
  if ($listenInfo.Ok -and -not $listenInfo.Ports.ContainsKey($candidate)) { continue }
  $existingUrl = Get-AppUrl $candidate
  if ($existingUrl -ne $null) { break }
}
if ($existingUrl -ne $null) {
  Write-Step ("游戏服务已在运行，直接打开：" + $existingUrl)
  if (-not $NoBrowser) {
    Start-Process $existingUrl | Out-Null
    Write-Host "  已在默认浏览器中打开游戏。" -ForegroundColor Green
  }
  Write-Host ""
  exit 0
}

# --- pick port and start dev server ---------------------------------------

$port = $null
foreach ($candidate in 3000..3005) {
  if ($listenInfo.Ok) {
    if (-not $listenInfo.Ports.ContainsKey($candidate)) { $port = $candidate; break }
  } elseif (Test-PortFree $candidate) {
    $port = $candidate
    break
  }
}
if ($port -eq $null) { Write-Fail "3000-3010 端口都被占用，请关闭占用端口的程序后重试。" }

Write-Step ("启动游戏服务（端口 " + $port + "）...")
$command = "title A Cigarette's Life - game server && npx vite --host 127.0.0.1 --port " + $port + " --strictPort"
Start-Process -FilePath "cmd.exe" -ArgumentList '/k', $command -WorkingDirectory $root | Out-Null
Write-Detail ("已启动服务窗口；游戏地址: http://127.0.0.1:" + $port + "/")

Write-Step "等待游戏就绪（首次编译需要几秒到几十秒，请稍候）..."
$deadline = (Get-Date).AddSeconds(180)
$readyUrl = $null
while ((Get-Date) -lt $deadline) {
  $info = Get-ListeningPortInfo
  $isListening = $info.Ports.ContainsKey($port)
  if ($isListening -or -not $info.Ok) {
    $readyUrl = Get-AppUrl $port
    if ($readyUrl -ne $null) { break }
  }
  Start-Sleep -Milliseconds 600
}

if ($readyUrl -eq $null) {
  # Even if the HTTP probe failed, a listening port usually means the server is up.
  if (Test-PortOpen '127.0.0.1' $port 500) {
    $readyUrl = ("http://127.0.0.1:{0}/" -f $port)
    Write-Detail "页面探测未通过，但端口已监听，仍尝试打开浏览器。"
  } else {
    Write-Fail "游戏服务启动超时。请查看刚打开的服务命令行窗口中的报错信息。"
  }
}

Write-Step ("游戏已就绪：" + $readyUrl)
Write-Host ""
Write-Host "  提示：游戏会先播放 Synthelix 开场动画，然后进入主菜单。" -ForegroundColor DarkGray
Write-Host "  跳过动画：点击画面任意处 / Enter / Space / Esc。" -ForegroundColor DarkGray
Write-Host "  退出游戏：关闭 A Cigarette's Life - game server 命令行窗口即可。" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
  Write-Step "正在打开默认浏览器..."
  try {
    Start-Process $readyUrl | Out-Null
    Write-Host "  已打开：" -NoNewline
    Write-Host $readyUrl -ForegroundColor Green
  } catch {
    Write-Host "  无法自动打开浏览器，请手动复制上面的地址到浏览器打开。" -ForegroundColor Yellow
  }
  Write-Host ""
}

Write-Log "launcher done, url=$readyUrl"