import { afterEach, expect, test, vi } from 'vitest';
import { sourceApi } from './api';

afterEach(() => vi.unstubAllGlobals());

test('les deux réserves utilisent leur route, sans laisser le client choisir le runtime dans le corps signé', async () => {
  const appels: { route: string; options?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (route: string, options?: RequestInit) => {
    appels.push({ route, options });
    return new Response(JSON.stringify(options?.method === 'POST'
      ? { id: route.endsWith('codex') ? 'commande-codex' : 'commande-claude', statut: 'pending' }
      : { configuration: { active: false, seuilUtilise: null }, autorise: true }));
  });
  const source = sourceApi();
  await source.reserveQuota!();
  await source.reserveQuota!('codex');
  const configuration = { active: true, seuilUtilise: 80 };
  expect((await source.reglerReserveQuota!(configuration, 'codex')).id).toBe('commande-codex');
  expect((await source.reglerReserveQuota!(configuration)).id).toBe('commande-claude');
  expect(appels.map(a => a.route)).toEqual([
    '/api/quota/reserve-claude', '/api/quota/reserve-codex',
    '/api/quota/reserve-codex', '/api/quota/reserve-claude',
  ]);
  for (const appel of appels.slice(2)) {
    expect(appel.options?.method).toBe('POST');
    expect(JSON.parse(String(appel.options?.body))).toEqual(configuration);
  }
});
