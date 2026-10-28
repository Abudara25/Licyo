'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, Clock } from 'lucide-react';
import { DAY_LABELS, SPORTS_PRESETS } from '@/config/sports-presets';
import { readableTextColor } from '@/lib/utils/color-contrast';

/** Aperçu en direct du site d'un club : nom, sport et couleurs choisis par le visiteur. */
export function InteractiveClubSimulator() {
  const [sport, setSport] = useState('basketball');
  const preset = SPORTS_PRESETS[sport];
  const [name, setName] = useState('Union Sportive de ma ville');
  const [primary, setPrimary] = useState(preset.defaultPrimary);
  const [secondary, setSecondary] = useState(preset.defaultSecondary);
  const v = preset.vocabulary;
  const fg = readableTextColor(primary);
  const fg2 = readableTextColor(secondary);

  function pickSport(id: string) {
    setSport(id);
    setPrimary(SPORTS_PRESETS[id].defaultPrimary);
    setSecondary(SPORTS_PRESETS[id].defaultSecondary);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="grid content-start gap-4 rounded-2xl border bg-white p-4 md:p-5">
        <p className="font-semibold">Essayez avec votre club</p>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Nom du club</span>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="min-h-11 w-full rounded-lg border border-input px-3" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Sport</span>
          <select value={sport} onChange={(e) => pickSport(e.target.value)} className="min-h-11 w-full rounded-lg border border-input bg-white px-3">
            {Object.values(SPORTS_PRESETS).map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Couleur 1</span>
            <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-11 w-full cursor-pointer rounded-lg border" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Couleur 2</span>
            <input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="h-11 w-full cursor-pointer rounded-lg border" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Le texte passe automatiquement en clair ou en foncé pour rester lisible.</p>
      </div>

      <motion.div key={sport} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-2xl border bg-white shadow-lg" aria-label="Aperçu du site du club">
        <div className="flex items-center gap-1.5 border-b bg-zinc-100 px-3 py-2" aria-hidden>
          <span className="size-3 rounded-full bg-red-400" /><span className="size-3 rounded-full bg-amber-400" /><span className="size-3 rounded-full bg-emerald-400" />
          <span className="ml-3 truncate rounded bg-white px-2 py-0.5 text-xs text-zinc-500">{name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'mon-club'}.{(process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'licyo.fr').replace(/:\d+$/, '')}</span>
        </div>
        <div style={{ background: primary, color: fg }} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="truncate font-bold">{name || 'Mon club'}</span>
          <span style={{ background: secondary, color: fg2 }} className="shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold">S'inscrire</span>
        </div>
        <div style={{ background: primary, color: fg }} className="px-4 pb-8 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{preset.label}</p>
          <p className="mt-1 text-2xl font-extrabold md:text-3xl">{name || 'Mon club'}</p>
          <p className="mt-1 opacity-90">{v.tagline}</p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {preset.demo.categories.slice(0, 2).map((c, i) => (
            <div key={c.name} className="rounded-xl border p-3">
              <p className="font-semibold">{c.name}</p>
              <p className="text-sm text-zinc-500">{c.minAge}-{c.maxAge} ans - {c.price} € / an</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm"><Clock className="size-4" aria-hidden />{DAY_LABELS[preset.demo.schedules[i * 2][1]]} {preset.demo.schedules[i * 2][2]}</p>
            </div>
          ))}
          <div className="rounded-xl border p-3 sm:col-span-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><CalendarDays className="size-4" aria-hidden />Prochain rendez-vous</p>
            <p className="text-sm">{preset.demo.events[0].title}</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
