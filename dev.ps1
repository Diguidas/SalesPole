<#
.SYNOPSIS
  Sobe o SalesPole inteiro para desenvolvimento (API, painel e app Expo), em qualquer rede.

.DESCRIPTION
  1. Descobre o IP do PC na rede ativa (a que tem gateway), em casa ou na rede corporativa.
  2. Grava esse IP em app/.env (EXPO_PUBLIC_API_URL), com a porta que esta em api/.env.
  3. Abre uma janela para cada servico: API, painel e Expo (com --clear, para pegar o .env novo).
  4. Confere se o firewall do Windows libera a porta da API e do Expo (veja -LiberarFirewall).

.EXAMPLE
  .\dev.ps1                      sobe tudo
  .\dev.ps1 -SemPainel           sobe so API e app
  .\dev.ps1 -LiberarFirewall     (PowerShell como administrador) cria as regras de firewall e sobe tudo
  .\dev.ps1 -Emulador            usa 10.0.2.2 (emulador do Android Studio) em vez do IP da rede
  .\dev.ps1 -SoConfigurar        so atualiza o IP em app\.env, sem abrir nenhuma janela
#>
param(
  [switch]$SemApi,
  [switch]$SemPainel,
  [switch]$SemApp,
  [switch]$Emulador,
  [switch]$LiberarFirewall,
  [switch]$SoConfigurar
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------------------------------------------------------------- IP da rede ativa
function Get-IpDaRede {
  # a interface que tem rota padrao (gateway) e esta ativa: ignora VPN sem gateway, Docker, Bluetooth etc.
  $cfg = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address } |
    Sort-Object { $_.IPv4Address.PrefixLength } -Descending
  foreach ($c in $cfg) {
    $ip = $c.IPv4Address[0].IPAddress
    if ($ip -notlike '169.254.*') { return @{ Ip = $ip; Nome = $c.InterfaceAlias } }
  }
  return $null
}

# ---------------------------------------------------------------- porta da API (api/.env)
$portaApi = 3000
$envApi = Join-Path $raiz 'api\.env'
if (Test-Path $envApi) {
  $linha = Get-Content $envApi | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | Select-Object -First 1
  if ($linha -match '=\s*(\d+)') { $portaApi = [int]$Matches[1] }
} else {
  Write-Warning "api\.env nao existe: copie api\.env.example para api\.env e preencha SAP_* e SUPABASE_*."
}

# ---------------------------------------------------------------- app/.env
if (-not $SemApp) {
  if ($Emulador) {
    $host_api = '10.0.2.2'
    Write-Host "Modo emulador: o app vai usar 10.0.2.2" -ForegroundColor Cyan
  } else {
    $rede = Get-IpDaRede
    if (-not $rede) { throw 'Nao achei uma rede ativa com gateway. Conecte no Wi-Fi/cabo e rode de novo.' }
    $host_api = $rede.Ip
    Write-Host ("Rede: {0}  IP: {1}" -f $rede.Nome, $rede.Ip) -ForegroundColor Cyan
  }
  $url = "http://${host_api}:$portaApi"

  $envApp = Join-Path $raiz 'app\.env'
  if (-not (Test-Path $envApp)) {
    $exemplo = Join-Path $raiz 'app\.env.example'
    if (Test-Path $exemplo) { Copy-Item $exemplo $envApp; Write-Warning 'app\.env criado a partir do exemplo: preencha as chaves do Supabase.' }
    else { New-Item -ItemType File -Path $envApp | Out-Null }
  }
  $linhas = @(Get-Content $envApp)
  $achou = $false
  $novas = foreach ($l in $linhas) {
    if ($l -match '^\s*EXPO_PUBLIC_API_URL\s*=') { $achou = $true; "EXPO_PUBLIC_API_URL=$url" } else { $l }
  }
  if (-not $achou) { $novas = @($novas) + "EXPO_PUBLIC_API_URL=$url" }
  # UTF-8 SEM BOM (o Set-Content do PowerShell 5.1 poe BOM e estraga o nome da primeira variavel)
  [System.IO.File]::WriteAllLines($envApp, [string[]]$novas, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "app\.env -> EXPO_PUBLIC_API_URL=$url" -ForegroundColor Green
}

if ($SoConfigurar) { return }

# ---------------------------------------------------------------- firewall (celular precisa alcancar API e Expo)
function Test-RegraFirewall([int]$porta) {
  $regras = Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue
  foreach ($r in $regras) {
    $f = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
    if ($f -and $f.Protocol -eq 'TCP' -and ($f.LocalPort -contains "$porta" -or $f.LocalPort -contains 'Any')) { return $true }
  }
  return $false
}

if (-not $Emulador -and -not $SemApp) {
  foreach ($porta in @($portaApi, 8081)) {
    if (Test-RegraFirewall $porta) { continue }
    if ($LiberarFirewall) {
      New-NetFirewallRule -DisplayName "SalesPole dev $porta" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $porta -Profile Any | Out-Null
      Write-Host "Firewall: porta $porta liberada." -ForegroundColor Green
    } else {
      Write-Warning "Firewall: nao achei regra liberando a porta $porta. Se o celular nao conectar, rode uma vez: .\dev.ps1 -LiberarFirewall (PowerShell como administrador)."
    }
  }
}

# ---------------------------------------------------------------- servicos
function Abrir-Servico([string]$titulo, [string]$pasta, [string]$comando) {
  $dir = Join-Path $raiz $pasta
  if (-not (Test-Path (Join-Path $dir 'node_modules'))) { $comando = "npm install; $comando" }
  $cmd = "`$Host.UI.RawUI.WindowTitle = '$titulo'; Set-Location '$dir'; $comando"
  Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $cmd | Out-Null
  Write-Host "Aberto: $titulo" -ForegroundColor Green
}

if (-not $SemApi)    { Abrir-Servico 'SalesPole API'    'api'    'npm run start:dev' }
if (-not $SemPainel) { Abrir-Servico 'SalesPole Painel' 'painel' 'npm run dev' }
if (-not $SemApp)    { Abrir-Servico 'SalesPole Expo'   'app'    'npx expo start --clear' }

Write-Host ''
Write-Host 'Pronto. Leia o QR code da janela "SalesPole Expo" no Expo Go (celular na mesma rede do PC).' -ForegroundColor Cyan
Write-Host ("API: http://localhost:{0}   Painel: http://localhost:5173" -f $portaApi)
