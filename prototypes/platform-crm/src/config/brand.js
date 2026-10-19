// Identité du produit : SEUL fichier du prototype où apparaît le nom affiché.
//
// Le nom actuel est un NOM DE TRAVAIL (workingName: false), pas le nom définitif du SaaS. Il se remplace en modifiant
// uniquement ce fichier. Il ne doit jamais devenir une contrainte technique : ni domaine, ni package, ni table,
// ni API, ni permission, ni rôle, ni préfixe métier, ni identifiant persistant. Les données et le code emploient
// les concepts génériques de la baseline (platform, organization, plan, entitlement, capability, domain…).
export const BRAND = Object.freeze({
  productName: 'Licyo',
  productShortName: 'Licyo',
  platformName: 'Licyo Platform',
  platformLabel: 'Platform',
  productDescription: 'Console de pilotage des organisations clientes',
  workingName: false,
});

// Monogramme du logo, dérivé du nom : changer le nom change aussi le logo.
export const brandInitial = () => BRAND.productShortName.trim().charAt(0).toUpperCase() || '·';
