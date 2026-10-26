# Politique de confidentialité de Fenrir

Mise à jour : 2026-10-26

Fenrir ne collecte aucune donnée personnelle. Il n’y a ni compte, ni serveur Fenrir, ni publicité, ni statistiques d’utilisation, ni traceur. Vos données restent chiffrées sur votre téléphone.

## Données enregistrées sur le téléphone

Tout ce que vous saisissez dans Fenrir (stocks, armes et munitions, documents, photos, plan familial, contacts, points de repère, réglages) est enregistré uniquement sur votre téléphone, dans une base de données chiffrée (SQLCipher, AES-256). La clé est dérivée de votre code maître (Argon2id) et d’un secret conservé par le système du téléphone (Keystore Android ou Trousseau iOS).

Le développeur de Fenrir n’a accès à aucune de ces données et ne peut pas les récupérer, ni les restaurer si vous perdez votre code maître.

## Autorisations demandées

Caméra : lire les codes-barres et prendre des photos d’articles ou de documents. Les images restent dans le coffre chiffré.

Scan de documents (facultatif) : sur Android, Fenrir ouvre le scanner de documents des services Google Play ; sur iPhone, celui d’iOS. Les pages sont traitées sur le téléphone et seules celles que vous validez reviennent dans le coffre chiffré. Sur Android, Google reçoit des statistiques techniques sur l’utilisation de ce scanner (performances, erreurs), jamais les images.

Position : afficher votre position à la demande (écran Urgence, carte, points de repère). Elle n’est jamais suivie en arrière-plan ni envoyée par Fenrir. Si vous choisissez de l’envoyer par SMS, c’est votre application de messagerie qui l’envoie, au destinataire que vous choisissez.

Notifications : rappels de péremption au texte neutre (« Un rappel vous attend. »), sans nom d’article.

Réseau local : trouver et joindre le téléphone associé pour le partage du foyer.

## Connexions à internet (facultatives)

Fenrir fonctionne sans réseau. Les fonctions suivantes se connectent directement à des services publics, uniquement si vous les utilisez, sans envoyer d’identifiant de l’appareil ni de compte. Comme pour toute connexion, ces services voient l’adresse IP de votre connexion.

Reconnaissance des codes-barres (au choix dans les Réglages) : seul le code-barres du produit scanné est envoyé à Open Food Facts et Open Beauty Facts pour en trouver le nom. Les médicaments sont reconnus sans réseau.

Cartes hors ligne : quand vous téléchargez une zone, les images de carte sont demandées à l’IGN (Géoplateforme), qui voit donc la zone demandée.

Alertes (désactivées par défaut) : Fenrir télécharge des listes publiques complètes (vigilance météo, rappels de produits, ruptures de médicaments, séismes, restrictions d’eau, signal gaz) et les compare à vos stocks sur le téléphone. Pour les carburants, le numéro du département que vous suivez est envoyé à data.economie.gouv.fr.

Version installée depuis GitHub uniquement (hors Google Play) : au démarrage, Fenrir demande à GitHub le numéro de la dernière version pour proposer la mise à jour.

## Partage du foyer

Si vous associez un second téléphone, les deux échangent directement sur le Wi-Fi ou le partage de connexion, sans passer par internet ni par un serveur. Les échanges sont chiffrés de bout en bout (X25519, ChaCha20-Poly1305). Les armes, munitions et photos ne sont partagées que si vous l’activez.

## Sauvegarde et export

La sauvegarde crée un fichier chiffré que vous enregistrez à l’endroit de votre choix. L’export CSV, fait à votre demande, n’est pas chiffré : conservez-le avec précaution. La sauvegarde automatique d’Android est désactivée pour Fenrir.

## Conservation et suppression

Les données restent sur le téléphone tant que vous ne les supprimez pas. Désinstaller Fenrir efface le coffre. Aucune donnée n’étant conservée ailleurs, il n’y a rien à demander pour la supprimer.

## Public

Fenrir s’adresse aux adultes et n’est pas destiné aux enfants.

## Modifications et contact

Toute modification de cette politique sera publiée ici, avec sa date de mise à jour.

Pour toute question : https://github.com/Helmet-Legend/survival-/issues
