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

function Expand-GlpiValues($Value) {
  if ($null -eq $Value) { return }
  if ($Value -is [System.Array]) {
    foreach ($item in $Value) { Expand-GlpiValues $item }
    return
  }
  $Value
}

function Get-GlpiPropertyValues($Items, [string]$Property) {
  foreach ($item in @($Items)) {
    if ($null -eq $item) { continue }
    $propertyValue = $item.PSObject.Properties[$Property]
    if ($null -eq $propertyValue) { continue }
    $value = $propertyValue.Value
    foreach ($entry in @(Expand-GlpiValues $value)) {
      if (-not [string]::IsNullOrWhiteSpace([string]$entry)) { [string]$entry }
    }
  }
}

function Get-GlpiCollection($Headers, [string]$Path) {
  try {
    $response = Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/$Path" -Headers $Headers -TimeoutSec 30
    return @(Expand-GlpiValues $response)
  } catch {
    Write-Warning "Não foi possível ler $Path no GLPI; o restante do equipamento será sincronizado."
    return @()
  }
}

function Get-FirstGlpiPropertyValue($Items, [string[]]$Properties) {
  foreach ($property in $Properties) {
    $value = Get-GlpiPropertyValues $Items $property | Select-Object -First 1
    if (-not [string]::IsNullOrWhiteSpace([string]$value)) { return [string]$value }
  }
  return $null
}

function Get-FirstIPv4Address($Values) {
  foreach ($value in @($Values)) {
    $parsed = $null
    if ([System.Net.IPAddress]::TryParse([string]$value, [ref]$parsed) -and $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
      return $parsed.ToString()
    }
  }
  return $null
}

function Get-GlpiName($Headers, [string]$Type, $Id) {
  if (-not $Id) { return $null }
  try {
    $record = Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/$Type/$Id" -Headers $Headers -TimeoutSec 30
    return [string](First-GlpiValue $record.name)
  } catch {
    Write-Warning "Não foi possível ler $Type/$Id no GLPI."
    return $null
  }
}

