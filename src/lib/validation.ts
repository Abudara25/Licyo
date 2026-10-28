import { z } from 'zod';

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

const phone = z
  .string()
  .trim()
  .regex(/^(\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}$/, 'Numéro de téléphone invalide (ex. 06 12 34 56 78).');
const postalCode = z.string().trim().regex(/^\d{5}$/, 'Code postal à 5 chiffres.');
const name = (label: string) => z.string().trim().min(1, `${label} obligatoire.`).max(80);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.');

export const memberInputSchema = z.object({
  firstName: name('Prénom'),
  lastName: name('Nom'),
  birthDate: isoDate,
  gender: z.enum(['M', 'F', 'X']),
  categoryId: z.string().uuid('Choisissez une section.'),
  healthQuestionnairePassed: z.boolean(),
  passSportCode: z
    .string()
    .trim()
    .max(20)
    .regex(/^[A-Za-z0-9-]*$/, 'Code Pass\'Sport invalide.')
    .optional()
    .default(''),
  consentImageRights: z.boolean(),
  consentEmergencyMedical: z.boolean(),
  consentAutonomousExit: z.boolean(),
  signatureDataUrl: z
    .string()
    .startsWith('data:image/png;base64,', 'Signature manquante.')
    .max(300_000, 'Signature trop lourde.'),
  products: z
    .array(z.object({ productId: z.string().uuid(), size: z.string().trim().min(1).max(20) }))
    .max(10)
    .default([]),
});

export const registrationSchema = z.object({
  clubSlug: z.string().min(1),
  renewalToken: z.string().uuid().optional(),
  payer: z.object({
    firstName: name('Prénom'),
    lastName: name('Nom'),
    email: z.string().trim().toLowerCase().email('E-mail invalide.').max(120),
    phone,
    address: z.string().trim().min(3, 'Adresse obligatoire.').max(160),
    postalCode,
    city: z.string().trim().min(1, 'Ville obligatoire.').max(80),
  }),
  emergency: z.object({ name: name('Contact d\'urgence'), phone }),
  isAdultSelfRegistration: z.boolean(),
  members: z.array(memberInputSchema).min(1, 'Ajoutez au moins une personne.').max(8),
  paymentMethod: z.enum(['card', 'check', 'cash', 'transfer']),
  installmentsCount: z.number().int().min(1).max(3).default(1),
  acceptRules: z.literal(true, { errorMap: () => ({ message: 'Vous devez accepter le règlement intérieur.' }) }),
});
export type RegistrationInput = z.infer<typeof registrationSchema>;

export const trialSchema = z.object({
  clubSlug: z.string().min(1),
  scheduleId: z.string().uuid('Choisissez un créneau.'),
  firstName: name('Prénom'),
  lastName: name('Nom'),
  birthDate: isoDate,
  gender: z.enum(['M', 'F', 'X']),
  contactFirstName: name('Prénom du contact'),
  contactLastName: name('Nom du contact'),
  email: z.string().trim().toLowerCase().email('E-mail invalide.'),
  phone,
  address: z.string().trim().min(3, 'Adresse obligatoire.').max(160),
  postalCode,
  city: z.string().trim().min(1).max(80),
});

export const sponsorLeadSchema = z.object({
  clubSlug: z.string().min(1),
  companyName: name('Entreprise'),
  contactName: name('Nom du contact'),
  phone,
  email: z.string().trim().toLowerCase().email('E-mail invalide.'),
  estimatedBudget: z.string().trim().max(40).optional(),
  // Champ piège invisible : rempli uniquement par les robots.
  website: z.string().max(0).optional(),
});

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Formulaire invalide.';
}

/** URL http(s) uniquement : `z.string().url()` seul accepterait `javascript:` dans un href. */
export const httpUrl = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .url('Adresse web invalide.')
    .refine((u) => /^https?:\/\//i.test(u), 'L\'adresse doit commencer par http:// ou https://.');

export const hexColor =z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur au format #RRGGBB.');
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/, 'Identifiant : lettres minuscules, chiffres et tirets.');

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}
