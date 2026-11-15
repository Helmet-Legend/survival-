/**
 * Aide à la reconnaissance des champignons : 40 espèces courantes en France,
 * une clé en trois questions et les réflexes en cas d'intoxication.
 *
 * Ce n'est PAS un outil d'identification : l'application ne donne jamais de
 * feu vert pour consommer. L'ANSES déconseille d'identifier un champignon à
 * manger avec une application ; chaque cueillette doit être vérifiée par un
 * pharmacien ou une association mycologique.
 *
 * À FAIRE VALIDER : descriptions rédigées d'après les guides mycologiques
 * grand public et les recommandations de l'ANSES et des centres antipoison.
 * Elles doivent être relues par un mycologue avant toute diffusion, comme
 * l'identification des photos (Wikimedia Commons).
 */

export type MushroomGroup = 'mortel' | 'toxique' | 'comestible';

export interface Lookalike {
  /** Espèce avec laquelle on la confond. */
  name: string;
  /** Ce qui permet de les distinguer. */
  how: string;
}

export interface Mushroom {
  id: string;
  name: string;
  latin: string;
  group: MushroomGroup;
  /** Chapeau. */
  cap: string;
  /** Dessous du chapeau : lames, tubes, plis, aiguillons. */
  under: string;
  /** Pied : anneau, volve, couleur. */
  stem: string;
  /** Milieu et saison. */
  where: string;
  /** Danger (espèces toxiques et mortelles) ou précaution (comestibles). */
  warning: string;
  lookalikes: readonly Lookalike[];
}

export const MUSHROOM_GROUPS: Record<
  MushroomGroup,
  { label: string; badge: string; hint: string }
> = {
  mortel: {
    label: 'Mortels',
    badge: 'MORTEL',
    hint: 'Les espèces qui tuent chaque année : à connaître en premier.',
  },
  toxique: {
    label: 'Toxiques',
    badge: 'TOXIQUE',
    hint: 'Troubles sérieux, parfois une hospitalisation.',
  },
  comestible: {
    label: 'Comestibles ⚠',
    badge: 'COMESTIBLE ⚠',
    hint: 'Comestibles, mais chacun a un sosie toxique ou mortel. Faites toujours vérifier votre cueillette.',
  },
};

/** Bandeau affiché sur tous les écrans de la fiche. */
export const MUSHROOM_WARNING =
  'Aide à la reconnaissance, pas un feu vert. Ne consommez jamais un champignon identifié avec une application, celle-ci comprise : faites vérifier chaque cueillette par un pharmacien ou une association mycologique.';

export const MUSHROOM_SOURCES =
  'Sources : ANSES, centres antipoison, guides mycologiques. Fiche à faire valider par un mycologue.';

const m = (
  id: string,
  name: string,
  latin: string,
  group: MushroomGroup,
  fields: Omit<Mushroom, 'id' | 'name' | 'latin' | 'group'>,
): Mushroom => ({ id, name, latin, group, ...fields });

