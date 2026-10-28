#!/usr/bin/env python3
"""Archive déchiffrée -> dossier neuf. Aucun extractall ni lien accepté."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import sys
import tarfile


def verifier(archive, destination):
    destination = Path(destination)
    destination.mkdir(mode=0o700, exist_ok=False)
    vus = set()
    fichiers = {}
    total = 0
    with tarfile.open(archive, 'r:gz') as tar:
        for membre in tar:
            nom = membre.name.rstrip('/')
            relatif = PurePosixPath(nom)
            if (not nom or nom in vus or relatif.is_absolute() or '..' in relatif.parts
                    or '\\' in nom or any(ord(c) < 32 for c in nom)
                    or relatif.parts[0] not in {'manifest.json', 'etat', 'specs', 'approvals', 'projects'}
                    or not (membre.isfile() or membre.isdir())):
                raise ValueError('entrée refusée')
            vus.add(nom)
            total += membre.size
            if total > 4 * 1024**3 or len(vus) > 100000:
                raise ValueError('archive hors limites')
            cible = destination.joinpath(*relatif.parts)
            if membre.isdir():
                cible.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            cible.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            digest = hashlib.sha256()
            with tar.extractfile(membre) as source, cible.open('xb') as sortie:
                os.chmod(cible, 0o600)
                while bloc := source.read(1024 * 1024):
                    digest.update(bloc)
                    sortie.write(bloc)
            if nom != 'manifest.json':
                fichiers[nom] = digest.hexdigest()
    manifeste = json.loads((destination / 'manifest.json').read_text())
    if manifeste.get('version') != 1 or manifeste.get('fichiers') != fichiers:
        raise ValueError('manifeste invalide')
    if 'etat/events.sqlite' not in fichiers or 'specs/workers.json' not in fichiers:
        raise ValueError('source obligatoire absente')
    json.loads((destination / 'specs/workers.json').read_text())
    bases = manifeste.get('bases')
    if not isinstance(bases, dict) or set(bases) != {n for n in fichiers if n.endswith('.sqlite')}:
        raise ValueError('manifeste des bases invalide')
    for relatif, attendus in bases.items():
        with sqlite3.connect((destination / relatif).as_uri() + '?mode=ro', uri=True) as db:
            if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise ValueError('base invalide')
            tables = {nom: db.execute('SELECT COUNT(*) FROM "' + nom.replace('"', '""') + '"').fetchone()[0]
                      for (nom,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()}
            if attendus != tables:
                raise ValueError('compteurs invalides')
    if manifeste.get('tables') != bases['etat/events.sqlite']:
        raise ValueError('event store invalide')
    return {'integrite': 'ok', 'fichiers': len(fichiers), 'tables': bases['etat/events.sqlite'], 'bases': len(bases), 'creeLe': manifeste['creeLe']}


if __name__ == '__main__':
    try:
        print(json.dumps(verifier(sys.argv[1], sys.argv[2])))
    except Exception:
        print('Restauration refusée : archive ou destination invalide.', file=sys.stderr)
        sys.exit(1)
