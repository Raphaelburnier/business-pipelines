import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActiviteTaskBoard, titreRun } from './ActiviteTaskBoard';
import { sourceCalendrierMaquette, type Objectif } from './calendrier/api';
import type { Run } from './types';

vi.mock('./donnees/contexte', () => ({ useCharge: vi.fn(), useSource: () => ({ source: {} }) }));
import { useCharge } from './donnees/contexte';

const run: Run = { id: 'run-quota', projet: 'agent-orchestrator', pipeline: 'improve-app@8', statut: 'waiting_quota', vivant: true,
  debut: null, fin: null, coutEquivalentUsd: 0, coutReelUsd: 0, declencheur: 'cockpit', etapes: { total: 1, parStatut: { waiting_quota: 1 } }, livraison: null,
  attente: { id: '00000000-0000-4000-8000-000000000001', statut: 'waiting_quota', runtime: 'codex', machine: 'pc', compte: 'principal',
    raison: 'Quota de la fenêtre atteint', resetAt: null, resetSource: null, reconnexion: null, prochaineReprise: '2026-11-06T05:00:00Z',
    tentatives: 1, maximum: 3, limiteLe: '2026-11-07T00:00:00Z', raisonManuelle: null, commande: null, actions: ['reprendre'] } };
const objectifs = [{ titre: '5.2 · Mission multi-dépôts', occurrences: [{ runId: run.id }] }] as Objectif[];

beforeEach(() => vi.mocked(useCharge).mockReset());

it('retrouve le titre d’un run de groupe et conserve le pipeline pour les anciens runs', () => {
  expect(titreRun(run, objectifs)).toBe('5.2 · Mission multi-dépôts');
  expect(titreRun(run, [])).toBe('improve-app@8');
});

it('affiche le run en quota et sa prochaine tentative sans confondre réussite et livraison', () => {
  vi.mocked(useCharge).mockReturnValueOnce({ donnees: [run], erreur: null } as never)
    .mockReturnValueOnce({ donnees: objectifs, erreur: null } as never);
  const html = renderToStaticMarkup(createElement(ActiviteTaskBoard, { calendrier: sourceCalendrierMaquette(), revision: 0 }));
  expect(html).toContain('5.2 · Mission multi-dépôts');
  expect(html).toContain('Attente de quota');
  expect(html).toContain('Nouvelle tentative');
  expect(html).toContain('Europe/Zurich');
  expect(html).toContain('Suivre');
  expect(html).toContain('une exécution réussie ne prouve ni une fusion ni une mise en production');
});

it('signale une lecture indisponible au lieu d’annoncer une absence de travail', () => {
  vi.mocked(useCharge).mockReturnValueOnce({ donnees: null, erreur: 'HTTP 503' } as never)
    .mockReturnValueOnce({ donnees: null, erreur: 'HTTP 503' } as never);
  const html = renderToStaticMarkup(createElement(ActiviteTaskBoard, { calendrier: sourceCalendrierMaquette(), revision: 0 }));
  expect(html).toContain('Runs indisponibles');
  expect(html).toContain('Planifications indisponibles');
  expect(html).not.toContain('Aucun run ni publication en cours');
});