export const MUSHROOMS: readonly Mushroom[] = [
  // --- Mortels ---------------------------------------------------------------
  m('amanita-phalloides', 'Amanite phalloïde', 'Amanita phalloides', 'mortel', {
    cap: 'Vert olive à jaunâtre, parfois presque blanc, avec de fines fibres rayonnantes.',
    under: 'Lames blanches, serrées, libres.',
    stem: 'Blanc, souvent chiné de vert pâle, avec un anneau blanc et une volve blanche en sac à la base, souvent enterrée : déterrez le pied entier.',
    where:
      'Sous les feuillus (chênes, hêtres, châtaigniers), de l’été à l’automne.',
    warning:
      'Responsable de la plupart des intoxications mortelles. Les premiers troubles arrivent tard, souvent plus de 6 heures après le repas, puis le foie est atteint.',
    lookalikes: [
      {
        name: 'Rosé des prés',
        how: 'lames roses puis brunes, jamais de volve.',
      },
      {
        name: 'Russules vertes',
        how: 'ni anneau ni volve, chair qui casse comme de la craie.',
      },
    ],
  }),
  m('amanita-virosa', 'Amanite vireuse', 'Amanita virosa', 'mortel', {
    cap: 'Entièrement blanc, d’abord conique puis étalé, un peu visqueux par temps humide.',
    under: 'Lames blanches, libres.',
    stem: 'Blanc et pelucheux, anneau fragile souvent déchiré, volve blanche en sac.',
    where:
      'Sous les conifères et les feuillus, sols acides, de l’été à l’automne.',
    warning:
      'Aussi dangereuse que l’amanite phalloïde : atteinte du foie, symptômes tardifs.',
    lookalikes: [
      {
        name: 'Rosé des prés et agarics blancs',
        how: 'lames roses à brunes, pas de volve.',
      },
    ],
  }),
  m('amanita-verna', 'Amanite printanière', 'Amanita verna', 'mortel', {
    cap: 'Blanc, parfois crème au centre, lisse.',
    under: 'Lames blanches, libres.',
    stem: 'Blanc, anneau blanc, volve blanche en sac.',
    where:
      'Sous les feuillus, surtout dans le sud, au printemps et au début de l’été.',
    warning:
      'Mêmes toxines que l’amanite phalloïde : atteinte du foie, symptômes tardifs.',
    lookalikes: [
      {
        name: 'Mousseron de la Saint-Georges',
        how: 'ni anneau ni volve, forte odeur de farine.',
      },
      { name: 'Agarics blancs', how: 'lames roses puis brunes, pas de volve.' },
    ],
  }),
  m(
    'cortinarius-orellanus',
    'Cortinaire couleur de rocou',
    'Cortinarius orellanus',
    'mortel',
    {
      cap: 'Orange fauve à brun roux, mat, de 3 à 8 cm.',
      under: 'Lames espacées, orange puis couleur rouille.',
      stem: 'Fauve, sans anneau, parfois avec des restes de voile en filaments.',
      where:
        'Sous les feuillus et les conifères, sols acides, de l’été à l’automne.',
      warning:
        'Détruit les reins. Les premiers signes peuvent n’apparaître que 2 jours à 3 semaines après le repas.',
      lookalikes: [
        {
          name: 'Petits champignons roux des sous-bois',
          how: 'ne jamais consommer un champignon à lames couleur rouille.',
        },
      ],
    },
  ),
  m(
    'cortinarius-rubellus',
    'Cortinaire très joli',
    'Cortinarius rubellus',
    'mortel',
    {
      cap: 'Roux orangé, fibreux, en cône avec un mamelon pointu.',
      under: 'Lames couleur rouille.',
      stem: 'Fauve, avec des bracelets jaunâtres.',
      where: 'Sous les conifères humides, dans les mousses, à l’automne.',
      warning:
        'Détruit les reins, avec des symptômes très tardifs, comme le cortinaire couleur de rocou.',
      lookalikes: [
        {
          name: 'Chanterelle en tube',
          how: 'plis épais au lieu de lames, pied creux jaune.',
        },
      ],
    },
  ),
  m('galerina-marginata', 'Galère marginée', 'Galerina marginata', 'mortel', {
    cap: 'Petit (2 à 5 cm), brun miel, qui pâlit en séchant.',
    under: 'Lames brun rouille.',
    stem: 'Fin, avec un petit anneau ; dessous de l’anneau fibreux et brun foncé, sans écailles.',
    where:
      'En touffes sur le bois mort, surtout de conifères, de l’été au début de l’hiver.',
    warning:
      'Contient les mêmes toxines que l’amanite phalloïde : atteinte du foie.',
    lookalikes: [
      {
        name: 'Pholiote changeante',
        how: 'pied couvert de petites écailles sous l’anneau. La confusion est fréquente : faites vérifier.',
      },
    ],
  }),
  m(
    'lepiota-brunneoincarnata',
    'Lépiote brun-rose',
    'Lepiota brunneoincarnata',
    'mortel',
    {
      cap: 'Petit (3 à 6 cm), couvert d’écailles brun rosé sur fond pâle.',
      under: 'Lames blanches, libres.',
      stem: 'Rosé, avec une zone d’anneau et des marbrures brunes.',
      where: 'Parcs, jardins, bords de chemins, de l’été à l’automne.',
      warning:
        'Contient les mêmes toxines que l’amanite phalloïde : atteinte du foie.',
      lookalikes: [
        {
          name: 'Coulemelle',
          how: 'bien plus grande (chapeau de plus de 10 cm), anneau double qui coulisse. Ne jamais cueillir de petite lépiote.',
        },
      ],
    },
  ),
  m('lepiota-helveola', 'Lépiote helvéole', 'Lepiota helveola', 'mortel', {
    cap: 'Petit (2 à 5 cm), à écailles brun rougeâtre sur fond rosé.',
    under: 'Lames blanches, libres.',
    stem: 'Rosé, anneau fragile qui disparaît vite.',
    where: 'Prairies, jardins, bords de chemins, de l’été à l’automne.',
    warning:
      'Contient les mêmes toxines que l’amanite phalloïde : atteinte du foie.',
    lookalikes: [
      {
        name: 'Coulemelle',
        how: 'bien plus grande, chapeau de plus de 10 cm. Ne jamais cueillir de petite lépiote.',
      },
    ],
  }),
  m('gyromitra-esculenta', 'Gyromitre', 'Gyromitra esculenta', 'mortel', {
    cap: 'Brun rouge à brun foncé, plissé comme une cervelle, sans alvéoles régulières.',
    under: 'Pas de lames : intérieur cloisonné en plusieurs cavités.',
    stem: 'Blanchâtre, court, creux et irrégulier.',
    where: 'Sous les conifères, sols sableux, au printemps.',
    warning:
      'Toxique même cuite : troubles digestifs, puis atteinte du foie et du système nerveux. Sa vente est interdite en France.',
    lookalikes: [
      {
        name: 'Morille',
        how: 'chapeau alvéolé en nid d’abeille, intérieur creux d’un seul tenant.',
      },
    ],
  }),
  m('paxillus-involutus', 'Paxille enroulé', 'Paxillus involutus', 'mortel', {
    cap: 'Brun olive, centre creusé, bord enroulé et feutré.',
    under:
      'Lames qui descendent sur le pied, jaune brun, tachées de brun au toucher.',
    stem: 'Court, brunâtre, sans anneau.',
    where: 'Sous les feuillus, surtout les bouleaux, de l’été à l’automne.',
    warning:
      'Longtemps cru comestible. Après plusieurs repas, il peut détruire les globules rouges, parfois mortellement.',
    lookalikes: [
      {
        name: 'Lactaires',
        how: 'laissent couler un lait à la cassure ; le paxille n’en a pas.',
      },
    ],
  }),

  // --- Toxiques --------------------------------------------------------------
  m('amanita-pantherina', 'Amanite panthère', 'Amanita pantherina', 'toxique', {
    cap: 'Brun à brun gris, couvert de petits flocons blancs.',
    under: 'Lames blanches, libres.',
    stem: 'Blanc, anneau lisse, volve en bourrelet serré à la base.',
    where: 'Sous les feuillus et les conifères, de l’été à l’automne.',
    warning:
      'Troubles nerveux : agitation, confusion, hallucinations, parfois coma.',
    lookalikes: [
      {
        name: 'Amanite rougissante',
        how: 'chair qui rougit à la coupe et aux morsures d’insectes. Faites vérifier.',
      },
    ],
  }),
  m('amanita-muscaria', 'Amanite tue-mouches', 'Amanita muscaria', 'toxique', {
    cap: 'Rouge vif à orangé, avec des flocons blancs que la pluie peut effacer.',
    under: 'Lames blanches.',
    stem: 'Blanc, anneau blanc, base renflée entourée de bourrelets.',
    where: 'Sous les bouleaux et les conifères, de l’été à l’automne.',
    warning: 'Troubles nerveux : agitation, confusion, hallucinations.',
    lookalikes: [
      {
        name: 'Amanite des Césars',
        how: 'lames et pied jaunes, grande volve blanche en sac.',
      },
    ],
  }),
  m('entoloma-sinuatum', 'Entolome livide', 'Entoloma sinuatum', 'toxique', {
    cap: 'Gros (8 à 20 cm), gris crème, lisse.',
    under: 'Lames jaunâtres, puis rose saumon.',
    stem: 'Blanc, plein, sans anneau ni volve. Odeur de farine.',
    where: 'Sous les feuillus, à l’automne.',
    warning: 'Troubles digestifs violents, parfois une hospitalisation.',
    lookalikes: [
      {
        name: 'Mousseron de la Saint-Georges',
        how: 'pousse au printemps, lames blanches qui ne rosissent pas.',
      },
    ],
  }),
  m(
    'omphalotus-olearius',
    'Clitocybe de l’olivier',
    'Omphalotus olearius',
    'toxique',
    {
      cap: 'Orange vif, creusé au centre.',
      under: 'Vraies lames fines et serrées, qui descendent sur le pied.',
      stem: 'Orange, en touffes serrées.',
      where:
        'Sur les souches et les racines de feuillus (oliviers, chênes, châtaigniers), surtout dans le sud, de l’été à l’automne.',
      warning: 'Troubles digestifs sévères.',
      lookalikes: [
        {
          name: 'Girolle',
          how: 'plis épais et non lames, pousse dans le sol et non en touffes sur le bois.',
        },
      ],
    },
  ),
  m('rubroboletus-satanas', 'Bolet Satan', 'Rubroboletus satanas', 'toxique', {
    cap: 'Gros, blanc grisâtre.',
    under: 'Tubes à pores rouges.',
    stem: 'Ventru, jaune à rouge, couvert d’un réseau rouge. La chair bleuit à la coupe.',
    where: 'Sous les feuillus, sols calcaires, en été.',
    warning: 'Troubles digestifs violents.',
    lookalikes: [
      {
        name: 'Cèpe de Bordeaux',
        how: 'pores blancs puis jaune verdâtre, chair blanche qui ne bleuit pas.',
      },
    ],
  }),
  m(
    'clitocybe-dealbata',
    'Clitocybe blanchâtre',
    'Clitocybe dealbata',
    'toxique',
    {
      cap: 'Petit, blanc, comme givré.',
      under: 'Lames blanchâtres, serrées, qui descendent sur le pied.',
      stem: 'Court, blanchâtre.',
      where: 'Prairies et pelouses, souvent en ronds, de l’été à l’automne.',
      warning:
        'Sueurs, salivation, troubles digestifs et cardiaques peu après le repas (muscarine).',
      lookalikes: [
        {
          name: 'Marasme des Oréades',
          how: 'chapeau fauve, lames espacées, pied coriace qui se tord sans casser.',
        },
      ],
    },
  ),
  m(
    'inosperma-erubescens',
    'Inocybe de Patouillard',
    'Inosperma erubescens',
    'toxique',
    {
      cap: 'Conique, fibreux, blanc puis taché de rouge en vieillissant.',
      under: 'Lames pâles puis brunes, qui rougissent.',
      stem: 'Blanc, rougissant, sans anneau.',
      where: 'Sous les feuillus, sols calcaires, du printemps à l’été.',
      warning:
        'Riche en muscarine : sueurs, salivation, troubles cardiaques, parfois mortels.',
      lookalikes: [
        {
          name: 'Mousseron de la Saint-Georges',
          how: 'lames blanches serrées, forte odeur de farine, ne rougit pas.',
        },
      ],
    },
  ),
  m(
    'tricholoma-pardinum',
    'Tricholome tigré',
    'Tricholoma pardinum',
    'toxique',
    {
      cap: 'Gris pâle, couvert de petites écailles grises disposées comme un pelage.',
      under: 'Lames crème, serrées.',
      stem: 'Blanc, épais. Odeur de farine.',
      where:
        'Sous les feuillus et les conifères, sols calcaires, souvent en montagne, à l’automne.',
      warning: 'Troubles digestifs violents.',
      lookalikes: [
        {
          name: 'Tricholome terreux',
          how: 'plus petit, chapeau gris souris feutré, sans odeur de farine.',
        },
      ],
    },
  ),
  m(
    'tricholoma-equestre',
    'Tricholome équestre',
    'Tricholoma equestre',
    'toxique',
    {
      cap: 'Jaune verdâtre, centre plus brun.',
      under: 'Lames jaune soufre.',
      stem: 'Jaune.',
      where: 'Pinèdes sableuses, à l’automne.',
      warning:
        'Autrefois réputé comestible. Des repas répétés ont causé des atteintes graves des muscles, parfois mortelles.',
      lookalikes: [
        {
          name: 'Tricholome soufré',
          how: 'odeur forte de gaz d’éclairage, également toxique.',
        },
      ],
    },
  ),
  m(
    'hypholoma-fasciculare',
    'Hypholome en touffe',
    'Hypholoma fasciculare',
    'toxique',
    {
      cap: 'Jaune soufre, centre orangé.',
      under: 'Lames jaune verdâtre, puis noirâtres.',
      stem: 'Jaune, en touffes serrées. Saveur très amère.',
      where: 'Sur les souches et le bois mort, presque toute l’année.',
      warning: 'Troubles digestifs.',
      lookalikes: [
        {
          name: 'Pholiote changeante',
          how: 'pied écailleux sous l’anneau, lames brunes, pas d’amertume.',
        },
      ],
    },
  ),
  m(
    'agaricus-xanthodermus',
    'Agaric jaunissant',
    'Agaricus xanthodermus',
    'toxique',
    {
      cap: 'Blanc, jaunit vite au frottement.',
      under: 'Lames roses, puis brun chocolat.',
      stem: 'Blanc, anneau ; la base jaunit vivement à la coupe. Odeur d’encre ou de phénol.',
      where: 'Parcs, prairies, bords de chemins, de l’été à l’automne.',
      warning: 'Troubles digestifs.',
      lookalikes: [
        {
          name: 'Rosé des prés',
          how: 'ne jaunit pas à la coupe, odeur agréable.',
        },
      ],
    },
  ),
  m('ramaria-formosa', 'Ramaire élégante', 'Ramaria formosa', 'toxique', {
    cap: 'Pas de chapeau : touffe ramifiée en forme de corail.',
    under: 'Rameaux rose saumon à pointes jaunes.',
    stem: 'Base blanchâtre épaisse.',
    where: 'Sous les feuillus, de l’été à l’automne.',
    warning: 'Troubles digestifs, effet laxatif.',
    lookalikes: [
      {
        name: 'Autres ramaires',
        how: 'difficiles à distinguer sans loupe : ne pas consommer de ramaire.',
      },
    ],
  }),
  m(
    'scleroderma-citrinum',
    'Scléroderme commun',
    'Scleroderma citrinum',
    'toxique',
    {
      cap: 'Boule jaune ocre, peau épaisse craquelée en écailles, sans pied net.',
      under: 'Chair blanche puis noire violacée à maturité.',
      stem: 'Pas de vrai pied, quelques filaments à la base.',
      where:
        'Sols acides, sous les feuillus et les conifères, de l’été à l’automne.',
      warning: 'Troubles digestifs.',
      lookalikes: [
        {
          name: 'Vesses-de-loup',
          how: 'peau fine, chair blanche et homogène quand elles sont jeunes.',
        },
      ],
    },
  ),
  m('mycena-pura', 'Mycène pure', 'Mycena pura', 'toxique', {
    cap: 'Petit, rose lilas, strié au bord.',
    under: 'Lames pâles, rosées.',
    stem: 'Fin, creux, rosé. Odeur de radis.',
    where: 'Sous les feuillus et les conifères, de l’été à l’automne.',
    warning:
      'Contient de la muscarine : sueurs, salivation, troubles digestifs.',
    lookalikes: [
      {
        name: 'Laccaire améthyste',
        how: 'violet intense, lames épaisses et espacées, sans odeur de radis.',
      },
    ],
  }),

  // --- Comestibles avec un sosie dangereux -----------------------------------
  m('cantharellus-cibarius', 'Girolle', 'Cantharellus cibarius', 'comestible', {
    cap: 'Jaune d’œuf, bord ondulé.',
    under:
      'Plis épais et fourchus, et non de vraies lames, qui descendent sur le pied.',
    stem: 'Jaune, plein. Chair blanche, ferme, odeur fruitée.',
    where:
      'Sous les feuillus et les conifères, dans le sol, de l’été à l’automne.',
    warning: 'Bien cuire. Ne jamais confondre plis et lames.',
    lookalikes: [
      {
        name: 'Clitocybe de l’olivier',
        how: 'vraies lames fines, pousse en touffes sur le bois. Toxique.',
      },
      {
        name: 'Fausse girolle',
        how: 'lames orange fines et serrées, chair molle.',
      },
    ],
  }),
  m('boletus-edulis', 'Cèpe de Bordeaux', 'Boletus edulis', 'comestible', {
    cap: 'Brun clair à brun foncé, lisse.',
    under: 'Tubes à pores blancs, puis jaune verdâtre.',
    stem: 'Ventru, couvert d’un fin réseau blanc. Chair blanche qui ne bleuit pas.',
    where: 'Sous les feuillus et les conifères, de l’été à l’automne.',
    warning:
      'Bien cuire. Tout bolet à pores rouges ou dont la chair bleuit doit être écarté.',
    lookalikes: [
      { name: 'Bolet Satan', how: 'pores rouges, chair qui bleuit. Toxique.' },
      {
        name: 'Bolet amer',
        how: 'pores rosés, réseau brun sur le pied, goût très amer.',
      },
    ],
  }),
  m(
    'macrolepiota-procera',
    'Coulemelle',
    'Macrolepiota procera',
    'comestible',
    {
      cap: 'Grand (10 à 30 cm), couvert d’écailles brunes, avec un mamelon central.',
      under: 'Lames blanches, libres.',
      stem: 'Haut, chiné de brun, anneau double qui coulisse le long du pied.',
      where: 'Prairies, lisières, clairières, de l’été à l’automne.',
      warning:
        'Ne jamais cueillir de spécimen dont le chapeau mesure moins de 10 cm : les petites lépiotes sont mortelles.',
      lookalikes: [
        {
          name: 'Lépiotes brun-rose et helvéole',
          how: 'petites (moins de 6 cm), anneau fixe ou fragile. Mortelles.',
        },
        {
          name: 'Amanite panthère',
          how: 'volve à la base, flocons blancs sur le chapeau. Toxique.',
        },
      ],
    },
  ),
  m(
    'agaricus-campestris',
    'Rosé des prés',
    'Agaricus campestris',
    'comestible',
    {
      cap: 'Blanc soyeux.',
      under: 'Lames roses, puis brun chocolat, jamais blanches.',
      stem: 'Blanc, anneau fragile, pas de volve. Odeur agréable.',
      where: 'Prairies pâturées, de l’été à l’automne.',
      warning:
        'Un champignon blanc à lames blanches n’est pas un rosé des prés.',
      lookalikes: [
        {
          name: 'Amanites phalloïde et vireuse',
          how: 'lames blanches, volve en sac. Mortelles.',
        },
        {
          name: 'Agaric jaunissant',
          how: 'jaunit vivement à la coupe, odeur d’encre. Toxique.',
        },
      ],
    },
  ),
  m(
    'morchella-esculenta',
    'Morille commune',
    'Morchella esculenta',
    'comestible',
    {
      cap: 'Alvéolé comme un nid d’abeille, jaune à brun.',
      under: 'Intérieur creux d’un seul tenant, du chapeau au pied.',
      stem: 'Blanchâtre, creux.',
      where: 'Lisières, vergers, terrains remués, au printemps.',
      warning: 'Toxique crue ou mal cuite : toujours bien cuire.',
      lookalikes: [
        {
          name: 'Gyromitre',
          how: 'chapeau plissé en cervelle, intérieur cloisonné. Mortelle.',
        },
      ],
    },
  ),
  m(
    'craterellus-cornucopioides',
    'Trompette de la mort',
    'Craterellus cornucopioides',
    'comestible',
    {
      cap: 'En forme de trompette, gris noir, creux jusqu’à la base.',
      under: 'Face externe lisse ou un peu ridée, grise.',
      stem: 'Prolonge le chapeau, sans séparation nette.',
      where: 'Sous les feuillus, en groupes, à l’automne.',
      warning:
        'Bien cuire. Rester sur des spécimens typiques, entièrement creux.',
      lookalikes: [
        {
          name: 'Petits champignons sombres',
          how: 'avec de vraies lames ou un pied plein, ce n’est pas une trompette.',
        },
      ],
    },
  ),
  m('hydnum-repandum', 'Pied-de-mouton', 'Hydnum repandum', 'comestible', {
    cap: 'Crème à orangé pâle, irrégulier.',
    under: 'Petits aiguillons serrés, et non des lames.',
    stem: 'Court, blanchâtre.',
    where: 'Sous les feuillus et les conifères, de l’été à l’automne.',
    warning: 'Bien cuire. Les aiguillons sont le critère essentiel.',
    lookalikes: [
      {
        name: 'Champignons pâles à lames',
        how: 'sans aiguillons, ce n’est pas un pied-de-mouton.',
      },
    ],
  }),
  m(
    'craterellus-tubaeformis',
    'Chanterelle en tube',
    'Craterellus tubaeformis',
    'comestible',
    {
      cap: 'Brun, creusé au centre.',
      under: 'Plis gris jaunâtre, fourchus, qui descendent sur le pied.',
      stem: 'Jaune, creux.',
      where: 'Sous les conifères, dans les mousses, à l’automne.',
      warning:
        'Bien cuire. Vérifier chaque spécimen : un sosie mortel pousse au même endroit.',
      lookalikes: [
        {
          name: 'Cortinaire très joli',
          how: 'vraies lames couleur rouille, chapeau à mamelon pointu. Mortel.',
        },
      ],
    },
  ),
  m(
    'calocybe-gambosa',
    'Mousseron de la Saint-Georges',
    'Calocybe gambosa',
    'comestible',
    {
      cap: 'Blanc crème, charnu.',
      under: 'Lames blanches, très serrées.',
      stem: 'Blanc, trapu, sans anneau. Forte odeur de farine.',
      where:
        'Prairies et lisières, souvent en ronds, au printemps (avril, mai).',
      warning:
        'Plusieurs espèces toxiques ou mortelles poussent à la même saison.',
      lookalikes: [
        {
          name: 'Inocybe de Patouillard',
          how: 'chapeau conique fibreux qui rougit. Toxique.',
        },
        {
          name: 'Amanite printanière',
          how: 'anneau et volve en sac. Mortelle.',
        },
        {
          name: 'Entolome livide',
          how: 'lames qui deviennent rose saumon, pousse à l’automne. Toxique.',
        },
      ],
    },
  ),
  m(
    'pleurotus-ostreatus',
    'Pleurote en huître',
    'Pleurotus ostreatus',
    'comestible',
    {
      cap: 'Gris à brun, en forme de coquille, en étages.',
      under: 'Lames blanches qui descendent sur un pied très court.',
      stem: 'Court, latéral, ou absent.',
      where: 'Sur le bois de feuillus, de l’automne à l’hiver.',
      warning: 'Bien cuire.',
      lookalikes: [
        {
          name: 'Clitocybe de l’olivier',
          how: 'orange vif, en touffes. Toxique.',
        },
      ],
    },
  ),
  m(
    'lactarius-deliciosus',
    'Lactaire délicieux',
    'Lactarius deliciosus',
    'comestible',
    {
      cap: 'Orange, marqué de cercles plus foncés, verdit en vieillissant.',
      under: 'Lames orange, qui laissent couler un lait orange carotte.',
      stem: 'Orange, creux, parfois taché.',
      where: 'Sous les pins, à l’automne.',
      warning: 'Bien cuire. Le lait orange est le critère essentiel.',
      lookalikes: [
        {
          name: 'Lactaire à toison',
          how: 'bord du chapeau poilu, lait blanc et très âcre. Toxique.',
        },
      ],
    },
  ),
  m(
    'amanita-caesarea',
    'Amanite des Césars',
    'Amanita caesarea',
    'comestible',
    {
      cap: 'Orange vif, lisse, sans flocons.',
      under: 'Lames jaunes.',
      stem: 'Jaune, anneau jaune, grande volve blanche en sac.',
      where:
        'Sous les chênes et les châtaigniers, surtout dans le sud, de l’été à l’automne.',
      warning:
        'Jeune, encore enfermée dans sa volve, elle ressemble à un œuf : coupez-le, un intérieur blanc peut être une amanite mortelle.',
      lookalikes: [
        {
          name: 'Amanite tue-mouches',
          how: 'lames et pied blancs, flocons blancs. Toxique.',
        },
        {
          name: 'Amanite phalloïde jeune',
          how: '« œuf » à intérieur blanc. Mortelle.',
        },
      ],
    },
  ),
  m(
    'russula-cyanoxantha',
    'Russule charbonnière',
    'Russula cyanoxantha',
    'comestible',
    {
      cap: 'Couleur variable : violet, vert, gris, souvent mêlés.',
      under: 'Lames blanches, souples, grasses au toucher, qui ne cassent pas.',
      stem: 'Blanc, sans anneau ni volve.',
      where: 'Sous les feuillus, de l’été à l’automne.',
      warning:
        'Les russules à chapeau vert ressemblent à l’amanite phalloïde : vérifiez toujours la base du pied.',
      lookalikes: [
        { name: 'Amanite phalloïde', how: 'anneau et volve en sac. Mortelle.' },
      ],
    },
  ),
  m(
    'marasmius-oreades',
    'Marasme des Oréades',
    'Marasmius oreades',
    'comestible',
    {
      cap: 'Petit, fauve pâle, avec un mamelon.',
      under: 'Lames crème, épaisses et espacées.',
      stem: 'Fin, coriace : il se tord sans casser.',
      where: 'Prairies et pelouses, en ronds, du printemps à l’automne.',
      warning:
        'Pousse au même endroit que le clitocybe blanchâtre : vérifier chaque spécimen.',
      lookalikes: [
        {
          name: 'Clitocybe blanchâtre',
          how: 'blanc, lames serrées qui descendent sur le pied. Toxique.',
        },
      ],
    },
  ),
  m('coprinus-comatus', 'Coprin chevelu', 'Coprinus comatus', 'comestible', {
    cap: 'Blanc, allongé en forme d’obus, couvert de mèches.',
    under: 'Lames blanches, puis roses, qui noircissent et se liquéfient.',
    stem: 'Blanc, creux, anneau mobile.',
    where: 'Bords de chemins, pelouses, terrains remués, de l’été à l’automne.',
    warning:
      'À consommer très jeune, lames encore blanches, le jour de la cueillette.',
    lookalikes: [
      {
        name: 'Coprin noir d’encre',
        how: 'chapeau gris, sans mèches. Toxique avec l’alcool, même pris plusieurs jours après.',
      },
    ],
  }),
  m(
    'kuehneromyces-mutabilis',
    'Pholiote changeante',
    'Kuehneromyces mutabilis',
    'comestible',
    {
      cap: 'Brun miel, plus clair au centre en séchant (deux tons).',
      under: 'Lames crème puis brunes.',
      stem: 'Anneau ; sous l’anneau, le pied est couvert de petites écailles.',
      where: 'En touffes sur les souches de feuillus, presque toute l’année.',
      warning:
        'Sosie mortel très proche sur le même bois : à réserver aux connaisseurs, après vérification.',
      lookalikes: [
        {
          name: 'Galère marginée',
          how: 'pied fibreux et non écailleux sous l’anneau. Mortelle.',
        },
      ],
    },
  ),
];

