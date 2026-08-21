export default function HomePage() {
  return (
    <main style={{ fontFamily: 'inherit', padding: '2rem', maxWidth: 640, margin: '0 auto' }}>
      <h1>Inventário de TI</h1>
      <p>Este aplicativo precisa ser aberto de dentro do Bitrix24.</p>
      <p>
        Status da aplicação: <a href="/api/health">/api/health</a>
      </p>
    </main>
  )
}
