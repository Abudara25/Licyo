import { getMembershipTiers } from '@/lib/platform-data';
import { PricingConfigurator } from '@/components/platform/PricingConfigurator';
export const dynamic = 'force-dynamic';
export default async function PricingPage() {
  const tiers = await getMembershipTiers();
  return (
    <div className="page-container section-space">
      <div className="page-heading">
        <span className="eyebrow">UNE OFFRE QUI GRANDIT AVEC VOUS</span>
        <h1>
          À chaque club,
          <br />
          sa juste mesure.
        </h1>
        <p>
          Votre abonnement dépend de votre nombre d’adhérents. Votre sport et
          votre modèle de site ne changent pas l’offre.
        </p>
      </div>
      <PricingConfigurator tiers={tiers} />
      <div className="faq-list">
        <h2>Tout simplement.</h2>
        {[
          [
            'Comment est calculé l’effectif ?',
            'Vous déclarez le nombre d’adhérents de votre saison. Le bureau peut le comparer aux inscriptions. Aucun changement de tarif n’est facturé automatiquement.',
          ],
          [
            'Puis-je changer de modèle ?',
            'Oui. Vos contenus et vos adhérents restent les mêmes lorsque vous changez l’apparence de votre site.',
          ],
          [
            'Puis-je désactiver une fonction ?',
            'Oui. Vous choisissez les modules utiles depuis votre back-office. Les données existantes sont conservées.',
          ],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
