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

$glpiBaseUrl = (Require-Environment 'GLPI_BASE_URL').TrimEnd('/')
$glpiAppToken = Require-Environment 'GLPI_APP_TOKEN'
$inventoryUrl = (Require-Environment 'INVENTORY_GLPI_SYNC_URL').TrimEnd('/')
$inventoryToken = Require-Environment 'GLPI_SYNC_TOKEN'
$portalDomain = Require-Environment 'BITRIX_PORTAL_DOMAIN'
$categoryName = Require-Environment 'GLPI_CATEGORY_NAME'
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
  $headers = @{ 'App-Token' = $glpiAppToken; 'Session-Token' = $session.session_token; Range = "0-$($PageSize - 1)" }
  $computers = @(Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/Computer/" -Headers $headers -TimeoutSec 60)
  $items = foreach ($computer in $computers) {
    $detail = Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/Computer/$($computer.id)" -Headers $headers -TimeoutSec 30
    [ordered]@{
      id = [int]$detail.id
      name = if ($detail.name) { [string]$detail.name } else { "Computador GLPI $($detail.id)" }
      serialNumber = if ($detail.serial) { [string]$detail.serial } else { $null }
      assetTag = if ($detail.otherserial) { [string]$detail.otherserial } else { $null }
      manufacturer = if ($detail.manufacturers_id) { [string]$detail.manufacturers_id } else { $null }
      model = if ($detail.computermodels_id) { [string]$detail.computermodels_id } else { $null }
      operatingSystem = if ($detail.operatingsystems_id) { [string]$detail.operatingsystems_id } else { $null }
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
