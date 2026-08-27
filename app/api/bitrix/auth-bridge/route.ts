import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

// Página intermediária carregada pelo Bitrix24 como "Caminho de instalação inicial".
// Usa BX24.js (carregado dentro do iframe do Bitrix24) para obter o token de auth
// correto — o BX24.getAuth() devolve o domínio real do portal (hecke.bitrix24.com.br),
// não o oauth.bitrix.info que chega nos campos do POST server-to-server.
function bridgeHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Inventário de TI</title>
<style>
  body { font-family: sans-serif; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; color: #555; }
</style>
</head>
<body>
<p id="msg">Abrindo...</p>
<script src="//api.bitrix24.com/api/v1/"></script>
<script>
BX24.init(function() {
  var auth = BX24.getAuth();
  var placement = '';
  try { placement = (BX24.placement.info() || {}).id || ''; } catch (e) {}

  fetch('/api/bitrix/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken: auth.access_token,
      memberId:    auth.member_id,
      domain:      auth.domain,
      placement:   placement
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.redirectUrl) {
      window.location.replace(d.redirectUrl);
    } else {
      document.getElementById('msg').textContent =
        'Não foi possível abrir o aplicativo: ' + (d.error || 'erro desconhecido');
    }
  })
  .catch(function() {
    document.getElementById('msg').textContent =
      'Falha de conexão ao abrir o aplicativo.';
  });
});
</script>
</body>
</html>`
}

export async function GET(): Promise<NextResponse> {
  return new NextResponse(bridgeHtml(), {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function POST(): Promise<NextResponse> {
  return new NextResponse(bridgeHtml(), {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  })
}
