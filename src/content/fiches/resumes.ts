/**
 * Résumés « En bref » des fiches : l'essentiel en une ou deux phrases, sans
 * information qui ne figure pas dans la fiche elle-même.
 */
export const RESUMES: Record<string, string> = {
  // Gestion de crise
  'regle-des-3':
    'Air, chaleur, eau, nourriture : l’ordre de grandeur de ce que le corps tolère, pour savoir par quoi commencer.',
  'gestion-stress-survie':
    'Une routine courte (s’arrêter, respirer, observer, décider) pour éviter les décisions précipitées sous la peur et la fatigue.',
  'kit-72h':
    'De quoi tenir trois jours sans aide : eau (2 L par personne et par jour au minimum), vivres sans cuisson, lampe, radio, trousse, papiers.',
  'plan-familial':
    'Contacts, points de ralliement, rôles et coupures décidés à l’avance, pour que chacun sache quoi faire sans pouvoir se joindre.',
  'besoins-par-personne':
    'Les besoins quotidiens par personne (eau, calories, énergie) utilisés par Fenrir pour calculer l’autonomie, modifiables dans Réglages.',
  'calendrier-entretien':
    'Ce qu’il faut vérifier chaque mois, chaque trimestre, chaque semestre et chaque année : détecteurs, batteries, eau, sacs, trousse.',
  'apres-la-crise':
    'Revenir avec prudence, se protéger pour nettoyer (gants, bottes, masque) et se laver souvent les mains.',
  'sauvegarde-donnees':
    'Trois copies des documents importants, sur deux supports, dont une hors du logement ; tester la restauration.',
  'bilan-mensuel':
    'Un quart d’heure par mois pour contrôler stocks, eau, énergie, radio, sacs, santé, contacts et documents.',
  'parcours-preparation':
    'Se préparer en huit étapes progressives, des risques du foyer jusqu’aux exercices, chacune utile seule.',
  'petit-budget':
    'Commencer par ce qui est gratuit, puis acheter dans l’ordre : eau, vivres, lumière, radio, santé, énergie.',

  // Risques et alertes
  'alerte-sirene':
    'Reconnaître la sirène et le message FR-Alert, puis appliquer la consigne : se mettre à l’abri et écouter la radio.',
  inondation:
    'Monter en hauteur, couper l’électricité et le gaz si possible, ne jamais traverser une zone inondée à pied ou en voiture.',
  seisme:
    'Pendant la secousse, s’abriter sous un meuble solide loin des fenêtres ; après, sortir avec prudence et couper le gaz.',
  'feu-de-foret':
    'En zone exposée, débroussailler et préparer le départ ; partir dès que les autorités l’ordonnent, sans traverser fumée ni flammes.',
  tempete:
    'Rentrer ce qui peut s’envoler, fermer volets et fenêtres, éviter les déplacements et ne pas toucher les câbles tombés.',
  canicule:
    'Boire régulièrement, se rafraîchir, fermer volets le jour et aérer la nuit, surveiller les personnes fragiles.',
  'grand-froid':
    'Chauffer une seule pièce sans boucher les aérations, s’habiller en couches, manger et boire chaud.',
  'accident-nucleaire':
    'Se mettre à l’abri, fermer portes et fenêtres, écouter la radio ; ne prendre l’iode que sur consigne des autorités.',
  'accident-chimique':
    'Se mettre immédiatement à l’abri dans le bâtiment le plus proche, fermer et calfeutrer, écouter les consignes.',
  'orage-foudre':
    'Si le tonnerre est audible, l’orage est assez proche pour être dangereux : s’abriter dans un bâtiment ou une voiture.',
  'crue-rapide':
    'Une pluie intense en amont peut faire monter l’eau en quelques minutes : s’éloigner des cours d’eau et gagner les hauteurs.',
  'fuite-gaz':
    'Ne rien allumer ni actionner, sortir et s’éloigner du bâtiment, puis appeler les secours une fois à distance.',

  // Santé
  'alerter-secours':
    'Protéger, alerter, secourir : écarter le danger, appeler le 15, le 18 ou le 112, et suivre les consignes de l’opérateur.',
  'rcp-arret-cardiaque':
    'Victime qui ne répond pas et ne respire pas normalement : appeler, masser fort et vite au centre de la poitrine, utiliser un défibrillateur.',
  pls: 'Victime inconsciente qui respire : la mettre sur le côté pour garder ses voies aériennes libres, puis surveiller sa respiration.',
  etouffement:
    'La personne ne peut plus parler ni tousser : donner des tapes dans le dos, puis des compressions abdominales.',
  garrot:
    'Hémorragie d’un membre que la compression n’arrête pas : poser un garrot au-dessus de la plaie, noter l’heure, ne pas le desserrer.',
  'hemorragie-compression':
    'Saignement abondant : appuyer fort et sans relâcher directement sur la plaie, puis alerter les secours.',
  'plaie-soin':
    'Nettoyer à l’eau propre, protéger d’un pansement et surveiller les signes d’infection qui imposent de consulter.',
  suture:
    'Ne fermer une plaie qu’en l’absence de soins dans les heures qui viennent, de préférence par strips ; au moindre signe d’infection, rouvrir et consulter.',
  brulures:
    'Refroidir longtemps à l’eau tempérée, retirer ce qui ne colle pas, couvrir proprement ; appeler les secours pour une brûlure grave.',
  fractures:
    'Ne pas bouger le membre, l’immobiliser dans la position trouvée et alerter ; vérifier la circulation en dessous.',
  hypothermie:
    'Mettre à l’abri, isoler du sol, retirer les vêtements mouillés et couvrir ; en cas de forme sévère, manipuler avec douceur et alerter.',
  gelures:
    'Peau blanche, dure et insensible : réchauffer seulement sans risque de regel, dans une eau à 37–39 °C, sans frotter ni masser.',
  'coup-de-chaleur':
    'Peau chaude, confusion, maux de tête : alerter, mettre au frais et refroidir activement la victime.',
  deshydratation:
    'Soif, urines foncées, vertiges : faire boire par petites gorgées, de préférence une solution de réhydratation orale.',
  anaphylaxie:
    'Gonflement, gêne respiratoire, malaise après un allergène : appeler le 15 et utiliser l’auto-injecteur d’adrénaline s’il est prescrit.',
  'avc-malaise':
    'Visage qui tombe, bras faible, parole troublée, ou douleur serrant la poitrine : appeler le 15 sans attendre, noter l’heure.',
  'morsures-piqures':
    'Vipère : allonger, immobiliser et appeler le 15 ; tique : retirer au tire-tique ; morsure d’animal : laver longuement et consulter.',
  'intoxication-co':
    'Gaz invisible et sans odeur : aérer, sortir tout le monde et appeler le 15 ou le 18 dès les premiers maux de tête ou nausées.',
  'trousse-secours':
    'Le contenu utile d’une trousse de secours et la vérification de ses dates deux fois par an.',
  'bilan-victime':
    'Repérer en quelques secondes une urgence vitale (conscience, respiration, saignement) avant d’alerter.',
  convulsions:
    'Protéger la tête, écarter les objets dangereux, ne rien mettre dans la bouche ; ensuite, sur le côté si la personne reste inconsciente et respire.',
  'diarrhee-vomissements':
    'Éviter la déshydratation par de petites gorgées fréquentes ; consulter devant les signes de gravité.',
  'medicaments-urgence':
    'Garder une réserve des traitements personnels avec ordonnance et notice, dans de bonnes conditions de conservation.',
  'toilettes-fortune':
    'Sans eau, ne pas tirer la chasse : utiliser un seau ou un sac doublé et évacuer les déchets à part.',
  'mains-sans-eau':
    'Se laver les mains avant de manger et après les toilettes, au savon avec peu d’eau ou au gel hydroalcoolique.',
  'dechets-eaux-grises':
    'Trier, fermer et éloigner les déchets du logement ; garder les eaux grises pour la chasse d’eau ou le nettoyage.',
  'fiche-medicale-personnelle':
    'Maladies, traitements, allergies et contacts médicaux notés sur une fiche par personne, sur papier et dans Documents.',

  // Eau potable
  'eau-potable':
    'Décanter, filtrer à travers un tissu propre, puis désinfecter l’eau avant de la boire.',
  'eau-javel':
    'Désinfecter une eau claire avec de l’eau de Javel sans parfum, au bon dosage et après le temps de contact indiqué.',
  'eau-trouver':
    'Où trouver de l’eau quand le réseau est coupé, et pourquoi toute eau trouvée doit être traitée avant d’être bue.',
  'eau-besoins-stockage':
    'Compter la boisson, la cuisine et l’hygiène séparément ; stocker dans des contenants alimentaires datés, à l’abri de la lumière.',
  'filtrer-eau-terrain':
    'Filtrer n’est pas désinfecter : un filtre retient des particules sans toujours éliminer virus, bactéries ou produits chimiques.',
  'collecte-eau-pluie':
    'Recueillir la pluie sur une surface propre, la stocker couverte et la traiter avant de la boire.',
  'comparer-traitements-eau':
    'Ébullition, comprimés, javel, filtres : ce que chaque méthode élimine, ses limites et son entretien.',
  'coupure-eau':
    'Suivre les consignes de la mairie, réserver l’eau potable à la boisson et à la cuisine, séparer et étiqueter les autres réserves.',

  // Alimentation
  rationnement:
    'Répartir les vivres sur la durée visée ; l’accueil calcule l’autonomie du foyer à partir des calories en stock.',
  'conservation-sans-frigo':
    'En coupure, garder réfrigérateur et congélateur fermés et consommer d’abord les produits frais.',
  'plantes-sauvages':
    'Ne consommer une plante sauvage qu’avec une identification certaine : la confusion avec une espèce toxique peut être mortelle.',
  'allergies-intolerances-stock':
    'Adapter la réserve aux allergies, intolérances et régimes du foyer, et les noter sur une fiche accessible.',
  'cuisson-sans-electricite':
    'Prévoir des aliments consommables sans cuisson et un moyen de cuisson sûr, utilisé selon sa notice.',
  'reserve-alimentaire':
    'Constituer une réserve avec des aliments que le foyer mange déjà, achetés progressivement et consommés par ordre de date.',
  'rotation-stocks':
    'Consommer d’abord ce qui périme d’abord, contrôler les conserves et jeter sans goûter celles qui sont bombées ou abîmées.',

  // Énergie
  'coupure-courant':
    'Priorités en cas de coupure : appareils médicaux, lumière, information, froid alimentaire ; groupe électrogène uniquement dehors.',
  'watts-wattheures':
    'Wh = W × heures : estimer la consommation des appareils et l’autonomie d’une batterie, pertes comprises.',
  'batteries-recharge':
    'Stocker, tester et recharger piles et batteries pour qu’elles soient prêtes le jour où le courant manque.',
  'groupe-electrogene':
    'Toujours dehors, loin des fenêtres et des aérations, avec un détecteur de monoxyde de carbone dans le logement.',

  // Habitat
  confinement:
    'Sur ordre des autorités : rentrer, fermer portes et fenêtres, couper la ventilation et écouter la radio.',
  'chauffage-appoint':
    'Un chauffage d’appoint à combustion s’utilise brièvement et par intermittence, pièce aérée, avec un détecteur de monoxyde de carbone.',
  'isolation-temporaire':
    'Garder la chaleur l’hiver ou la fraîcheur l’été en isolant une pièce, sans jamais boucher les aérations.',
  'couper-eau-gaz-electricite':
    'Repérer à l’avance les robinets et le disjoncteur, savoir les couper et montrer à chacun où ils sont.',

  // Évacuation
  'sac-evacuation':
    'Un sac par personne, prêt près de la sortie, organisé par modules et essayé chargé.',
  'papiers-importants':
    'Copies des papiers d’identité, ordonnances et contrats, chiffrées dans Documents, avec un peu d’argent liquide.',
  'animaux-domestiques-crise':
    'Eau, nourriture habituelle, laisse ou caisse de transport, litière et médicaments prescrits pour emmener les animaux.',
  'evacuation-enfants':
    'Décider qui accompagne chaque enfant et chaque personne dépendante, et préparer leurs besoins particuliers.',
  'quand-partir':
    'Décider à l’avance ce qui fera partir le foyer, pour ne pas hésiter au mauvais moment ; les ordres des autorités priment.',
  'reserve-vehicule':
    'Ce qu’il faut garder dans la voiture pour plusieurs heures bloquées, et les précautions si l’on reste à l’intérieur.',

  // Équipement et protection
  'armes-securite-reglementation':
    'Les quatre règles de sécurité, les catégories A à D, le stockage et les limites de la légitime défense : vérifier toujours le texte officiel en vigueur.',
  'protection-respiratoire':
    'Un filtre à particules n’arrête pas les gaz, aucun masque ne fournit d’oxygène : s’éloigner ou se mettre à l’abri reste la première protection.',
  'protections-balistiques':
    'Ce que protègent réellement gilets NIJ IIIA, plaques III et IV et casques FAST, leurs limites et comment vérifier une certification.',

  // Compléments
  'securite-domicile':
    'Accès, éclairage, détecteurs et alerte, sans jamais bloquer une issue de secours ; un plan que chaque membre du foyer connaît.',
  'stockage-domicile':
    'Stocker au sec, au frais, sans encombrer les issues ni surcharger les étagères, et retrouver chaque lot grâce à son emplacement.',
  'intrusion-attaque':
    'S’échapper si une sortie sûre existe, sinon se cacher et s’enfermer, puis alerter le 17 ou le 112 dès que c’est sans danger.',
  'epidemie-continuite':
    'Réserve de traitements, hygiène, isolement d’un malade et contacts avec les personnes isolées, en suivant les consignes de santé publique.',
  'evaluer-risques-foyer':
    'Consulter Géorisques et la mairie pour connaître les risques de son adresse, puis noter dépendances, personnes fragiles et ressources.',
  'rester-abri-partir':
    'Appliquer d’abord la consigne officielle ; sinon sortir si le danger est dans le logement, s’abriter s’il est dehors.',
  'emport-quotidien':
    'Ce que l’on garde toujours sur soi : téléphone chargé, lampe, contacts d’urgence, traitement du jour, eau.',
  'recharge-solaire':
    'Un panneau solaire produit bien moins en hiver et par temps couvert : il complète une réserve de batteries, il ne la remplace pas.',
  'plaie-penetrante':
    'Toujours urgente : alerter, comprimer le saignement, laisser l’objet planté, installer la victime et ne rien lui donner à boire.',

  // Communication
  morse:
    'Le code morse (lettres, chiffres, SOS) et son rythme, transmissible à la lampe, au sifflet ou au miroir.',
  'signaux-detresse':
    'SOS en morse et signal de détresse en montagne (six par minute) ; le 112 et la VHF canal 16 en mer.',
  'signaux-sol-air':
    'Lettres au sol d’au moins 3 mètres et gestes reconnus par les secours aériens.',
  'miroir-signal':
    'Viser avec deux doigts et faire clignoter le reflet : un éclat de miroir se voit de très loin par temps clair.',
  'alphabet-radio':
    'L’alphabet OTAN pour épeler sans erreur un nom, une plaque ou une position.',
  'radio-urgence':
    'Une radio à piles ou à manivelle pour recevoir les consignes, et les règles pour communiquer à courte portée.',
  'telephone-crise':
    'Le 112 passe par tout réseau disponible ; privilégier les SMS et économiser la batterie quand le réseau sature.',
  'message-urgence':
    'Qui, où, quoi, état, rappel : un message de détresse bref et structuré pour être localisé et rappelé.',
  'communiquer-sans-reseau':
    'Personne relais, messages courts, radio et point de regroupement décidés à l’avance pour quand rien ne passe.',

  // Orientation
  'boussole-carte':
    'Lire une carte et utiliser une boussole ; l’onglet Carte calcule distance et azimut entre deux positions.',
  'orientation-soleil-etoiles':
    'Trouver les points cardinaux avec le soleil ou les étoiles quand la boussole manque.',
  mgrs: 'Lire et transmettre une position MGRS : zone, carré de 100 km, puis coordonnées.',
  perdu:
    'S’arrêter, rester visible au même endroit et signaler sa présence plutôt que de marcher au hasard.',
  'azimut-pas-a-pas':
    'Prendre et suivre un azimut à la boussole, étape par étape, avec un itinéraire de repli.',
  'itineraire-retour':
    'Préparer son itinéraire de retour avant de partir, et savoir quoi faire si l’on perd le chemin.',

  // Autonomie en nature
  'feu-allumer':
    'Un feu a besoin de combustible, d’oxygène et de chaleur : préparer amadou, petit bois et bûches avant d’allumer.',
  'feu-sans-allumettes':
    'Garder toujours deux moyens d’allumage au sec, dans des endroits différents, et connaître une méthode de secours.',
  'feu-humide':
    'Chercher le bois mort encore sur pied ou accroché aux arbres, plus sec que celui au sol, et abriter le feu de la pluie.',
  abri: 'Isoler d’abord du sol, qui fait perdre beaucoup de chaleur, puis se protéger du vent et de la pluie.',
  noeuds:
    'Quelques nœuds utiles et leurs usages, dont une boucle fixe qui ne coulisse pas et se défait facilement.',
  'couteau-outils':
    'Toujours couper en éloignant la lame du corps : une blessure loin des secours peut devenir grave.',
  'rester-au-chaud':
    'Trois couches de vêtements, rester au sec et éviter le coton, pour garder la chaleur du corps.',
  'emplacement-bivouac':
    'Avant de s’installer, regarder au-dessus, au sol et autour : les dangers ne sont pas toujours visibles depuis le chemin.',
  'orientation-meteo':
    'Consulter d’abord les prévisions officielles ; observer le ciel ne remplace pas un bulletin.',
  'feu-campement-securite':
    'Vérifier les interdictions, choisir un emplacement sûr et éteindre complètement le feu avant de partir.',
  'eau-potable-hygiene':
    'Séparer la zone propre (cuisine, eau) de la zone sale (déchets, toilettes) pour éviter les contaminations au campement.',
};