$glpiBaseUrl = (Require-Environment 'GLPI_BASE_URL').TrimEnd('/')
$glpiAppToken = Require-Environment 'GLPI_APP_TOKEN'
$inventoryUrl = (Require-Environment 'INVENTORY_GLPI_SYNC_URL').TrimEnd('/')
$inventoryToken = Require-Environment 'GLPI_SYNC_TOKEN'
$portalDomain = Require-Environment 'BITRIX_PORTAL_DOMAIN'
$categoryName = Require-Environment 'GLPI_CATEGORY_NAME'
$profileId = [Environment]::GetEnvironmentVariable('GLPI_PROFILE_ID')
$vercelBypassSecret = [Environment]::GetEnvironmentVariable('VERCEL_AUTOMATION_BYPASS_SECRET')
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
    $detail = Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/Computer/$($computer.id)?expand_dropdowns=true" -Headers $headers -TimeoutSec 30
    $computerId = First-GlpiValue $detail.id
    $computerName = First-GlpiValue $detail.name
    $serial = First-GlpiValue $detail.serial
    $otherSerial = First-GlpiValue $detail.otherserial
    $manufacturer = First-GlpiValue $detail.manufacturers_id
    $model = First-GlpiValue $detail.computermodels_id
    $operatingSystem = First-GlpiValue $detail.operatingsystems_id
    $ipAddress = Get-FirstIPv4Address (Get-GlpiPropertyValues @($detail) 'ip')
    $anydeskCode = Get-FirstGlpiPropertyValue @($detail) @('anydesk_id', 'anydesk_code', 'anydesk', 'remote_access_id')
    $processors = Get-GlpiCollection $headers "Computer/$computerId/Item_DeviceProcessor"
    $memories = Get-GlpiCollection $headers "Computer/$computerId/Item_DeviceMemory"
    $drives = Get-GlpiCollection $headers "Computer/$computerId/Item_DeviceHardDrive"
    $cards = Get-GlpiCollection $headers "Computer/$computerId/Item_DeviceNetworkCard"
    $videoCards = Get-GlpiCollection $headers "Computer/$computerId/Item_DeviceGraphicCard"
    $networkPorts = Get-GlpiCollection $headers "Computer/$computerId/NetworkPort"
    $networkNames = foreach ($port in $networkPorts) {
      Get-GlpiCollection $headers "NetworkPort/$($port.id)/NetworkName"
    }
    if (-not $ipAddress) { $ipAddress = Get-FirstIPv4Address (Get-GlpiPropertyValues $networkNames 'name') }
    $software = Get-GlpiCollection $headers "Computer/$computerId/Software"
    $softwareNames = @(Get-GlpiPropertyValues $software 'name')
    $antivirus = Get-FirstGlpiPropertyValue @($detail) @('antivirus', 'antivirus_name')
    if (-not $antivirus) {
      $antivirus = $softwareNames | Where-Object { $_ -match '(?i)(mcafee|microsoft defender|windows defender|kaspersky|eset|bitdefender|avast|avg|norton|symantec|trend micro|sophos)' } | Select-Object -First 1
    }
    $ccleanerInstalled = @($softwareNames | Where-Object { $_ -match '(?i)ccleaner' }).Count -gt 0
    $processor = $processors | Select-Object -First 1
    $processorName = if ($processor) { Get-GlpiName $headers 'DeviceProcessor' $processor.deviceprocessors_id } else { $null }
    $videoCard = $videoCards | Select-Object -First 1
    $videoCardName = if ($videoCard) { Get-GlpiName $headers 'DeviceGraphicCard' (First-GlpiValue $videoCard.devicegraphiccards_id) } else { $null }
    $ramModules = @(Get-GlpiPropertyValues $memories 'size' | ForEach-Object { [int]$_ } | Where-Object { $_ -gt 0 })
    $ramMb = @($ramModules | Measure-Object -Sum).Sum
    $driveCapacities = @(Get-GlpiPropertyValues $drives 'capacity' | ForEach-Object { [double]$_ } | Where-Object { $_ -gt 0 })
    $driveText = @($driveCapacities | ForEach-Object { "{0:N0} GB" -f ($_ / 1000) }) -join ' + '
    $macAddresses = @(Get-GlpiPropertyValues $cards 'mac' | Select-Object -Unique)
    [ordered]@{
      id = [int]$computerId
      name = if ($computerName) { [string]$computerName } else { "Computador GLPI $computerId" }
      serialNumber = if ($serial) { [string]$serial } else { $null }
      glpiOtherSerial = if ($otherSerial) { [string]$otherSerial } else { $null }
      manufacturer = if ($manufacturer) { [string]$manufacturer } else { $null }
      model = if ($model) { [string]$model } else { $null }
      operatingSystem = if ($operatingSystem) { [string]$operatingSystem } else { $null }
      motherboard = ((@($manufacturer, $model) | Where-Object { $_ }) -join ' ')
      processor = if ($processorName) { "$processorName ($($processor.frequency) MHz)" } else { $null }
      videoCard = if ($videoCardName) { [string]$videoCardName } else { $null }
      memory = if ($ramMb) { "{0:N0} GB" -f ([double]$ramMb / 1024) } else { $null }
      memoryModules = if ($ramModules.Count) { $ramModules.Count } else { $null }
      storage = if ($driveText) { $driveText } else { $null }
      macCable = if ($macAddresses.Count -gt 0) { [string]$macAddresses[0] } else { $null }
      macWifi = if ($macAddresses.Count -gt 1) { [string]$macAddresses[1] } else { $null }
      ipAddress = if ($ipAddress) { [string]$ipAddress } else { $null }
      antivirus = if ($antivirus) { [string]$antivirus } else { $null }
      anydeskCode = if ($anydeskCode) { [string]$anydeskCode } else { $null }
      ccleanerInstalled = $ccleanerInstalled
    }
  }
  if (-not $items.Count) { Write-Output 'GLPI não retornou computadores para sincronizar.'; exit 0 }
  $payload = @{ portalDomain = $portalDomain; categoryName = $categoryName; items = @($items) } | ConvertTo-Json -Depth 6
  $inventoryHeaders = @{ 'X-GLPI-Sync-Token' = $inventoryToken }
  if (-not [string]::IsNullOrWhiteSpace($vercelBypassSecret)) {
    $inventoryHeaders['x-vercel-protection-bypass'] = $vercelBypassSecret
  }
  $result = Invoke-RestMethod -Uri $inventoryUrl -Method Post -Headers $inventoryHeaders -ContentType 'application/json' -Body $payload -TimeoutSec 90
  Write-Output "Sincronização concluída: $($result.created) criado(s), $($result.updated) atualizado(s)."
} finally {
  if ($session -and $session.session_token) {
    try { Invoke-RestMethod -Uri "$glpiBaseUrl/apirest.php/killSession" -Headers @{ 'App-Token' = $glpiAppToken; 'Session-Token' = $session.session_token } -TimeoutSec 15 | Out-Null } catch { Write-Warning 'Não foi possível encerrar a sessão temporária do GLPI.' }
  }
}
