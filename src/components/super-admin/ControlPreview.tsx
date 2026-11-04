import Link from 'next/link';
import { ControlShell } from './ControlShell';
import { ControlDashboard, type ControlClub } from './ControlDashboard';
const clubs: ControlClub[] = [
  {
    id: '1',
    name: 'Les Étoiles',
    sport_type: 'Football',
    status: 'active',
    declared_member_count: 148,
    demo_expires_at: null,
  },
  {
    id: '2',
    name: 'Mouvement',
    sport_type: 'Muay thaï',
    status: 'active',
    declared_member_count: 76,
    demo_expires_at: null,
  },
  {
    id: '3',
    name: 'La Traversée',
    sport_type: 'Natation',
    status: 'demo',
    declared_member_count: 320,
    demo_expires_at: '2026-11-05',
  },
  {
    id: '4',
    name: 'Altitude',
    sport_type: 'Escalade',
    status: 'suspended',
    declared_member_count: 92,
    demo_expires_at: null,
  },
  {
    id: '5',
    name: 'Le Cercle',
    sport_type: 'Basketball',
    status: 'active',
    declared_member_count: 211,
    demo_expires_at: null,
  },
];
const titles = [
  'Centre de contrôle',
  'Parc clients',
  'Pipeline commercial',
  'Offres et abonnements',
  'Création de démos',
  'Import de clients',
  'Journal de contrôle',
];
export function ControlPreview({ view = '0' }: { view?: string }) {
  const index = Number(view);
  return (
    <ControlShell preview previewView={index}>
      {index === 0 || index === 1 ? (
        <ControlDashboard
          clubs={clubs}
          prospects={12}
          members={847}
          revenue="Tarifs à définir"
          preview
        />
      ) : (
        <>
          <div className="control-heading">
            <div>
              <p className="control-kicker">DÉMONSTRATION DU PILOTAGE</p>
              <h1>{titles[index] ?? titles[0]}</h1>
              <p>Un espace réservé à la direction de Licyo.</p>
            </div>
          </div>
          <section className="control-panel">
            <div className="control-panel-title">
              <h2>
                {index === 2
                  ? 'Vos prochaines opportunités'
                  : index === 3
                    ? 'Une grille adaptée à l’effectif'
                    : index === 6
                      ? 'Traçabilité des opérations'
                      : 'Outils de gestion de la plateforme'}
              </h2>
            </div>
            {index === 2 ? (
              <div className="control-demo-list">
                {[
                  'Nouvelle demande · Club Horizon · Tennis · 120 adhérents',
                  'Démonstration en cours · La Traversée · Natation · 320 adhérents',
                  'Devis à préparer · Association Tempo · Danse · 85 adhérents',
                ].map((t) => (
                  <p key={t}>{t}</p>
                ))}
              </div>
            ) : index === 3 ? (
              <div className="control-demo-list">
                {[
                  '0 à 100 adhérents · Essentiel',
                  '101 à 300 adhérents · Collectif',
                  '301 à 700 adhérents · Élan',
                  '701 et plus · Sur mesure',
                ].map((t) => (
                  <p key={t}>
                    {t}
                    <small>Montant à définir depuis votre CRM</small>
                  </p>
                ))}
              </div>
            ) : index === 6 ? (
              <div className="control-demo-list">
                <p>
                  Exemple · Configuration des modules modifiée
                  <small>
                    Chaque action sensible du pilotage est associée à son
                    auteur.
                  </small>
                </p>
              </div>
            ) : (
              <p className="control-empty">
                La création et l’import de comptes sont disponibles dans
                l’administration authentifiée.
              </p>
            )}
            <div className="control-table-footer">
              <Link href="/decouvrir/pilotage">
                Revenir au centre de contrôle →
              </Link>
            </div>
          </section>
        </>
      )}
    </ControlShell>
  );
}
