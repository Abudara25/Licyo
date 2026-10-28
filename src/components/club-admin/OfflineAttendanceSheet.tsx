'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CloudOff, Phone, RefreshCw } from 'lucide-react';
import { saveAttendance } from '@/actions/club-admin.actions';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils/cn';

export type RosterMember = { id: string; name: string; isMinor: boolean; canLeaveAlone: boolean; emergencyName: string; emergencyPhone: string };
export type RosterSlot = { scheduleId: string; label: string; weekday: number; members: RosterMember[] };
type Roster = { savedAt: string; slots: RosterSlot[] };
type QueuedSheet = { scheduleId: string; sessionDate: string; entries: { memberId: string; isPresent: boolean }[] };

const QUEUE_KEY = 'licyo-attendance-queue';

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage plein ou désactivé : l'appel reste possible en ligne.
  }
}

/**
 * Feuille d'appel mobile, utilisable sans réseau (gymnases, piscines).
 * La liste est copiée dans le téléphone à chaque ouverture en ligne ; les appels
 * faits hors ligne sont mis en file et renvoyés dès que la connexion revient.
 */
export function OfflineAttendanceSheet({ clubId, initialSlots, today }: { clubId: string; initialSlots: RosterSlot[] | null; today: string }) {
  const rosterKey = `licyo-roster-${clubId}`;
  const [roster, setRoster] = useState<Roster | null>(initialSlots ? { savedAt: new Date().toISOString(), slots: initialSlots } : null);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedSheet[]>([]);
  const [scheduleId, setScheduleId] = useState('');
  const [date, setDate] = useState(today);
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (initialSlots) writeStorage(rosterKey, { savedAt: new Date().toISOString(), slots: initialSlots });
    else setRoster(readStorage<Roster | null>(rosterKey, null));
    setQueue(readStorage<QueuedSheet[]>(QUEUE_KEY, []));
    setOnline(navigator.onLine);
  }, [initialSlots, rosterKey]);

  const slots = roster?.slots ?? [];
  const todayWeekday = ((new Date(`${date}T12:00:00`).getDay() + 6) % 7) + 1;
  useEffect(() => {
    if (!scheduleId && slots.length) {
      const filled = slots.filter((s) => s.members.length > 0);
      setScheduleId((filled.find((s) => s.weekday === todayWeekday) ?? filled[0] ?? slots[0]).scheduleId);
    }
  }, [slots, scheduleId, todayWeekday]);

  const slot = useMemo(() => slots.find((s) => s.scheduleId === scheduleId), [slots, scheduleId]);
  useEffect(() => {
    setPresence(Object.fromEntries((slot?.members ?? []).map((m) => [m.id, false])));
  }, [slot]);

  const flush = useCallback(async () => {
    const pending = readStorage<QueuedSheet[]>(QUEUE_KEY, []);
    if (!pending.length || !navigator.onLine) return;
    setSyncing(true);
    const remaining: QueuedSheet[] = [];
    for (const sheet of pending) {
      try {
        const res = await saveAttendance(sheet);
        if (!res.ok) remaining.push(sheet);
      } catch {
        remaining.push(sheet);
      }
    }
    writeStorage(QUEUE_KEY, remaining);
    setQueue(remaining);
    setSyncing(false);
    if (remaining.length < pending.length) toast.success(`${pending.length - remaining.length} appel(s) synchronisé(s).`);
  }, []);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      flush();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    flush();
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [flush]);

  async function submit() {
    if (!slot) return;
    const sheet: QueuedSheet = { scheduleId: slot.scheduleId, sessionDate: date, entries: slot.members.map((m) => ({ memberId: m.id, isPresent: Boolean(presence[m.id]) })) };
    if (navigator.onLine) {
      try {
        const res = await saveAttendance(sheet);
        if (res.ok) {
          toast.success('Appel enregistré.');
          return;
        }
        toast.error(res.error);
        return;
      } catch {
        // Réseau coupé pendant l'envoi : on bascule en file d'attente.
      }
    }
    const next = [...readStorage<QueuedSheet[]>(QUEUE_KEY, []).filter((q) => !(q.scheduleId === sheet.scheduleId && q.sessionDate === sheet.sessionDate)), sheet];
    writeStorage(QUEUE_KEY, next);
    setQueue(next);
    toast.info('Hors ligne : appel gardé sur le téléphone, envoi automatique au retour du réseau.');
  }

  if (!roster) {
    return <EmptyState title="Aucune liste disponible" description="Ouvrez cette page une première fois avec du réseau pour copier vos listes dans le téléphone." />;
  }

  const presentCount = Object.values(presence).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!online ? <Badge tone="warning"><CloudOff className="mr-1 size-3.5" aria-hidden />Hors ligne</Badge> : null}
        {queue.length > 0 ? (
          <Button size="sm" variant="outline" onClick={flush} disabled={syncing || !online}>
            <RefreshCw aria-hidden className={cn(syncing && 'animate-spin')} /> {queue.length} appel(s) à envoyer
          </Button>
        ) : null}
        {mounted ? <span className="text-xs text-muted-foreground">Liste copiée le {new Date(roster.savedAt).toLocaleString('fr-FR')}</span> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Créneau</span>
          <Select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            {slots.map((s) => <option key={s.scheduleId} value={s.scheduleId}>{s.label}</option>)}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Date</span>
          <input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 w-full rounded-lg border border-input bg-background px-3" />
        </label>
      </div>

      {slot && slot.members.length === 0 ? <p className="mt-4 text-muted-foreground">Aucun adhérent validé dans ce groupe.</p> : null}
      <ul className="mt-4 grid gap-2">
        {slot?.members.map((m) => (
          <li key={m.id} className={cn('rounded-xl border bg-white p-3', presence[m.id] && 'border-emerald-500 bg-emerald-50')}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3">
              <input type="checkbox" className="size-6 shrink-0" checked={Boolean(presence[m.id])} onChange={(e) => setPresence({ ...presence, [m.id]: e.target.checked })} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{m.name}</span>
                {m.isMinor ? (
                  <span className={cn('text-xs', m.canLeaveAlone ? 'text-emerald-700' : 'text-amber-700')}>{m.canLeaveAlone ? 'Peut partir seul' : 'Ne part pas seul'}</span>
                ) : null}
              </span>
            </label>
            {m.emergencyPhone ? (
              <a href={`tel:${m.emergencyPhone.replace(/\s/g, '')}`} className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm text-blue-700 underline">
                <Phone className="size-4" aria-hidden /> Urgence : {m.emergencyName || 'contact'} {m.emergencyPhone}
              </a>
            ) : null}
          </li>
        ))}
      </ul>

      {slot && slot.members.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 backdrop-blur safe-bottom">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 pt-3">
            <p className="text-sm font-medium tabular-nums">{presentCount} / {slot.members.length} présent(s)</p>
            <Button size="lg" onClick={submit}>Enregistrer l'appel</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
