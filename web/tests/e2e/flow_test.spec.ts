import { test, expect } from '@playwright/test';

test.describe('Fluxo da API com Playwright request', () => {
  test('obter CSRF e verificar endpoints', async ({ request }) => {
    // --- Step 0: Obter CSRF token ---
    const csrfResponse = await request.get('/api/v1/auth/csrf');
    expect(csrfResponse.status()).toBe(200);
    const csrfBody = await csrfResponse.json();
    const csrfToken = csrfBody.data.csrfToken;

    // --- Verificar que o token é válido ---
    expect(csrfToken).toBeDefined();

    // --- Verificar /me sem auth (deve ser 401) ---
    const meNoAuth = await request.get('/api/v1/me');
    expect(meNoAuth.status()).toBe(401);

    // --- Verificar /me com auth (será testado em teste separado) ---
    // O fluxo completo register→login requer setup de sessão;
    // este teste valida apenas a infraestrutura CSRF e /me.

    test.step('csrf token está disponível para uso', () => {
      expect(typeof csrfToken).toBe('string');
      expect(csrfToken.length).toBeGreaterThan(0);
    });
  });
});