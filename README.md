# ♟ Répertoire d'ouvertures d'échecs

Application locale pour consigner **ce que vous jouez en ouverture contre vos adversaires, en fonction de leurs coups**.

Vos données sont enregistrées dans un vrai fichier sur votre disque (`repertoire.json`, à côté du programme) — rien dans le navigateur : vous pouvez changer de navigateur, d'ordinateur, vider le cache, vos données restent.

## Lancement

Il suffit d'avoir Python 3 (aucun paquet à installer) :

```
python3 repertoire.py
```

Le navigateur s'ouvre sur http://localhost:8765. Fermez avec Ctrl+C.

Autres options, sans ouverture automatique : `python3 repertoire.py --port 8800 --no-open`.

## Fonctionnalités

- **Échiquier interactif** : cliquez sur une pièce puis sur sa case d'arrivée (les promotions proposent Dame/Tour/Fou/Cavalier).
  - À votre tour : les **points verts** montrent vos coups déjà préparés ; jouer autre chose crée une nouvelle variante.
  - Au tour de l'adversaire : jouez n'importe quel coup adverse pour enregistrer l'arborescence « si l'adversaire joue ça, alors je réponds ça ». Les points violets montrent les réponses déjà connues.
- **Arbre des variantes** : toute l'arborescence est affichée avec variantes indentées ; chaque coup est cliquable pour s'y rendre.
- **Fiche par coup** : qualité (★ principale / alternative / ⚠ à éviter), commentaire (plan, piège…) et liste de **vos adversaires** contre qui ce coup est joué.
- **Adversaires** : gestion d'une liste de noms (par exemple « Dupont ») à cocher sur les coups concernés.
- **Navigation** : boutons Début / Précédent / Suivant, flèches ← → du clavier, déplacement direct dans l'arbre ou le bandeau de coups.
- **Import PGN** : variantes imbriquées, commentaires `{...}` et tags `!`/`?!`/`??` reconnus, **fusion** possible avec l'arbre actuel ou remplacement complet.
- **Export PGN** : arbre complet avec variantes et commentaires (utilisable dans toute interface ou moteur d'analyse).
- **Export/Import JSON** : sauvegarde complète (conserve aussi les adversaires), pour archiver ou déplacer le répertoire.

## Vos données

- `repertoire.json` : votre répertoire (écrit automatiquement après chaque modification).
- `repertoire-sauvegarde.json` : copie de sécurité automatique quotidienne.
- Pensez à exporter le JSON de temps en temps pour une copie hors du dossier.

## Structure du code

| Fichier | Rôle |
| --- | --- |
| `repertoire.py` | Serveur HTTP local (bibliothèque standard uniquement) + stockage JSON |
| `www/index.html` | Page |
| `www/style.css` | Style |
| `www/engine.js` | Règles d'échecs (coups légaux, SAN, FEN) — validé par les tests perft officiels |
| `www/pgn.js` | Import/export PGN avec variantes et commentaires |

Le serveur n'écoute que sur `127.0.0.1` : rien n'est accessible depuis l'extérieur de votre machine.
