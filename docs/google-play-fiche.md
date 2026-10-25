# Fiche Google Play et formulaires de la Play Console

Textes prêts à coller. Langue principale : français (France).

## Fiche principale

**Nom de l'application** (30 caractères max) :

> Fenrir – Stocks de survie

**Description courte** (80 caractères max) :

> Inventaire de survie chiffré et hors ligne : stocks, péremptions, plan familial

**Description complète** :

> Fenrir tient l'inventaire de vos réserves d'urgence et vous dit, chiffres à l'appui, combien de jours votre foyer peut tenir. Tout fonctionne sans réseau et reste chiffré sur votre téléphone : pas de compte, pas de serveur, pas de publicité.
>
> **VOS STOCKS, CLAIREMENT**
> • Fiches adaptées à chaque catégorie : eau, nourriture, santé et médicaments, énergie et éclairage, matériel, documents.
> • Dates de péremption, lots et quantités, historique des mouvements.
> • Scanner de codes-barres et des carrés Data Matrix des boîtes de médicaments (reconnus sans réseau).
> • Sacs d'évacuation : contenu, péremptions et autonomie de chaque sac.
> • Volet armes et munitions facultatif, pour l'inventaire de ce que vous détenez légalement.
>
> **COMBIEN DE TEMPS TENEZ-VOUS ?**
> • Autonomie en eau, calories et énergie selon la composition du foyer (adultes, enfants, bébés), avec les hypothèses de calcul visibles et modifiables.
> • Indice de préparation expliqué, listes de contrôle par paliers (2, 3, 7 et 10 jours) et plan d’action.
> • Simulateur de crise : coupure de courant ou d’eau, confinement, évacuation.
> • Rappels de péremption au texte neutre.
>
> **QUAND IL FAUT AGIR**
> • Écran Urgence : position GPS, envoi de votre position par SMS, numéros utiles.
> • Plan familial : contacts, points de regroupement, itinéraires, plan de communication.
> • Cartes hors ligne (IGN), boussole et points de repère.
> • Guide pratique hors ligne en 10 familles : eau, alimentation, santé, énergie, habitat, évacuation, gestion de crise…
> • Mode lumière rouge pour préserver la vision de nuit.
> • Alertes facultatives : vigilance météo, rappels de produits, ruptures de médicaments, séismes, restrictions d'eau, signal gaz, carburants.
>
> **VIE PRIVÉE ET SÉCURITÉ**
> • Base de données chiffrée (AES-256), ouverte par votre code maître.
> • Code de contrainte : un second code ouvre un coffre factice, si l'on vous force à ouvrir l'application.
> • Verrouillage dès que l'application passe en arrière-plan, captures d'écran bloquées.
> • Sauvegarde chiffrée dans le fichier de votre choix.
> • Partage du foyer : deux téléphones se synchronisent directement sur le Wi-Fi, chiffré de bout en bout, sans internet ni serveur.
>
> Fenrir aide à organiser vos réserves ; il ne remplace ni les consignes des autorités ni l'avis d'un professionnel de santé.

**Catégorie** : Outils. **Coordonnées** : adresse e-mail de contact (obligatoire, affichée publiquement sur la fiche). **Politique de confidentialité** : URL de `docs/confidentialite.md` (voir plus bas).

## Contenu de l'application (Play Console → Règles → Contenu de l'application)

### Politique de confidentialité

URL publique : `https://github.com/Helmet-Legend/survival-/blob/main/docs/confidentialite.md`
(ou la même page via GitHub Pages si elle est activée). Le même texte est dans l'application : Réglages → Confidentialité → Politique de confidentialité.

### Accès à l'application

« Toutes les fonctionnalités sont disponibles sans restriction. » À l'ouverture, l'application demande de créer un code maître de votre choix (aucun compte, aucun identifiant à fournir).

### Annonces

Non, l'application ne contient pas d'annonces.

### Sécurité des données

- **L'application collecte-t-elle ou partage-t-elle des données utilisateur ?** Oui (à cause des demandes réseau facultatives ci-dessous ; déclarer « Non » serait inexact).
- **Toutes les données sont-elles chiffrées en transit ?** Oui (HTTPS ; partage du foyer chiffré de bout en bout).
- **Les utilisateurs peuvent-ils demander la suppression ?** Oui : tout est sur le téléphone ; désinstaller l'application efface les données.
- Types de données à déclarer :

  | Type | Collectée | Partagée | Traitement | Facultatif | Finalité |
  | --- | --- | --- | --- | --- | --- |
  | Position approximative (zone de carte téléchargée, département suivi) | Oui | Non | Éphémère | Oui | Fonctionnalités de l'application |

- Ne pas déclarer : position précise (jamais envoyée par l'application ; l'envoi par SMS est une action de l'utilisateur dans sa messagerie), photos (restent sur l'appareil), identifiants (aucun), données de santé et inventaire (restent sur l'appareil), codes-barres (identifiant de produit, pas une donnée de l'utilisateur).

### Classification du contenu (questionnaire IARC)

- Catégorie : « Utilitaire, productivité, communication ou autre ».
- Violence, sexualité, langage, substances, jeux d'argent : Non. L'application n'affiche pas de violence ; le volet armes est un inventaire (texte et photos de l'utilisateur).
- Interaction entre utilisateurs, partage de contenu avec d'autres utilisateurs : Non (le partage du foyer relie deux appareils du même foyer, sans contenu public).
- Partage de la position avec d'autres utilisateurs : Non.
- Achats numériques : Non.

### Public cible et contenu

Tranche d'âge : 18 ans et plus uniquement. L'application n'attire pas particulièrement les enfants.

### Applications de santé

Cocher les fonctionnalités correspondantes : gestion des médicaments (inventaire et péremptions) et informations de premiers secours (fiches pratiques). Préciser que l'application n'est pas un dispositif médical et ne fournit ni diagnostic ni traitement.

### Autres déclarations

- Identifiant publicitaire : Non.
- Application gouvernementale : Non. Fonctions financières : Aucune. Application d'actualités : Non.
- Autorisation de position : premier plan uniquement (aucune demande d'accès en arrière-plan).
- Fonctions cachées : le code de contrainte est décrit dans la description complète ci-dessus ; le signaler aussi dans les notes pour l'examinateur si la Console le demande.

## Première publication (compte personnel)

1. Créer l'application dans la Play Console (nom « Fenrir », application gratuite).
2. Activer la signature d'application Play et envoyer `Fenrir-play-<version>.aab` (artefact `fenrir-play-aab` de la compilation GitHub, signé avec la clé d'envoi, voir `docs/google-play.md`).
3. Test fermé : au moins 12 testeurs inscrits pendant 14 jours d'affilée.
4. Demander l'accès à la production, puis publier.

## Images de la fiche

Dans `docs/play-store/` :

- `icone-512.png` : icône de la fiche (512 × 512).
- `banniere-1024x500.png` : image de présentation (1024 × 500).
- `captures/` : 7 captures de téléphone (1080 × 1920), prises sur l'aperçu de l'application avec les données d'exemple, dans l'ordre conseillé.
