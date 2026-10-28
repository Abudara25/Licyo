import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { readableTextColor, safeHex } from '@/lib/utils/color-contrast';

type ClubBrand = { name: string; primary_color: string; contact_email: string };

function Layout({ club, preview, children }: { club: ClubBrand; preview: string; children: ReactNode }) {
  const primary = safeHex(club.primary_color);
  return (
    <Html lang="fr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: '#F4F4F5', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#FFFFFF', borderRadius: 8, maxWidth: 560, overflow: 'hidden' }}>
          <Section style={{ backgroundColor: primary, padding: '20px 24px' }}>
            <Text style={{ color: readableTextColor(primary), fontSize: 20, fontWeight: 700, margin: 0 }}>{club.name}</Text>
          </Section>
          <Section style={{ padding: '24px' }}>{children}</Section>
          <Hr style={{ borderColor: '#E4E4E7', margin: 0 }} />
          <Section style={{ padding: '16px 24px' }}>
            <Text style={{ color: '#71717A', fontSize: 12, margin: 0 }}>
              Une question ? Répondez simplement à cet e-mail ou écrivez à {club.contact_email}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function CallToAction({ club, href, label }: { club: ClubBrand; href: string; label: string }) {
  const primary = safeHex(club.primary_color);
  return (
    <Button
      href={href}
      style={{ backgroundColor: primary, borderRadius: 6, color: readableTextColor(primary), display: 'inline-block', fontWeight: 700, padding: '12px 20px', textDecoration: 'none' }}
    >
      {label}
    </Button>
  );
}

const p = { color: '#27272A', fontSize: 15, lineHeight: '24px' } as const;

export function RegistrationReceivedEmail({ club, payerFirstName, memberNames, total, paymentLabel }: { club: ClubBrand; payerFirstName: string; memberNames: string[]; total: string; paymentLabel: string }) {
  return (
    <Layout club={club} preview={`Dossier d'inscription reçu - ${club.name}`}>
      <Heading as="h1" style={{ fontSize: 22 }}>Dossier bien reçu</Heading>
      <Text style={p}>Bonjour {payerFirstName},</Text>
      <Text style={p}>Nous avons bien reçu l'inscription de : <strong>{memberNames.join(', ')}</strong>.</Text>
      <Text style={p}>Montant total : <strong>{total}</strong> ({paymentLabel}).</Text>
      <Text style={p}>Le bureau vérifie les pièces dans les prochains jours. Si un document doit être remplacé, vous recevrez un lien pour le faire en ligne.</Text>
    </Layout>
  );
}

export function CorrectionRequestEmail({ club, memberName, reason, link }: { club: ClubBrand; memberName: string; reason: string; link: string }) {
  return (
    <Layout club={club} preview={`Une pièce est à remplacer pour ${memberName}`}>
      <Heading as="h1" style={{ fontSize: 22 }}>Une pièce est à remplacer</Heading>
      <Text style={p}>Le dossier de <strong>{memberName}</strong> est presque complet. Le bureau a besoin d'une correction :</Text>
      <Text style={{ ...p, backgroundColor: '#FEF3C7', borderRadius: 6, padding: '12px 16px' }}>{reason}</Text>
      <CallToAction club={club} href={link} label="Corriger le dossier" />
      <Text style={{ ...p, color: '#71717A', fontSize: 13 }}>Ce lien est personnel : ne le transférez pas.</Text>
    </Layout>
  );
}

export function DossierValidatedEmail({ club, memberName, categoryName }: { club: ClubBrand; memberName: string; categoryName: string }) {
  return (
    <Layout club={club} preview={`Inscription validée pour ${memberName}`}>
      <Heading as="h1" style={{ fontSize: 22 }}>Inscription validée</Heading>
      <Text style={p}>Le dossier de <strong>{memberName}</strong> est complet et validé ({categoryName}). Bienvenue au club !</Text>
    </Layout>
  );
}

export function TrialConfirmationEmail({ club, memberName, slotLabel, venue }: { club: ClubBrand; memberName: string; slotLabel: string; venue: string }) {
  return (
    <Layout club={club} preview={`Séance d'essai pour ${memberName}`}>
      <Heading as="h1" style={{ fontSize: 22 }}>Séance d'essai enregistrée</Heading>
      <Text style={p}><strong>{memberName}</strong> est attendu(e) au créneau suivant : <strong>{slotLabel}</strong>.</Text>
      <Text style={p}>Lieu : {venue}. Prévoyez une tenue de sport et une bouteille d'eau.</Text>
    </Layout>
  );
}

export function ConvocationEmail({ club, memberName, eventTitle, dateLabel, location, link }: { club: ClubBrand; memberName: string; eventTitle: string; dateLabel: string; location: string; link: string }) {
  return (
    <Layout club={club} preview={`Convocation : ${eventTitle}`}>
      <Heading as="h1" style={{ fontSize: 22 }}>Convocation</Heading>
      <Text style={p}><strong>{memberName}</strong> est convoqué(e) : <strong>{eventTitle}</strong>.</Text>
      <Text style={p}>{dateLabel} - {location}</Text>
      <CallToAction club={club} href={link} label="Répondre présent ou absent" />
    </Layout>
  );
}

export function PaymentReceivedEmail({ club, payerFirstName, amount, invoiceNumber }: { club: ClubBrand; payerFirstName: string; amount: string; invoiceNumber: string }) {
  return (
    <Layout club={club} preview={`Paiement reçu - ${amount}`}>
      <Heading as="h1" style={{ fontSize: 22 }}>Paiement reçu</Heading>
      <Text style={p}>Bonjour {payerFirstName}, nous avons bien reçu votre paiement de <strong>{amount}</strong>.</Text>
      <Text style={p}>Référence : {invoiceNumber}. Votre attestation de paiement (CE, mutuelle) est disponible sur demande auprès du club.</Text>
    </Layout>
  );
}

export function RenewalInvitationEmail({ club, memberName, season, link }: { club: ClubBrand; memberName: string; season: string; link: string }) {
  return (
    <Layout club={club} preview={`Réinscription ${season}`}>
      <Heading as="h1" style={{ fontSize: 22 }}>Réinscription {season}</Heading>
      <Text style={p}>La nouvelle saison approche ! Réinscrivez <strong>{memberName}</strong> en deux minutes : vos informations sont déjà remplies.</Text>
      <CallToAction club={club} href={link} label="Réinscrire" />
    </Layout>
  );
}

export function TestEmail({ club, provider }: { club: ClubBrand; provider: string }) {
  return (
    <Layout club={club} preview="E-mail de test">
      <Heading as="h1" style={{ fontSize: 22 }}>Tout fonctionne</Heading>
      <Text style={p}>Cet e-mail de test a été envoyé via : {provider}.</Text>
    </Layout>
  );
}