/** Espèce par identifiant. */
export function mushroomById(id: string): Mushroom | undefined {
  return MUSHROOMS.find(x => x.id === id);
}

/** Recherche par nom français ou latin, sans tenir compte des accents. */
export function searchMushrooms(
  query: string,
  group?: MushroomGroup,
): Mushroom[] {
  const fold = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = fold(query.trim());
  return MUSHROOMS.filter(
    x =>
      (group === undefined || x.group === group) &&
      (q === '' || fold(`${x.name} ${x.latin}`).includes(q)),
  );
}

// --- Caractéristiques : questions d'orientation ------------------------------

export type KeyNode = 'q1' | 'q2' | 'q3';
export type KeyResultId =
  | 'amanite'
  | 'doute'
  | 'anneau'
  | 'sans'
  | 'tubes'
  | 'plis';

export interface KeyQuestion {
  question: string;
  help: string;
  answers: ReadonlyArray<{
    label: string;
    help: string;
    next: KeyNode | KeyResultId;
  }>;
}

export interface KeyResult {
  danger: boolean;
  title: string;
  text: string;
  /** Espèces possibles, à faire vérifier, jamais une identification. */
  species: readonly string[];
}

export const KEY_QUESTIONS: Record<KeyNode, KeyQuestion> = {
  q1: {
    question: 'Que voyez-vous sous le chapeau ?',
    help: 'Retournez le champignon.',
    answers: [
      { label: 'Des lames', help: 'Fines feuilles serrées', next: 'q2' },
      { label: 'Des tubes', help: 'Comme une éponge', next: 'tubes' },
      {
        label: 'Des plis',
        help: 'Nervures épaisses qui descendent sur le pied',
        next: 'plis',
      },
    ],
  },
  q2: {
    question: 'Y a-t-il une volve à la base du pied ?',
    help: 'Une sorte de sac ou d’œuf, souvent enterré : déterrez le pied entier.',
    answers: [
      { label: 'Oui', help: 'Sac ou bourrelet à la base', next: 'amanite' },
      { label: 'Non', help: 'Pied net à la base', next: 'q3' },
      { label: 'Je ne sais pas', help: 'Pied coupé ou abîmé', next: 'doute' },
    ],
  },
  q3: {
    question: 'Y a-t-il un anneau sur le pied ?',
    help: 'Une collerette, comme une jupe.',
    answers: [
      { label: 'Oui', help: 'Collerette nette', next: 'anneau' },
      { label: 'Non', help: 'Pied sans collerette', next: 'sans' },
    ],
  },
};

