# ResiliOS

Application d'autonomie et de résilience, 100 % hors-ligne, avec chiffrement
local (React Native 0.87, TypeScript strict).

## Démarrage

```sh
npm install
npm test           # tests unitaires (Jest)
npm run typecheck  # tsc --noEmit
npm run lint

# Natif (nécessite Android Studio / Xcode)
npm run android
cd ios && bundle install && bundle exec pod install && cd .. && npm run ios
```

`package.json` active SQLCipher et FTS5 dans op-sqlite
(`"op-sqlite": { "sqlcipher": true, "fts5": true }`). Après tout changement
de cette section, relancer `pod install` et reconstruire l'app Android.

## Module crypto (`src/crypto`)

### Dérivation de clé

```
ikm = Argon2id(PIN, sel_compartiment)   m = 64 MiB, t = 3, p = 2, 32 octets, sel CSPRNG 16 octets
clé = HKDF-SHA256(ikm, sel = secret_appareil, info = "resilios/sqlcipher-key/v1")
SQLCipher : clé brute x'<64 hex>' (pas de PBKDF2 interne)
```

- Argon2id tourne dans un module natif (argon2kt / Argon2Swift), hors du
  thread JS et du thread UI.
- Le **secret d'appareil** (32 octets) est conservé dans le Keychain iOS ou
  le Keystore Android (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, adossé au matériel
  quand c'est possible). Copier les fichiers `.db` et les sels hors du
  téléphone ne permet donc pas de forcer le PIN hors-ligne.
- Les sels, le secret et le compteur d'essais forment un unique
  enregistrement dans ce même stockage protégé. C'est un écart volontaire au
  cahier des charges, qui prévoyait un stockage en clair : cela évite que les
  sels soient sauvegardés ou copiés.

### Mode sous contrainte (déni plausible)

- Chaque installation possède **toujours** deux bases aux noms neutres
  (`rs_store_0.db`, `rs_store_1.db`) et deux sels. Sans code de contrainte,
  la seconde base est chiffrée avec une clé aléatoire qui est jetée.
- L'attribution « réel / leurre » est tirée au hasard à l'initialisation et
  **n'est enregistrée nulle part**. À l'exécution, l'application ouvre
  simplement la base que le code déverrouille.
- Chaque essai dérive les deux clés et tente d'ouvrir les deux bases. Le
  travail effectué (et donc la durée) est le même pour le code maître, le
  code de contrainte ou un code faux.
- `initialize()` renvoie la base factice (`decoy`) pour qu'elle soit remplie
  de données anodines. Pour rester crédible, elle doit avoir le même schéma
  que la vraie et être modifiée de temps en temps.

### Limitation des essais

5 essais libres, puis un délai de 30 s qui double à chaque échec, plafonné à
1 h. L'essai est compté **avant** la dérivation : tuer l'application pendant
un essai ne contourne pas la limite. Tout succès remet le compteur à zéro,
y compris avec le code de contrainte.

### Changement de code

Le nouveau sel est journalisé (`pendingSalt`) avant `PRAGMA rekey`, puis
validé. Si l'application est interrompue entre les deux, le déverrouillage
suivant essaie les deux sels et finalise l'opération.

### Erreurs

Le module lève des `CryptoError` dont le champ `code` vaut :
`DERIVATION_FAILED`, `INVALID_PIN`, `LOCKED_OUT` (avec `retryAt`),
`PIN_POLICY`, `STORAGE_CORRUPTED`, `DATABASE_CORRUPTED`, `NOT_INITIALIZED`
ou `ALREADY_INITIALIZED`. Les messages ne mentionnent jamais le leurre.

### Utilisation

```ts
import { createVaultKeyManager } from './src/crypto';
import { createVault, openVault } from './src/vault';

const manager = createVaultKeyManager();
const content = { guides: BUNDLED_GUIDES, seedDecoy };

// Première ouverture : crée les deux bases, applique le schéma aux deux.
const db = await createVault(manager, content, { masterPin, duressPin });

// Ouvertures suivantes : déverrouille et met le schéma à niveau.
const db2 = await openVault(manager, content, pin);
```

## Schéma de base (`src/db`)

Les migrations sont dans `src/db/schema.ts`. Leur version est suivie par
`PRAGMA user_version`, et chacune s'applique dans sa propre transaction. Les
**deux bases** (réelle et factice) reçoivent le même schéma et les mêmes
fiches, pour que rien ne les distingue, pas même la taille des fichiers.

| Table | Rôle |
|---|---|
| `settings` | Réglages du foyer : membres, L d'eau/pers./jour (3), kcal/pers./jour (2000) |
| `inventory_items` | Article : catégorie, unité normalisée (`L`, `mL`, `kg`, `g`, `unit`), kcal par unité, critique |
| `inventory_lots` | Lots d'un article : quantité, date d'entrée, péremption. Ordre de consommation FEFO puis FIFO |
| `poi_locations` | Points d'intérêt : coordonnées bornées, MGRS, type |
| `crisis_checklists` / `crisis_checklist_items` | Checklists, avec une ligne par élément |
| `survival_guides` + `survival_guides_fts` | Fiches Markdown et index FTS5 (sans accents, préfixes) |

Écarts par rapport au cahier des charges :

- `inventory_items` est scindée en articles + lots, sans quoi le FIFO serait
  impossible.
- `items_json` est remplacé par une table d'éléments.
- `unit` est une liste fermée, pour que les calculs d'autonomie soient fiables.

Contraintes : toutes les tables sont `STRICT` (SQLite refuse un type
incorrect), les dates de péremption sont des `AAAA-MM-JJ` valides, les
booléens valent 0 ou 1, l'eau est exprimée en volume, et les clés étrangères
sont activées à chaque ouverture. Les alertes de péremption s'appuient sur un
index partiel.

Les tests exécutent le vrai SQL sur le moteur SQLite de Node (`node:sqlite`,
FTS5 inclus). Seul le chiffrement SQLCipher est simulé.

### Limites connues

- Un PIN à 6 chiffres reste faible si l'appareil lui-même est compromis
  (accès root et extraction du Keystore). Une phrase de passe est recommandée.
- La clé transite en hexadécimal par JavaScript : les chaînes JS ne peuvent
  pas être effacées de la mémoire. Seuls les `Uint8Array` le sont.
- Le compteur d'essais vit sur l'appareil : un attaquant ayant les droits root
  peut le remettre à zéro, mais il lui faut alors aussi le secret d'appareil.
- Les tests utilisent Argon2id en JS pur avec des paramètres réduits. La
  dérivation native avec les paramètres réels doit être validée sur appareil
  (objectif : 150 à 300 ms sur un SoC milieu de gamme).

## Calcul de résilience (`src/resilience`)

`getResilienceReport(db)` calcule l'autonomie à partir de l'inventaire et des
réglages du foyer :

- **Eau** : litres (`L`, `mL`) ÷ (membres × L/pers./jour).
- **Vivres** : kcal (`quantité × kcal par unité`, catégorie `food`) ÷
  (membres × kcal/pers./jour).
- **Autonomie globale** : minimum des deux, avec la ressource limitante.

Chaque ressource fournit deux valeurs :

- `naiveDays` : la formule du cahier des charges ;
- `days` : une simulation qui consomme les lots dans l'ordre de péremption
  (FEFO) et compte ce qui périmera avant d'être consommé (`wasted`). Par
  exemple, 60 L qui périment dans 9 jours ne donnent que 10 jours d'eau, pas
  20. C'est cette valeur qu'il faut afficher.

`getExpiryAlerts(db)` classe les lots en `expired`, `within30`, `within60` et
`within90`. La requête utilise l'index partiel prévu à cet effet ; un test
vérifie le plan d'exécution.

Les dates sont des dates calendaires locales `AAAA-MM-JJ` : pas d'effet de
fuseau ni d'heure d'été. Une date de péremption est le dernier jour où le
produit est consommable.

## Coordonnées (`src/geo`)

`geoConverter.ts` convertit WGS84 ↔ UTM ↔ MGRS sans bibliothèque ni réseau :

- Mercator transverse par les séries de Krüger d'ordre 6 (Karney 2011),
  précision inférieure au millimètre. Le résultat est identique à proj4 au
  millimètre près sur 3000 points de test.
- Zones spéciales de Norvège (32V) et du Svalbard (31X–37X).
- MGRS de 0 à 5 chiffres, tronqués comme l'exige la norme. La lecture est
  tolérante (espaces, casse, zéro de tête). `mgrsToLatLon` renvoie le centre
  du carré désigné.
- Convergence du méridien (nord géographique / nord du quadrillage),
  distance et azimut, conversion azimut vrai → magnétique.
- Formats texte : UTM (`31 N 448252 5411933`), degrés décimaux,
  degrés-minutes, DMS.

Limites :

- Les zones polaires (au-delà de 84° N et 80° S, grille UPS) ne sont pas
  prises en charge et lèvent l'erreur `POLAR_UNSUPPORTED`.
- La déclinaison magnétique doit être fournie : il n'y a pas encore de
  modèle magnétique embarqué (WMM).
- Dans le format UTM, la lettre désigne l'hémisphère (N ou S), jamais la
  bande, car « 31S » serait ambigu.

## Inventaire (`src/inventory`)

`InventoryRepository` gère les articles et leurs lots :

- **Articles** : création (avec un premier lot facultatif), modification
  partielle, suppression avec les lots, liste avec totaux (stock total, stock
  utilisable, prochaine péremption). Le filtre texte ignore la casse et les
  accents.
- **Lots** : ajout, correction (une quantité 0 supprime le lot), suppression,
  et `discardExpired()` pour jeter les périmés. Un lot qui périme aujourd'hui
  reste consommable.
- **Consommation** : `consume(itemId, quantité)` puise dans le lot qui périme
  le plus tôt, puis dans le plus ancien (FEFO puis FIFO). Les lots non
  périssables passent en dernier et les lots vidés sont supprimés. Les lots
  périmés sont ignorés, sauf avec `allowExpired`. L'opération est en tout ou
  rien : si le stock manque, rien n'est modifié et l'erreur indique la
  quantité disponible.

Garde-fous :

- Toutes les entrées sont validées avant SQLite, et l'`InventoryError`
  renvoyée indique le champ en cause.
- Changer l'unité d'un article qui a du stock est refusé : 2 kg
  deviendraient 2 g.
- Les quantités sont arrondies au millionième, pour éviter des reliquats
  comme 0,30000000000000004.
- Les écritures multiples passent par `withTransaction` (`src/db/transaction.ts`).

Les calories sont un entier par unité. Pour un produit à 3,6 kcal/g, saisir
le produit en kg (3 600 kcal/kg).

`seedDecoyInventory(db)` remplit la base factice avec l'inventaire d'un foyer
ordinaire (eau, pâtes, conserves, pharmacie, piles…). Quantités et dates
varient d'une installation à l'autre. À brancher sur
`createVault(manager, { guides, seedDecoy: seedDecoyInventory }, pins)`.
