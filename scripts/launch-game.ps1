param([switch]$NoBrowser)

# One-click launcher for "A Cigarette's Life".
# Starts the Vite dev server (installing dependencies on first run), waits until it is
# serving the game, then opens the default browser. The game itself plays the studio intro
# (public/beginning.html) before the main menu.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-Step([string]$text) {
  Write-Host ""
  Write-Host "  " -NoNewline
  Write-Host $text -ForegroundColor Cyan
}

function Write-Fail([string]$text) {
  Write-Host ""
  Write-Host "  [启动失败] " -NoNewline -ForegroundColor Red
  Write-Host $text -ForegroundColor Red
  Write-Host ""
  exit 1
}

function Get-AppUrl([int]$port) {
  foreach ($hostName in @('127.0.0.1', 'localhost')) {
    try {
      $url = ("http://{0}:{1}/" -f $hostName, $port)
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200 -and $response.Content -match 'A Cigarette') {
        return $url
      }
    } catch {
      # Try the next host name.
    }
  }
  return $null
}

function Test-PortFree([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $port)
    $client.Close()
    return $false
  } catch {
    return $true
  }
}

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor DarkGray
Write-Host "    A Cigarette's Life / 香烟的一生 - 一键启动" -ForegroundColor Yellow
Write-Host "  ============================================================" -ForegroundColor DarkGray

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Fail "未找到 Node.js。请先安装 Node.js 18+ (https://nodejs.org) 后重试。"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Fail "未找到 npm。请重新安装 Node.js（包含 npm）后重试。"
}
if (-not (Test-Path (Join-Path $root 'package.json'))) {
  Write-Fail "当前目录不是游戏项目目录（未找到 package.json）。"
}

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Step "首次启动：正在安装依赖（可能需要几分钟，仅一次）..."
  & npm install
  if ($LASTEXITCODE -ne 0) { Write-Fail "npm install 失败。" }
}

# If the game is already being served on one of the usual ports, just open it.
$existingUrl = $null
foreach ($candidate in 3000..3010) {
  $existingUrl = Get-AppUrl $candidate
  if ($existingUrl -ne $null) { break }
}
if ($existingUrl -ne $null) {
  Write-Step ("游戏服务已在运行，直接打开：" + $existingUrl)
  if (-not $NoBrowser) { Start-Process $existingUrl | Out-Null }
  exit 0
}

# Choose a free port.
$port = $null
foreach ($candidate in 3000..3010) {
  if (Test-PortFree $candidate) { $port = $candidate; break }
}
if ($port -eq $null) { Write-Fail "3000-3010 端口都被占用，请关闭占用端口的程序后重试。" }

Write-Step ("启动游戏服务（端口 " + $port + "）...")
$command = "title A Cigarette's Life - game server && npx vite --host 127.0.0.1 --port " + $port + " --strictPort"
Start-Process -FilePath "cmd.exe" -ArgumentList '/k', $command -WorkingDirectory $root | Out-Null

Write-Step "等待游戏就绪（首次加载需要编译，请稍候）..."
$deadline = (Get-Date).AddSeconds(150)
$readyUrl = $null
while ((Get-Date) -lt $deadline) {
  $readyUrl = Get-AppUrl $port
  if ($readyUrl -ne $null) { break }
  Start-Sleep -Milliseconds 700
}
if ($readyUrl -eq $null) {
  Write-Fail "游戏服务启动超时。请查看刚打开的黑色命令行窗口中的报错信息。"
}

$url = $readyUrl
Write-Step ("游戏已就绪：" + $url)
Write-Host ""
Write-Host "  提示：游戏会先播放 Synthelix 开场动画，然后进入主菜单。" -ForegroundColor DarkGray
Write-Host "  退出游戏：关闭刚打开的游戏服务命令行窗口即可。" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
  Start-Process $url | Out-Null
  Write-Host "  已在默认浏览器中打开游戏。" -ForegroundColor Green
  Write-Host ""
}
