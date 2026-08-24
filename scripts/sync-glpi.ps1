<#!
Sincroniza computadores do GLPI para o Inventário Bitrix.
Execute em uma máquina da mesma rede do GLPI. Os segredos são lidos apenas
das variáveis de ambiente desta máquina e nunca são escritos em arquivo.
#>
[CmdletBinding()]
param(
  [int]$PageSize = 100
)

$ErrorActionPreference = 'Stop'

function Require-Environment([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Defina a variável de ambiente $Name." }
  return $value.Trim()
}

function First-GlpiValue($Value) {
  if ($Value -is [System.Array]) { return $Value | Select-Object -First 1 }
  return $Value
}

$glpiBaseUrl = (Require-Environment 'GLPI_BASE_URL').TrimEnd('/')
$glpiAppToken = Require-Environment 'GLPI_APP_TOKEN'
$inventoryUrl = (Require-Environment 'INVENTORY_GLPI_SYNC_URL').TrimEnd('/')
$inventoryToken = Require-Environment 'GLPI_SYNC_TOKEN'
$portalDomain = Require-Environment 'BITRIX_PORTAL_DOMAIN'
$categoryName = Require-Environment 'GLPI_CATEGORY_NAME'
$profileId = [Environment]::GetEnvironmentVariable('GLPI_PROFILE_ID')
$userToken = [Environment]::GetEnvironmentVariable('GLPI_USER_TOKEN')
$username = [Environment]::GetEnvironmentVariable('GLPI_USERNAME')
$password = [Environment]::GetEnvironmentVariable('GLPI_PASSWORD')

if ([string]::IsNullOrWhiteSpace($userToken) -and ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($password))) {
  throw 'Defina GLPI_USER_TOKEN ou GLPI_USERNAME e GLPI_PASSWORD.'
}

$sessionHeaders = @{ 'App-Token' = $glpiAppToken }
if (-not [string]::IsNullOrWhiteSpace($userToken)) {
  $sessionHeaders.Authorization = "user_token $userToken"
} else {
  $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$username`:$password"))
  $sessionHeaders.Authorization = "Basic $basic"
}

$session = $null
try {
  $session = Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/initSession" -Headers $sessionHeaders -TimeoutSec 30
  if (-not $session.session_token) { throw 'GLPI não retornou uma sessão de API.' }
  # Windows PowerShell bloqueia o cabeçalho HTTP Range como reservado. O GLPI
  # já limita a resposta padrão; aplicamos o limite localmente sem perder a
  # compatibilidade com Windows PowerShell 5.1.
  $headers = @{ 'App-Token' = $glpiAppToken; 'Session-Token' = $session.session_token }
  if (-not [string]::IsNullOrWhiteSpace($profileId)) {
    Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/changeActiveProfile" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ profiles_id = [int]$profileId } | ConvertTo-Json) -TimeoutSec 30 | Out-Null
  }
  $computers = @(Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/Computer/" -Headers $headers -TimeoutSec 60 | Select-Object -First $PageSize)
  $items = foreach ($computer in $computers) {
    $detail = Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/Computer/$($computer.id)" -Headers $headers -TimeoutSec 30
    $computerId = First-GlpiValue $detail.id
    $computerName = First-GlpiValue $detail.name
    $serial = First-GlpiValue $detail.serial
    $otherSerial = First-GlpiValue $detail.otherserial
    $manufacturer = First-GlpiValue $detail.manufacturers_id
    $model = First-GlpiValue $detail.computermodels_id
    $operatingSystem = First-GlpiValue $detail.operatingsystems_id
    [ordered]@{
      id = [int]$computerId
      name = if ($computerName) { [string]$computerName } else { "Computador GLPI $computerId" }
      serialNumber = if ($serial) { [string]$serial } else { $null }
      assetTag = if ($otherSerial) { [string]$otherSerial } else { $null }
      manufacturer = if ($manufacturer) { [string]$manufacturer } else { $null }
      model = if ($model) { [string]$model } else { $null }
      operatingSystem = if ($operatingSystem) { [string]$operatingSystem } else { $null }
    }
  }
  if (-not $items.Count) { Write-Output 'GLPI não retornou computadores para sincronizar.'; exit 0 }
  $payload = @{ portalDomain = $portalDomain; categoryName = $categoryName; items = @($items) } | ConvertTo-Json -Depth 6
  $result = Invoke-RestMethod -Uri $inventoryUrl -Method Post -Headers @{ 'X-GLPI-Sync-Token' = $inventoryToken } -ContentType 'application/json' -Body $payload -TimeoutSec 90
  Write-Output "Sincronização concluída: $($result.created) criado(s), $($result.updated) atualizado(s)."
} finally {
  if ($session -and $session.session_token) {
    try { Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/killSession" -Headers @{ 'App-Token' = $glpiAppToken; 'Session-Token' = $session.session_token } -TimeoutSec 15 | Out-Null } catch { Write-Warning 'Não foi possível encerrar a sessão temporária do GLPI.' }
  }
}
