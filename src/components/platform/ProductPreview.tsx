import { ArrowUpRight, Check } from 'lucide-react';
export function ProductPreview() {
  return (
    <div className="product-preview">
      <div className="preview-top">
        <span className="preview-traffic">
          <i />
          <i />
          <i />
        </span>
        <span>Votre club, bien entouré</span>
        <span className="preview-avatar">CM</span>
      </div>
      <div className="preview-body">
        <aside>
          <div className="preview-logo">l.</div>
          {[
            'Vue d’ensemble',
            'Adhérents',
            'Inscriptions',
            'Trésorerie',
            'Mon site',
          ].map((x, i) => (
            <div key={x} className={i === 0 ? 'selected' : ''}>
              <span className="preview-dot" />
              <span>{x}</span>
            </div>
          ))}
        </aside>
        <div className="preview-main">
          <div className="preview-greeting">
            <div>
              <small>VOTRE ESPACE CLUB</small>
              <h3>Une belle saison commence.</h3>
            </div>
            <ArrowUpRight size={20} />
          </div>
          <div className="preview-stats">
            {[
              ['Adhérents', '248', '+ 18 cette saison'],
              ['Dossiers complets', '92 %', 'Tout avance'],
              ['Prochaine séance', '18:30', 'Aujourd’hui'],
            ].map(([a, b, c]) => (
              <div key={a}>
                <small>{a}</small>
                <strong>{b}</strong>
                <span>{c}</span>
              </div>
            ))}
          </div>
          <div className="preview-bottom">
            <div className="preview-list">
              <strong>Les dernières inscriptions</strong>
              {[
                ['AL', 'Alex Laurent', 'Dossier complet'],
                ['SD', 'Sam Dubois', 'Pièce à vérifier'],
                ['ML', 'Morgan Leroy', 'Dossier complet'],
              ].map(([i, n, s]) => (
                <div className="preview-person" key={i}>
                  <span className="preview-avatar">{i}</span>
                  <span>
                    <b>{n}</b>
                    <small>Adhésion annuelle</small>
                  </span>
                  <span
                    className={
                      s === 'Dossier complet'
                        ? 'preview-status'
                        : 'preview-pending'
                    }
                  >
                    <Check size={12} />
                    {s}
                  </span>
                </div>
              ))}
            </div>
            <div className="preview-chart">
              <small>UNE COMMUNAUTÉ QUI GRANDIT</small>
              <strong>
                Ensemble,
                <br />
                plus loin.
              </strong>
              <div className="chart-bars">
                {[35, 50, 43, 67, 61, 82, 100].map((x, i) => (
                  <i key={i} style={{ height: x + '%' }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
