/**
 * Besoins de référence des enfants et des bébés, par jour. Les adultes
 * suivent les réglages de « Mon foyer ».
 *
 * Sources (EFSA, Autorité européenne de sécurité des aliments) :
 * - Eau : apports satisfaisants en eau totale (boissons et eau des
 *   aliments), « Dietary reference values for nutrients – Summary report »,
 *   2017, tableau 3 (doi:10.2903/sp.efsa.2017.e15121) : 6-12 mois 0,8-1,0 L ;
 *   1 an 1,1-1,2 L ; 2-3 ans 1,3 L ; 4-8 ans 1,6 L ; 9-13 ans 2,1 L (garçons),
 *   1,9 L (filles).
 * - Énergie : besoins moyens, « Scientific Opinion on Dietary Reference
 *   Values for energy », EFSA Journal 2013;11(1):3005, tableau des enfants
 *   et adolescents, en MJ/j (1 MJ = 239 kcal).
 *
 * Une seule valeur par catégorie : la moyenne des âges de la tranche, filles
 * et garçons, arrondie au-dessus.
 * - Enfant (3-13 ans) : eau, moyenne de 3 à 13 ans = 1,75 L → 1,8 L ;
 *   énergie à activité modérée (PAL 1,6), moyenne de 4 à 13 ans = 7,47 MJ
 *   (≈ 1 785 kcal) → 1 800 kcal.
 * - Bébé (moins de 3 ans) : eau, moyenne des plafonds 6-12 mois, 1 an et
 *   2-3 ans = 1,17 L → 1,2 L, eau des biberons comprise ; énergie à PAL 1,4
 *   (seule valeur donnée), moyenne de 1 et 2 ans = 3,75 MJ (≈ 896 kcal)
 *   → 900 kcal.
 */
export interface ReferenceNeeds {
  waterLiters: number;
  kcal: number;
}

export const CHILD_NEEDS: ReferenceNeeds = { waterLiters: 1.8, kcal: 1800 };

export const BABY_NEEDS: ReferenceNeeds = { waterLiters: 1.2, kcal: 900 };

export const NEEDS_SOURCE =
  'Moyennes par âge des références EFSA (eau totale 2017, énergie 2013). Bébé : préférer une eau « convient pour la préparation des aliments des nourrissons ».';
