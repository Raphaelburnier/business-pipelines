import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttenteRun } from './AttenteRun';
import type { RunDetaille } from '../types';

vi.mock('../donnees/contexte', () => ({ useSource: () => ({ source: {} }) }));
vi.mock('./ControleExecution', () => ({ useCommande: vi.fn() }));
import { useCommande } from './ControleExecution';

const run = { id: 'r', attente: { statut: 'waiting_quota', raison: 'Quota atteint', runtime: 'claude', machine: 'pc', compte: 'principal',
  commande: 'reprise', prochaineReprise: null, raisonManuelle: null, tentatives: 1, maximum: 3, limiteLe: '2026-11-07T00:00:00Z', actions: ['reprendre'] } } as RunDetaille;

beforeEach(() => vi.mocked(useCommande).mockReset());

it('affiche le refus et rend à nouveau l’action au lieu de rester figé en file', () => {
  vi.mocked(useCommande).mockReturnValue({ statut: 'refused', resultat: { ok: false, raison: 'Quota encore bloqué' } } as ReturnType<typeof useCommande>);
  const html = renderToStaticMarkup(createElement(AttenteRun, { run }));
  expect(html).toContain('Quota encore bloqué');
  expect(html).toContain('Reprendre le même run');
  expect(html).not.toContain('Reprise mise en file');
});

it('distingue une commande réservée d’une simple demande en file', () => {
  vi.mocked(useCommande).mockReturnValue({ statut: 'taken', resultat: null } as ReturnType<typeof useCommande>);
  const html = renderToStaticMarkup(createElement(AttenteRun, { run }));
  expect(html).toContain('Reprise en cours');
  expect(html).not.toContain('Reprendre le même run');
});
