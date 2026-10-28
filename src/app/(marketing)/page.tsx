import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, ClipboardCheck, CreditCard, FileText, Globe, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { InteractiveClubSimulator } from '@/components/marketing/InteractiveClubSimulator';
import { SPORTS_PRESETS } from '@/config/sports-presets';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Licyo - Le site et la gestion de votre club sportif',
  description: 'Site internet aux couleurs du club, inscriptions en ligne avec paiement, validation des dossiers en un clic, feuilles d\'appel hors ligne et attestations PDF. Pour tous les sports.',
};

const FEATURES = [
  { icon: Globe, title: 'Un vrai site de club', text: 'Équipes, horaires, résultats, actualités et partenaires, aux couleurs du club, sur son propre nom de domaine.' },
  { icon: FileText, title: 'Inscriptions en ligne', text: 'Toute la famille en une fois, photos prises au téléphone, questionnaire de santé, Pass\'Sport et signature au doigt.' },
  { icon: CreditCard, title: 'Paiement sans perte', text: 'Carte bancaire directement sur le compte du club, frais répercutés si vous le souhaitez, ou 3 chèques suivis mois par mois.' },
  { icon: ClipboardCheck, title: 'Validation en un clic', text: 'Le dossier à gauche, la pièce à droite. Une pièce floue ? La famille reçoit un lien pour la remplacer.' },
  { icon: Smartphone, title: "Feuille d'appel hors ligne", text: 'Les éducateurs font l\'appel au gymnase même sans réseau, avec les numéros d\'urgence sous la main.' },
  { icon: Mail, title: "E-mails depuis l'adresse du club", text: 'Connectez Gmail ou le serveur du club : les familles reçoivent les messages de leur club, pas d\'un inconnu.' },
];

export default function MarketingHome() {
  return (
    <>
      <section className="bg-gradient-to-b from-zinc-50 to-white">
        <div className="page-container py-14 md:py-20">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">Pour les bénévoles des clubs sportifs</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-extrabold leading-tight md:text-6xl">Le site de votre club et sa gestion, enfin au même endroit.</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Fini les dossiers papier incomplets et les tableurs. Les familles s'inscrivent et paient en ligne, le bureau valide en un clic, les éducateurs font l'appel sur leur téléphone.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/tarifs" className={buttonVariants({ size: 'lg' })}>Voir les tarifs</Link>
            <a href="#simulateur" className={buttonVariants({ size: 'lg', variant: 'outline' })}>Voir votre site en 10 secondes</a>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">{Object.values(SPORTS_PRESETS).map((s) => s.label).join(' · ')} et tous les autres sports.</p>
        </div>
      </section>

      <section id="simulateur" aria-labelledby="sim-titre" className="page-container py-12 md:py-16">
        <h2 id="sim-titre" className="mb-6 text-3xl font-bold">À quoi ressemblerait le site de votre club ?</h2>
        <InteractiveClubSimulator />
      </section>

      <section id="fonctionnalites" aria-labelledby="f-titre" className="bg-zinc-50">
        <div className="page-container py-12 md:py-16">
          <h2 id="f-titre" className="text-3xl font-bold">Tout ce dont un bureau a besoin, rien de plus</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-2xl border bg-white p-5">
                <Icon className="size-7 text-blue-700" aria-hidden />
                <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="ag-titre" className="page-container grid gap-8 py-12 md:grid-cols-2 md:py-16">
        <div>
          <h2 id="ag-titre" className="text-3xl font-bold">L'assemblée générale et la mairie, sans y passer le week-end</h2>
          <p className="mt-3 text-muted-foreground">Un clic produit le bilan de saison : effectifs, mineurs et majeurs, part des habitants de la commune pour les subventions, recettes par mode de paiement.</p>
        </div>
        <ul className="grid content-center gap-3">
          {['Attestations CE avec signature du président', 'Affiche du forum des associations avec QR code', 'Purge RGPD des anciennes saisons en un clic', 'Import des fichiers Footclubs et Ten\'Up'].map((t) => (
            <li key={t} className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />{t}</li>
          ))}
          <li className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />Données des mineurs cloisonnées par club, hébergées en Europe</li>
        </ul>
      </section>

      <section className="bg-zinc-900 text-white">
        <div className="page-container flex flex-wrap items-center justify-between gap-4 py-12">
          <p className="text-2xl font-bold">Prêt pour la prochaine saison ?</p>
          <Link href="/tarifs" className={buttonVariants({ size: 'lg', variant: 'secondary' })}>Demander un devis</Link>
        </div>
      </section>
    </>
  );
}
