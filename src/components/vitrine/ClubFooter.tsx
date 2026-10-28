import Link from 'next/link';
import { Camera, Globe, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import type { Club, Facility } from '@/types/database';
import type { NavLink } from './nav';

export function ClubFooter({ club, facilities, links }: { club: Club; facilities: Facility[]; links: NavLink[] }) {
  const social = club.social_links ?? {};
  return (
    <footer className="mt-16 bg-zinc-950 text-zinc-200">
      <div className="page-container grid gap-8 py-10 md:grid-cols-3">
        <div>
          <p className="text-lg font-bold text-white">{club.name}</p>
          <p className="mt-2 text-sm text-zinc-400">
            Association loi 1901{club.federation_name ? ` affiliée à la ${club.federation_name}` : ''}.
            {club.rna_number ? ` RNA ${club.rna_number}.` : ''}
          </p>
          <div className="mt-4 flex gap-2">
            {social.facebook ? (
              <a href={social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="flex size-11 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
                <Globe className="size-5" />
              </a>
            ) : null}
            {social.instagram ? (
              <a href={social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="flex size-11 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
                <Camera className="size-5" />
              </a>
            ) : null}
            {social.whatsapp ? (
              <a href={social.whatsapp} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="flex size-11 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
                <MessageCircle className="size-5" />
              </a>
            ) : null}
          </div>
        </div>
        <div>
          <p className="font-semibold text-white">Nous trouver</p>
          <ul className="mt-2 space-y-2 text-sm">
            {facilities.slice(0, 3).map((f) => (
              <li key={f.id} className="flex gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {f.name}, {f.address}, {f.postal_code} {f.city}
                </span>
              </li>
            ))}
            <li className="flex gap-2">
              <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
              <a href={`mailto:${club.contact_email}`} className="underline-offset-2 hover:underline">
                {club.contact_email}
              </a>
            </li>
            {club.contact_phone ? (
              <li className="flex gap-2">
                <Phone className="mt-0.5 size-4 shrink-0" aria-hidden />
                <a href={`tel:${club.contact_phone.replace(/\s/g, '')}`}>{club.contact_phone}</a>
              </li>
            ) : null}
          </ul>
        </div>
        <nav aria-label="Liens du pied de page">
          <p className="font-semibold text-white">Le club</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 text-sm md:grid-cols-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="flex min-h-9 items-center hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="page-container py-4 text-xs text-zinc-500">
          © {new Date().getFullYear()} {club.name} - Site propulsé par Licyo - Aucun cookie de suivi.
        </p>
      </div>
    </footer>
  );
}
