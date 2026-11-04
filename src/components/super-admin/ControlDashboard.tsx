'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Search,
  Building2,
  TriangleAlert,
  CheckCircle2,
  Clock3,
} from 'lucide-react';
export type ControlClub = {
  id: string;
  name: string;
  sport_type: string;
  status: string;
  declared_member_count: number;
  demo_expires_at: string | null;
};
const labels: Record<string, string> = {
  active: 'Abonné',
  demo: 'En démonstration',
  suspended: 'Suspendu',
  archived: 'Archivé',
};
export function ControlDashboard({
  clubs,
  prospects,
  members,
  revenue,
  preview = false,
}: {
  clubs: ControlClub[];
  prospects: number;
  members: number;
  revenue: string;
  preview?: boolean;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const now = Date.now();
  const expiring = clubs.filter(
    (c) =>
      c.status === 'demo' &&
      c.demo_expires_at &&
      new Date(c.demo_expires_at).getTime() < now + 3 * 86400000,
  );
  const suspended = clubs.filter((c) => c.status === 'suspended');
  const active = clubs.filter((c) => c.status === 'active').length;
  const visible = clubs.filter(
    (c) =>
      (filter === 'all' || c.status === filter) &&
      (c.name + ' ' + c.sport_type)
        .toLocaleLowerCase('fr')
        .includes(q.toLocaleLowerCase('fr')),
  );
  const target = (path: string) =>
    preview
      ? '/decouvrir/pilotage?vue=' +
        ({ clubs: 1, crm: 2, offres: 3, 'demo-generator': 4, audit: 6 }[path] ??
          0)
      : '/super-admin/' + path;
  return (
    <>
      <div className="control-heading">
        <div>
          <p className="control-kicker">LICYO · VUE TRANSVERSALE</p>
          <h1>Centre de contrôle</h1>
          <p>Vos clients, votre activité, les décisions à prendre.</p>
        </div>
        <Link className="control-primary" href={target('demo-generator')}>
          Créer une démonstration <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="control-metrics">
        {[
          ['Clients abonnés', active, 'Sur ' + clubs.length + ' associations'],
          [
            'Effectif accompagné',
            members.toLocaleString('fr-FR'),
            'Adhérents validés',
          ],
          ['Pipeline commercial', prospects, 'Prospects ouverts'],
          ['Abonnements estimés', revenue, 'Par mois · grille actuelle'],
        ].map(([label, value, note]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <div className="control-columns">
        <section className="control-panel">
          <div className="control-panel-title">
            <h2>À traiter en priorité</h2>
            <span>{expiring.length + suspended.length} comptes</span>
          </div>
          <div className="control-signal">
            <Clock3 />
            <div>
              <strong>
                {expiring.length} démonstration{expiring.length > 1 ? 's' : ''}{' '}
                à relancer
              </strong>
              <p>Échéance passée ou prévue dans les 3 jours.</p>
            </div>
            <Link href={target('clubs')}>
              Examiner <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="control-signal">
            <TriangleAlert />
            <div>
              <strong>
                {suspended.length} compte{suspended.length > 1 ? 's' : ''}{' '}
                suspendu{suspended.length > 1 ? 's' : ''}
              </strong>
              <p>Vérifier le dossier avant une réactivation.</p>
            </div>
            <Link href={target('clubs')}>
              Examiner <ArrowUpRight size={15} />
            </Link>
          </div>
        </section>
        <section className="control-panel control-fleet">
          <div className="control-panel-title">
            <h2>Répartition du parc</h2>
            <Building2 size={18} />
          </div>
          {['active', 'demo', 'suspended'].map((s) => (
            <div key={s}>
              <span>{labels[s]}</span>
              <strong>{clubs.filter((c) => c.status === s).length}</strong>
              <div className="control-bar">
                <i
                  style={{
                    width:
                      (clubs.length
                        ? (clubs.filter((c) => c.status === s).length /
                            clubs.length) *
                          100
                        : 0) + '%',
                  }}
                />
              </div>
            </div>
          ))}
        </section>
      </div>
      <section className="control-panel">
        <div className="control-panel-title">
          <div>
            <p className="control-kicker">PORTEFEUILLE CLIENTS</p>
            <h2>Les associations de la plateforme</h2>
          </div>
          <Link href={target('clubs')}>
            Gestion des comptes <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="control-filters">
          <label>
            <Search size={18} />
            <input
              aria-label="Rechercher une association"
              placeholder="Rechercher un club, un sport…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select
            aria-label="Filtrer par statut"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Tous les statuts</option>
            {Object.entries(labels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="control-table-wrap">
          <table className="control-table">
            <thead>
              <tr>
                <th>Association</th>
                <th>Sport</th>
                <th>Effectif déclaré</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="control-monogram">
                      {c.name.substring(0, 2).toUpperCase()}
                    </span>
                    <strong>{c.name}</strong>
                  </td>
                  <td>{c.sport_type}</td>
                  <td>{c.declared_member_count.toLocaleString('fr-FR')}</td>
                  <td>
                    <span className={'control-status ' + c.status}>
                      {c.status === 'active' ? (
                        <CheckCircle2 size={13} />
                      ) : null}
                      {labels[c.status] ?? c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length ? (
          <p className="control-empty">
            Aucune association ne correspond à cette recherche.
          </p>
        ) : null}
        <div className="control-table-footer">
          {visible.length} association{visible.length > 1 ? 's' : ''} affichée
          {visible.length > 1 ? 's' : ''} · données de votre parc
        </div>
      </section>
    </>
  );
}
