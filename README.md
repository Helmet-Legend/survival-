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
