import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// @testing-library/react só registra a limpeza automática entre testes
// quando detecta APIs globais de Jest — como não usamos `globals: true` no
// Vitest, registramos explicitamente aqui.
afterEach(() => {
  cleanup()
})
