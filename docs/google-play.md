# Publication sur Google Play

La version Google Play de Fenrir a l'identifiant `app.fenrir`. Elle se met
à jour par le Play Store uniquement : pas de mise à jour intégrée ni de
permission d'installer des paquets. La version GitHub (`com.resilios`) ne
change pas.

Chaque compilation produit l'artefact `fenrir-play-aab`
(`Fenrir-play-<version>.aab`), le fichier à envoyer dans la Play Console.

## Clé d'envoi (une seule fois)

Google signe l'application distribuée (« Signature d'application Play ») ;
la clé d'envoi sert seulement à prouver que le paquet vient de vous. Si elle
est perdue, le support Play peut la réinitialiser.

1. Créer la clé, sur un ordinateur avec Java :

   ```sh
   keytool -genkeypair -v -keystore fenrir-upload.jks -alias fenrir \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Encoder le fichier : `base64 -w0 fenrir-upload.jks` (macOS : `base64 -i fenrir-upload.jks`).

3. Dans GitHub, **Settings → Secrets and variables → Actions**, ajouter :

   | Secret | Valeur |
   | --- | --- |
   | `FENRIR_UPLOAD_KEYSTORE_B64` | le texte de l'étape 2 |
   | `FENRIR_UPLOAD_STORE_PASSWORD` | le mot de passe du fichier |
   | `FENRIR_UPLOAD_KEY_ALIAS` | `fenrir` |
   | `FENRIR_UPLOAD_KEY_PASSWORD` | le mot de passe de la clé |

4. Garder `fenrir-upload.jks` et ses mots de passe hors du dépôt (gestionnaire
   de mots de passe).

Sans ces secrets, le paquet Play est signé avec la clé de débogage : il
compile, mais la Play Console le refuse.
