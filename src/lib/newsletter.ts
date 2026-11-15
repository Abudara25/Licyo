// Newsletter aux familles : public, file d'envoi par lots, mise en forme, désinscription.
//
// - Public : responsables des inscriptions de la saison (toutes catégories ou certaines), et au choix les familles des
//   saisons passées. Une adresse = un e-mail (dédoublonnage), les désinscrits sont toujours exclus.
// - Envoi : un message programmé (ou « maintenant ») est préparé par la tâche planifiée, qui crée une ligne par
//   adresse (unique : jamais deux envois) puis envoie par lots. Une désinscription faite pendant l'envoi est respectée.
// - Mise en forme : texte simple (paragraphes, titres « ## », listes « - », **gras**, liens https). Aucun HTML libre.
// Module sans dépendance à Next.js : testé sur SQLite (tests/newsletter.test.ts).

import type { SqlDatabase } from './db/query.ts';

export type Audience = { categoryIds: string[]; includePastSeasons: boolean };

export function parseAudience(raw: unknown): Audience {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ids = Array.isArray(o.categoryIds) ? o.categoryIds.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50) : [];
  return { categoryIds: [...new Set(ids)], includePastSeasons: o.includePastSeasons === true };
}

type Row = Record<string, unknown>;
const all = async <T = Row>(db: SqlDatabase, sql: string, ...params: unknown[]) =>
  ((await db.prepare(sql).bind(...params).all<T>()).results ?? []) as T[];

export type Recipient = { email: string; firstName: string | null };

/** Destinataires d'un club pour un public donné (désinscrits exclus, une ligne par adresse). */
export async function resolveRecipients(db: SqlDatabase, club: { id: string; current_season: string }, audience: Audience): Promise<Recipient[]> {
  const params: unknown[] = [club.id];
  let season = '';
  if (!audience.includePastSeasons) {
    season = 'AND f.season = ?';
    params.push(club.current_season);
  }
  let categories = '';
  if (audience.categoryIds.length) {
    categories = `AND m.category_id IN (${audience.categoryIds.map(() => '?').join(',')})`;
    params.push(...audience.categoryIds);
  }
  params.push(club.id);
  const rows = await all<{ email: string; first_name: string }>(
    db,
    `SELECT lower(trim(f.payer_email)) AS email, min(f.payer_first_name) AS first_name
     FROM family_registrations f JOIN members m ON m.family_id = f.id
     WHERE f.club_id = ? ${season} ${categories} AND m.dossier_status NOT IN ('rejected')
       AND lower(trim(f.payer_email)) NOT IN (SELECT email FROM newsletter_unsubscribes WHERE club_id = ?)
     GROUP BY lower(trim(f.payer_email))
     ORDER BY email`,
    ...params,
  );
  return rows.filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)).map((r) => ({ email: r.email, firstName: r.first_name ?? null }));
}

// --- Mise en forme -----------------------------------------------------------------------------------------------

export type Inline = { text: string; bold?: boolean; href?: string };
export type Block = { type: 'p'; content: Inline[] } | { type: 'h'; content: Inline[] } | { type: 'ul'; items: Inline[][] };

