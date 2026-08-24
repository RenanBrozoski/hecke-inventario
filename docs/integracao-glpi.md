# Integração GLPI → Inventário

O conector roda em uma máquina da rede interna; o GLPI não é exposto à internet.

1. No GLPI, entre com **Renan**, altere o perfil para **Super-Admin** e, em
   **Configurar → Geral → API**, habilite o uso de credenciais na API. O cliente
   de API já foi criado.
2. No ambiente da Vercel, defina `GLPI_SYNC_TOKEN` com um segredo novo, aleatório
   e longo. Use exatamente o mesmo valor na máquina que executará o script.
3. Na máquina interna, defina as variáveis abaixo e execute
   `powershell -ExecutionPolicy Bypass -File .\scripts\sync-glpi.ps1`.

```powershell
$env:GLPI_BASE_URL = 'http://192.168.1.236:8974'
$env:GLPI_APP_TOKEN = 'token do cliente GLPI'
$env:GLPI_USERNAME = 'Renan'
$env:GLPI_PASSWORD = 'senha do GLPI'
$env:INVENTORY_GLPI_SYNC_URL = 'https://SEU-APP/api/integrations/glpi/sync'
$env:GLPI_SYNC_TOKEN = 'o mesmo segredo configurado na Vercel'
$env:BITRIX_PORTAL_DOMAIN = 'hecke.bitrix24.com.br'
$env:GLPI_CATEGORY_NAME = 'Desktop'
$env:GLPI_PROFILE_ID = '4' # Super-Admin do usuário Renan neste GLPI
$env:VERCEL_AUTOMATION_BYPASS_SECRET = 'segredo de Protection Bypass for Automation da Vercel'
```

O script só cria/atualiza dados técnicos detectados pelo GLPI (nome, série,
tag, fabricante, modelo e SO). Ele não altera responsável, local, patrimônio
ou situação definidos no inventário.