export const KEY_RESULTS: Record<KeyResultId, KeyResult> = {
  amanite: {
    danger: true,
    title: 'Groupe des amanites',
    text: 'Il compte les champignons les plus mortels d’Europe. Ne le consommez pas et ne le mélangez pas à votre panier.',
    species: ['amanita-phalloides', 'amanita-virosa', 'amanita-pantherina'],
  },
  doute: {
    danger: true,
    title: 'Volve impossible à vérifier',
    text: 'Sans la base du pied, on ne peut pas écarter une amanite mortelle. Ne le consommez pas.',
    species: ['amanita-phalloides', 'amanita-virosa'],
  },
  anneau: {
    danger: false,
    title: 'Lames et anneau, sans volve',
    text: 'Ce groupe mêle des espèces recherchées et des espèces mortelles très semblables.',
    species: [
      'macrolepiota-procera',
      'agaricus-campestris',
      'lepiota-brunneoincarnata',
      'galerina-marginata',
    ],
  },
  sans: {
    danger: false,
    title: 'Lames, ni volve ni anneau',
    text: 'Groupe très vaste, avec des espèces toxiques et mortelles. Comparez les fiches, puis faites vérifier.',
    species: [
      'entoloma-sinuatum',
      'cortinarius-orellanus',
      'omphalotus-olearius',
      'clitocybe-dealbata',
    ],
  },
  tubes: {
    danger: false,
    title: 'Champignons à tubes (bolets)',
    text: 'Certains sont toxiques. Regardez la couleur des pores et du pied, et si la chair bleuit à la coupe.',
    species: ['boletus-edulis', 'rubroboletus-satanas'],
  },
  plis: {
    danger: false,
    title: 'Plis sous le chapeau',
    text: 'Les girolles ont des plis, mais leurs sosies toxiques ont de vraies lames. Regardez de près.',
    species: [
      'cantharellus-cibarius',
      'craterellus-tubaeformis',
      'omphalotus-olearius',
    ],
  },
};

