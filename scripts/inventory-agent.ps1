<#
.SYNOPSIS
  Agente de inventário de hardware — envia dados do PC para o Inventário Bitrix.

.DESCRIPTION
  Sem parâmetros : coleta e envia os dados uma vez (modo de teste / execução normal).
  Com -Install   : copia o script para C:\ProgramData\InventarioBitrix\ e registra
                   uma tarefa agendada silenciosa que roda ao iniciar + a cada 6 horas.
                   Execute como Administrador.

.EXAMPLE
  # Teste rápido (não instala nada)
  powershell -ExecutionPolicy Bypass -File .\inventory-agent.ps1

  # Instalação no PC (requer admin)
  powershell -ExecutionPolicy Bypass -File .\inventory-agent.ps1 -Install
#>
param([switch]$Install)

$ErrorActionPreference = 'Stop'

# ============================================================
# CONFIGURAÇÃO — edite antes de distribuir o script
# ============================================================
$Config = @{
  CollectorUrl   = 'https://SEU-APP.vercel.app/api/integrations/collector/sync'
  CollectorToken = 'COLLECTOR_SYNC_TOKEN_AQUI'  # mesmo valor de COLLECTOR_SYNC_TOKEN na Vercel
  PortalDomain   = 'hecke.bitrix24.com.br'
  CategoryName   = 'Desktop'                    # categoria no inventário (Desktop, Notebook, etc.)
  TaskName       = 'InventarioBitrix'
  InstallPath    = 'C:\ProgramData\InventarioBitrix\inventory-agent.ps1'
  IntervalHours  = 6
}
# ============================================================