function inlines(line: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|(https:\/\/[^\s<>"')]+)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index) });
    if (m[1]) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], href: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/** Texte saisi → blocs structurés (jamais de HTML brut). */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      blocks.push({ type: 'ul', items: lines.map((l) => inlines(l.replace(/^\s*[-•]\s+/, ''))) });
    } else if (lines.length === 1 && /^##\s+/.test(lines[0])) {
      blocks.push({ type: 'h', content: inlines(lines[0].replace(/^##\s+/, '')) });
    } else {
      blocks.push({ type: 'p', content: inlines(lines.join('\n')) });
    }
  }
  return blocks;
}

/** Version texte (partie text/plain de l'e-mail). */
export function bodyText(blocks: Block[]): string {
  const line = (c: Inline[]) => c.map((i) => (i.href && i.text !== i.href ? `${i.text} (${i.href})` : i.text)).join('');
  return blocks
    .map((b) => (b.type === 'ul' ? b.items.map((i) => `- ${line(i)}`).join('\n') : b.type === 'h' ? line(b.content).toUpperCase() : line(b.content)))
    .join('\n\n');
}

// --- Envoi ---------------------------------------------------------------------------------------------------------

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const unsubscribeTokenHash = sha256Hex;

export type NewsletterRow = { id: string; club_id: string; subject: string; body: string; audience: string };
export type DeliveryToSend = { newsletter: NewsletterRow; email: string; firstName: string | null; unsubscribeToken: string };
export type NewsletterSender = (d: DeliveryToSend) => Promise<void>;

/** Prépare les messages dont l'heure est venue : une ligne par destinataire, puis passage « en cours d'envoi ». */
async function prepareDue(db: SqlDatabase, now: Date): Promise<number> {
  const due = await all<NewsletterRow & { current_season: string }>(
    db,
    `SELECT n.id, n.club_id, n.subject, n.body, n.audience, c.current_season FROM newsletters n JOIN clubs c ON c.id = n.club_id
     WHERE n.status = 'scheduled' AND n.send_at <= ?`,
    now.toISOString(),
  );
  for (const n of due) {
    const claimed = await db.prepare("UPDATE newsletters SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'scheduled'").bind(now.toISOString(), n.id).run();
    if (Number(claimed.meta?.changes ?? 0) === 0) continue;
    const recipients = await resolveRecipients(db, { id: n.club_id, current_season: n.current_season }, parseAudience(JSON.parse(n.audience)));
    for (let i = 0; i < recipients.length; i += 50) {
      await db.batch(
        recipients.slice(i, i + 50).map((r) =>
          db
            .prepare('INSERT INTO newsletter_deliveries (id, newsletter_id, club_id, email, first_name, unsubscribe_token_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (newsletter_id, email) DO NOTHING')
            .bind(crypto.randomUUID(), n.id, n.club_id, r.email, r.firstName, `pending-${crypto.randomUUID()}`),
        ),
      );
    }
    await db.prepare('UPDATE newsletters SET recipient_count = ? WHERE id = ?').bind(recipients.length, n.id).run();
  }
  return due.length;
}

/**
 * Tâche planifiée « newsletter » : prépare les messages dus, puis envoie au plus `limit` e-mails. Chaque e-mail reçoit
 * son propre lien de désinscription (jeton neuf, empreinte stockée). Un message sans envoi restant passe « envoyé ».
 */
export async function processNewsletters(db: SqlDatabase, now: Date, send: NewsletterSender, limit = 200): Promise<string> {
  const prepared = await prepareDue(db, now);
  const pending = await all<{ id: string; newsletter_id: string; club_id: string; email: string; first_name: string | null }>(
    db,
    `SELECT d.id, d.newsletter_id, d.club_id, d.email, d.first_name FROM newsletter_deliveries d JOIN newsletters n ON n.id = d.newsletter_id
     WHERE d.status = 'pending' AND n.status = 'sending' ORDER BY n.send_at, d.email LIMIT ?`,
    limit,
  );
  const cache = new Map<string, NewsletterRow>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const d of pending) {
    const unsubscribed = await all(db, 'SELECT 1 FROM newsletter_unsubscribes WHERE club_id = ? AND email = ?', d.club_id, d.email);
    if (unsubscribed.length) {
      await db.prepare("UPDATE newsletter_deliveries SET status = 'skipped' WHERE id = ?").bind(d.id).run();
      skipped++;
      continue;
    }
    let newsletter = cache.get(d.newsletter_id);
    if (!newsletter) {
      newsletter = (await all<NewsletterRow>(db, 'SELECT id, club_id, subject, body, audience FROM newsletters WHERE id = ?', d.newsletter_id))[0];
      cache.set(d.newsletter_id, newsletter);
    }
    const token = newToken();
    await db.prepare('UPDATE newsletter_deliveries SET unsubscribe_token_hash = ? WHERE id = ?').bind(await sha256Hex(token), d.id).run();
    try {
      await send({ newsletter, email: d.email, firstName: d.first_name, unsubscribeToken: token });
      await db.prepare("UPDATE newsletter_deliveries SET status = 'sent', sent_at = ? WHERE id = ?").bind(now.toISOString(), d.id).run();
      sent++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 300);
      await db.prepare("UPDATE newsletter_deliveries SET status = 'failed', error = ? WHERE id = ?").bind(message, d.id).run();
      failed++;
    }
  }
  // Compteurs et fin d'envoi.
  for (const id of new Set(pending.map((d) => d.newsletter_id))) {
    await db
      .prepare(
        `UPDATE newsletters SET
           sent_count = (SELECT count(*) FROM newsletter_deliveries WHERE newsletter_id = ? AND status = 'sent'),
           failed_count = (SELECT count(*) FROM newsletter_deliveries WHERE newsletter_id = ? AND status = 'failed'),
           updated_at = ?
         WHERE id = ?`,
      )
      .bind(id, id, now.toISOString(), id)
      .run();
  }
  await db
    .prepare(
      `UPDATE newsletters SET status = 'sent', updated_at = ?
       WHERE status = 'sending' AND NOT EXISTS (SELECT 1 FROM newsletter_deliveries d WHERE d.newsletter_id = newsletters.id AND d.status = 'pending')`,
    )
    .bind(now.toISOString())
    .run();
  return `preparees=${prepared} envoyes=${sent} echecs=${failed} desinscrits=${skipped}`;
}

/** Désinscription par le jeton d'un e-mail reçu. Renvoie le club et l'adresse, ou null si le lien est inconnu. */
export async function unsubscribeByToken(db: SqlDatabase, token: string): Promise<{ clubId: string; email: string } | null> {
  if (!token || token.length > 100) return null;
  const rows = await all<{ club_id: string; email: string }>(db, 'SELECT club_id, email FROM newsletter_deliveries WHERE unsubscribe_token_hash = ?', await sha256Hex(token));
  const row = rows[0];
  if (!row) return null;
  await db.prepare('INSERT INTO newsletter_unsubscribes (club_id, email) VALUES (?, ?) ON CONFLICT (club_id, email) DO NOTHING').bind(row.club_id, row.email).run();
  return { clubId: row.club_id, email: row.email };
}