export function isKeyResult(step: KeyNode | KeyResultId): step is KeyResultId {
  return !(step in KEY_QUESTIONS);
}

// --- Intoxication --------------------------------------------------------------

export const POISONING_STEPS: readonly string[] = [
  'Appelez immédiatement le 15 ou un centre antipoison, même si les troubles semblent légers.',
  'Des troubles qui commencent plus de 6 heures après le repas peuvent signaler une intoxication grave.',
  'Gardez les restes de la cueillette, ou une photo, pour aider à identifier l’espèce.',
  'Notez l’heure du repas et celle des premiers troubles.',
  'Prévenez les autres personnes qui ont partagé le repas.',
];

// --- Photos ----------------------------------------------------------------------

/** Auteur et licence de chaque photo (clé : nom du fichier sans extension). */
export const MUSHROOM_PHOTO_CREDITS: Record<string, string> = {
  'amanita-phalloides-1':
    'Krzysztof Ślusarczyk (upload by Marek Ślusarczyk) · CC BY 3.0',
  'amanita-phalloides-2': 'Archenzo, œuvre dérivée de Ak ccm · CC BY-SA 3.0',
  'amanita-virosa-1': 'Cephas · CC BY-SA 4.0',
  'amanita-virosa-2': 'Lameiro · CC BY-SA 4.0',
  'amanita-verna-1': 'James St. John · CC BY 2.0',
  'amanita-verna-2': 'Roberto Petruzzo · CC BY-SA 2.5',
  'cortinarius-orellanus-1': 'Andreas Kunze · CC BY-SA 3.0',
  'cortinarius-orellanus-2': 'Andreas Kunze · CC BY-SA 3.0',
  'cortinarius-rubellus-1': 'Andreas Kunze · CC BY-SA 3.0',
  'cortinarius-rubellus-2': 'Andreas Kunze · CC BY-SA 3.0',
  'galerina-marginata-1':
    'Dan Molter (shroomydan), Mushroom Observer · CC BY-SA 3.0',
  'galerina-marginata-2':
    'Dan Molter (shroomydan), Mushroom Observer · CC BY-SA 3.0',
  'lepiota-brunneoincarnata-1': 'Strobilomyces · CC BY-SA 4.0',
  'lepiota-brunneoincarnata-2': 'Strobilomyces · CC BY-SA 3.0',
  'lepiota-helveola-1': 'Renée Lebeuf · CC0',
  'gyromitra-esculenta-1': 'Jason Hollinger · CC BY 2.0',
  'gyromitra-esculenta-2': 'ChristianSW · CC0',
  'paxillus-involutus-1': 'Achim Lammerts (Syntaxys) · CC BY-SA 4.0',
  'paxillus-involutus-2': 'Achim Lammerts (Syntaxys) · CC BY-SA 4.0',
  'amanita-pantherina-1':
    'ccfarmer (Prst), œuvre dérivée de Ak ccm · CC BY-SA 3.0',
  'amanita-pantherina-2': 'Thomas Pruß · CC BY-SA 3.0',
  'amanita-muscaria-1': 'Scott Darbey from Canada · CC BY 2.0',
  'amanita-muscaria-2': 'Alberto Cemborain · CC BY 3.0',
  'entoloma-sinuatum-1': 'Archenzo, œuvre dérivée de Ak ccm · CC BY-SA 3.0',
  'entoloma-sinuatum-2': 'zaca, Mushroom Observer · CC BY-SA 3.0',
  'omphalotus-olearius-1': 'Epitalon · CC BY-SA 4.0',
  'omphalotus-olearius-2': 'Henk Monster · CC BY 3.0',
  'rubroboletus-satanas-1':
    'Irene Andersson (irenea), Mushroom Observer · CC BY-SA 3.0',
  'rubroboletus-satanas-2':
    'Murselin Guney (Beyrek), Mushroom Observer · CC BY-SA 3.0',
  'clitocybe-dealbata-1': 'Dick Culbert from Gibsons, B.C., Canada · CC BY 2.0',
  'inosperma-erubescens-1': 'Andreas Kunze · CC BY-SA 3.0',
  'inosperma-erubescens-2': 'Andreas Kunze · CC BY-SA 3.0',
  'tricholoma-pardinum-1':
    'David Rust (incredulis), Mushroom Observer · CC BY-SA 3.0',
  'tricholoma-pardinum-2': 'Ryane Snow, œuvre dérivée de Ak ccm · CC BY-SA 3.0',
  'tricholoma-equestre-1':
    'Copyright ©2011 Britney, Mushroom Observer · CC BY-SA 3.0',
  'hypholoma-fasciculare-1': 'Kreuzschnabel · CC BY-SA 3.0',
  'hypholoma-fasciculare-2': 'Achim Lammerts (Syntaxys) · CC BY-SA 4.0',
  'agaricus-xanthodermus-1':
    'Lord Mayonnaise, Mushroom Observer · CC BY-SA 3.0',
  'agaricus-xanthodermus-2':
    'Copyright ©2011 Byrain, Mushroom Observer · CC BY-SA 3.0',
  'ramaria-formosa-1':
    'Steve Nelsen (sfnelsen), Mushroom Observer · CC BY-SA 3.0',
  'ramaria-formosa-2': 'Jose Angel Urquia Goitia · CC BY-SA 4.0',
  'scleroderma-citrinum-1': 'Hans Hillewaert · CC BY-SA 4.0',
  'scleroderma-citrinum-2': 'Herbert Baker, Mushroom Observer · CC BY-SA 3.0',
  'mycena-pura-1': 'Dr. Hans-Günter Wagner · CC BY-SA 2.0',
  'mycena-pura-2': 'Andre Hosper · CC BY-SA 4.0',
  'cantharellus-cibarius-1': 'Andreas Kunze · CC BY-SA 4.0',
  'cantharellus-cibarius-2': 'Björn S... · CC BY-SA 2.0',
  'boletus-edulis-1': 'Holger Krisp · CC BY 3.0',
  'boletus-edulis-2': 'Bernie · Public domain',
  'macrolepiota-procera-1': 'Gouwenaar · CC BY-SA 4.0',
  'macrolepiota-procera-2': 'Gouwenaar · CC BY-SA 4.0',
  'agaricus-campestris-1': 'Andreas Kunze · CC BY-SA 3.0',
  'agaricus-campestris-2': 'Ak ccm · CC BY-SA 3.0',
  'morchella-esculenta-1': 'Achim Lammerts (Syntaxys) · CC BY-SA 4.0',
  'morchella-esculenta-2': 'Andreas Kunze · CC BY-SA 3.0',
  'craterellus-cornucopioides-1': 'Holger Krisp · CC BY 3.0',
  'craterellus-cornucopioides-2': 'Jean-Pol GRANDMONT · CC BY 3.0',
  'hydnum-repandum-1': 'Alan Rockefeller, Mushroom Observer · CC BY-SA 3.0',
  'hydnum-repandum-2': 'Scott Darbey from Canada · CC BY 2.0',
  'craterellus-tubaeformis-1': '{{{2}}}, Mushroom Observer · CC BY-SA 3.0',
  'craterellus-tubaeformis-2': 'Andreas Kunze · CC BY-SA 3.0',
  'calocybe-gambosa-1': 'Strobilomyces · CC BY-SA 4.0',
  'calocybe-gambosa-2': 'Andreas Kunze · CC BY-SA 3.0',
  'pleurotus-ostreatus-1': 'Achim Lammerts (Syntaxys) · CC BY-SA 4.0',
  'pleurotus-ostreatus-2': 'Holger Krisp · CC BY 3.0',
  'lactarius-deliciosus-1':
    'furtwangl from West Seattle, œuvre dérivée · CC BY 2.0',
  'lactarius-deliciosus-2': 'Holger Krisp · CC BY 3.0',
  'amanita-caesarea-1': 'GLJIVARSKO DRUSTVO NIS from Serbia · CC BY 2.0',
  'amanita-caesarea-2':
    'Murselin Guney (Beyrek), Mushroom Observer · CC BY-SA 3.0',
  'russula-cyanoxantha-1': 'Holger Krisp · CC BY 3.0',
  'russula-cyanoxantha-2': 'Jean-Pol GRANDMONT · CC BY 3.0',
  'marasmius-oreades-1': 'Lord Mayonnaise, Mushroom Observer · CC BY-SA 3.0',
  'marasmius-oreades-2': 'Lord Mayonnaise, Mushroom Observer · CC BY-SA 3.0',
  'coprinus-comatus-1': 'Agnes Monkelbaan · CC BY-SA 4.0',
  'coprinus-comatus-2': 'Agnes Monkelbaan · CC BY-SA 4.0',
  'kuehneromyces-mutabilis-1': 'Achim Lammerts (Syntaxys) · CC BY-SA 4.0',
  'kuehneromyces-mutabilis-2': 'Achim Lammerts (Syntaxys) · CC BY-SA 4.0',
};

/** Photos d'une espèce (une ou deux), dans l'ordre d'affichage. */
export function mushroomPhotos(id: string): string[] {
  return [`${id}-1`, `${id}-2`].filter(k => k in MUSHROOM_PHOTO_CREDITS);
}