# ── Instalação como tarefa agendada silenciosa ─────────────
if ($Install) {
  $dir = Split-Path $Config.InstallPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  Copy-Item -Path $MyInvocation.MyCommand.Path -Destination $Config.InstallPath -Force

  $action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$($Config.InstallPath)`""

  $triggerBoot   = New-ScheduledTaskTrigger -AtStartup
  $triggerRepeat = New-ScheduledTaskTrigger `
    -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Hours $Config.IntervalHours)

  $settings = New-ScheduledTaskSettingsSet `
    -Hidden `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

  $principal = New-ScheduledTaskPrincipal `
    -UserId 'SYSTEM' `
    -LogonType ServiceAccount `
    -RunLevel Highest

  Register-ScheduledTask `
    -TaskName $Config.TaskName `
    -Action $action `
    -Trigger @($triggerBoot, $triggerRepeat) `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

  Write-Host "Instalado com sucesso."
  Write-Host "Tarefa '$($Config.TaskName)' registrada — roda ao iniciar e a cada $($Config.IntervalHours)h."
  Write-Host "Executando coleta inicial..."
  Start-ScheduledTask -TaskName $Config.TaskName
  exit 0
}

# ── Helpers ───────────────────────────────────────────────
function Get-Nullable([string]$v) {
  if ([string]::IsNullOrWhiteSpace($v) -or $v -match '^To Be Filled') { return $null }
  return $v.Trim()
}

# ── Coleta do ID AnyDesk ──────────────────────────────────
function Get-AnyDeskId {
  $paths = @(
    "${env:ProgramFiles(x86)}\AnyDesk\AnyDesk.exe",
    "$env:ProgramFiles\AnyDesk\AnyDesk.exe",
    "$env:APPDATA\AnyDesk\AnyDesk.exe",
    "$env:LOCALAPPDATA\AnyDesk\AnyDesk.exe"
  )
  $exe = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { return $null }
  try {
    # --get-id imprime apenas o número (ex: 123456789) em stdout
    $id = & $exe --get-id 2>$null | Select-Object -First 1
    $id = ($id -replace '\D', '').Trim()
    if ($id -match '^\d{5,12}$') { return $id }
  } catch { }
  return $null
}

# ── Coleta de hardware via WMI ────────────────────────────
try {
  $cs    = Get-CimInstance Win32_ComputerSystem   -ErrorAction SilentlyContinue
  $os    = Get-CimInstance Win32_OperatingSystem  -ErrorAction SilentlyContinue
  $bios  = Get-CimInstance Win32_BIOS             -ErrorAction SilentlyContinue
  $cpu   = Get-CimInstance Win32_Processor        -ErrorAction SilentlyContinue | Select-Object -First 1
  $gpus  = Get-CimInstance Win32_VideoController  -ErrorAction SilentlyContinue |
           Where-Object { $_.AdapterRAM -and $_.AdapterRAM -gt 0 }
  $gpu   = $gpus | Select-Object -First 1
  $mems  = Get-CimInstance Win32_PhysicalMemory   -ErrorAction SilentlyContinue
  $disks = Get-CimInstance Win32_DiskDrive        -ErrorAction SilentlyContinue |
           Where-Object { $_.Size -and $_.Size -gt 0 }
  $nics  = Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction SilentlyContinue |
           Where-Object { $_.IPEnabled -and $_.MACAddress }

  # RAM
  $ramMb      = if ($mems) { ($mems | Measure-Object -Property Capacity -Sum).Sum / 1MB } else { 0 }
  $ramGb      = if ($ramMb -gt 0) { [math]::Round($ramMb / 1024, 0) } else { $null }
  $ramModules = if ($mems) { ($mems | Measure-Object).Count } else { $null }
  $ramStr     = if ($ramGb) { "$ramGb GB" } else { $null }

  # Discos
  $diskParts = @($disks | ForEach-Object { "$([math]::Round($_.Size / 1GB, 0)) GB" })
  $diskStr   = if ($diskParts.Count) { $diskParts -join ' + ' } else { $null }

  # Rede — separa cabeado de Wi-Fi
  $ethNic  = $nics | Where-Object { $_.Description -notmatch 'Wi-?Fi|Wireless|802\.11|Virtual|VPN|Loopback' } | Select-Object -First 1
  $wifiNic = $nics | Where-Object { $_.Description -match 'Wi-?Fi|Wireless|802\.11' } | Select-Object -First 1
  $anyNic  = $nics | Select-Object -First 1

  $primaryNic = if ($ethNic) { $ethNic } elseif ($wifiNic) { $wifiNic } else { $anyNic }
  $ip = $null
  if ($primaryNic -and $primaryNic.IPAddress) {
    $ip = $primaryNic.IPAddress |
          Where-Object { $_ -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$' -and $_ -ne '127.0.0.1' } |
          Select-Object -First 1
  }

  # AnyDesk
  $anydeskId = Get-AnyDeskId

  $machine = @{
    name            = [string]$env:COMPUTERNAME
    serialNumber    = Get-Nullable $bios.SerialNumber
    manufacturer    = Get-Nullable $cs.Manufacturer
    model           = Get-Nullable $cs.Model
    operatingSystem = Get-Nullable $os.Caption
    processor       = Get-Nullable $cpu.Name
    videoCard       = if ($gpu) { Get-Nullable $gpu.Name } else { $null }
    memory          = $ramStr
    memoryModules   = $ramModules
    storage         = $diskStr
    macCable        = if ($ethNic)  { Get-Nullable $ethNic.MACAddress  } else { $null }
    macWifi         = if ($wifiNic) { Get-Nullable $wifiNic.MACAddress } else { $null }
    ipAddress       = if ($ip) { [string]$ip } else { $null }
    anydeskCode     = $anydeskId
  }

  $payload = @{
    portalDomain = $Config.PortalDomain
    categoryName = $Config.CategoryName
    machine      = $machine
  } | ConvertTo-Json -Depth 4

  $headers = @{ 'X-Collector-Token' = $Config.CollectorToken }
  Invoke-RestMethod `
    -Uri $Config.CollectorUrl `
    -Method Post `
    -ContentType 'application/json; charset=utf-8' `
    -Headers $headers `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) `
    -TimeoutSec 30 | Out-Null

  # ── Polling de comandos remotos ───────────────────────────
  $cmdQuery = "portalDomain=$([Uri]::EscapeDataString($Config.PortalDomain))"
  if ($machine.serialNumber) { $cmdQuery += "&serial=$([Uri]::EscapeDataString($machine.serialNumber))" }
  if ($machine.name) { $cmdQuery += "&name=$([Uri]::EscapeDataString($machine.name))" }

  try {
    $cmdResponse = Invoke-RestMethod `
      -Uri "$($Config.CollectorUrl -replace '/sync$', '')/commands?$cmdQuery" `
      -Method Get `
      -Headers $headers `
      -TimeoutSec 15

    foreach ($cmd in $cmdResponse.commands) {
      $success = $false
      $result  = $null
      try {
        switch ($cmd.command) {

          'SET_WALLPAPER' {
            $imgPath = "C:\ProgramData\InventarioBitrix\wallpaper.jpg"
            Invoke-WebRequest -Uri $cmd.params.url -OutFile $imgPath -TimeoutSec 30
            # Mapa de estilos: WallpaperStyle 0=tile,2=stretch,6=fit,10=fill,22=span
            $styleMap = @{ TILE='0'; STRETCH='2'; CENTER='0'; FIT='6'; FILL='10' }
            $wsValue  = $styleMap[[string]$cmd.params.style] ?? '10'
            # Define via política HKLM (aplica em todos os usuários; sobrescreve preferência individual)
            $policyPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
            if (-not (Test-Path $policyPath)) { New-Item -Path $policyPath -Force | Out-Null }
            Set-ItemProperty $policyPath -Name 'Wallpaper' -Value $imgPath
            Set-ItemProperty $policyPath -Name 'WallpaperStyle' -Value $wsValue
            # Também aplica nas hives de usuários já carregadas para efeito imediato
            if (-not (Get-PSDrive -Name HKU -ErrorAction SilentlyContinue)) {
              New-PSDrive -Name HKU -PSProvider Registry -Root HKEY_USERS | Out-Null
            }
            Get-ChildItem 'HKU:\' -ErrorAction SilentlyContinue |
              Where-Object { $_.PSChildName -match 'S-1-5-21' } |
              ForEach-Object {
                $dp = "HKU:\$($_.PSChildName)\Control Panel\Desktop"
                if (Test-Path $dp) {
                  Set-ItemProperty $dp -Name 'Wallpaper' -Value $imgPath -ErrorAction SilentlyContinue
                  Set-ItemProperty $dp -Name 'WallpaperStyle' -Value $wsValue -ErrorAction SilentlyContinue
                  Set-ItemProperty $dp -Name 'TileWallpaper' -Value '0' -ErrorAction SilentlyContinue
                }
              }
            $success = $true
            $result  = "Wallpaper definido: $imgPath"
          }

          'SHOW_MESSAGE' {
            # msg.exe envia uma caixa de diálogo para todos os usuários conectados
            $title = [string]$cmd.params.title
            $body  = [string]$cmd.params.body
            & msg.exe * /TIME:60 "$title`n$body" 2>$null
            $success = $true
            $result  = 'Mensagem enviada'
          }

          'MAP_DRIVE' {
            # RunOnce: aplica mapeamento na próxima vez que qualquer usuário fizer login
            $letter = [string]$cmd.params.letter
            $path   = [string]$cmd.params.path
            $runKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce'
            Set-ItemProperty $runKey -Name "InventarioMapDrive_$letter" `
              -Value "cmd /c net use ${letter}: `"$path`" /persistent:yes" -ErrorAction Stop
            $success = $true
            $result  = "Drive $letter mapeado para $path (ativo no próximo login)"
          }
        }
      } catch {
        $success = $false
        $result  = "Erro: $($_.Exception.Message)"
      }

      # Reporta o resultado de volta
      $donePayload = @{
        portalDomain = $Config.PortalDomain
        success      = $success
        result       = $result
      } | ConvertTo-Json
      Invoke-RestMethod `
        -Uri "$($Config.CollectorUrl -replace '/sync$', '')/commands/$($cmd.id)" `
        -Method Patch `
        -ContentType 'application/json; charset=utf-8' `
        -Headers $headers `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($donePayload)) `
        -TimeoutSec 15 | Out-Null
    }
  } catch {
    # Falha no polling de comandos não interrompe o agente
  }

} catch {
  # Falha silenciosa — vai tentar de novo na próxima execução agendada
  exit 1
}
