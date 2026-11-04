import { getAuthContext } from '@/lib/supabase/server';
import { LoginForm } from '@/app/(auth)/login/LoginForm';
import { OnboardingForm } from '@/components/platform/OnboardingForm';
import { resolveTemplate } from '@/lib/platform';
export const dynamic = 'force-dynamic';
export default async function Start({
  searchParams,
}: {
  searchParams: Promise<{ effectif?: string; modele?: string }>;
}) {
  const p = await searchParams;
  const count = Math.max(
    0,
    Math.min(1000000, Math.floor(Number(p.effectif) || 0)),
  );
  const template = resolveTemplate(p.modele ?? 'club');
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const auth = configured ? await getAuthContext() : null;
  return (
    <div className="page-container section-space">
      <div className="onboarding-steps">
        <span>01 · Votre club</span>
        <span>02 · Votre modèle</span>
        <span>03 · Vos modules</span>
      </div>
      <div className="page-heading">
        <span className="eyebrow">BIENVENUE CHEZ VOUS</span>
        <h1>
          Faisons place
          <br />à votre club.
        </h1>
        <p>
          Quelques informations et votre espace prend vie. Votre association
          garde la main.
        </p>
      </div>
      {auth ? (
        <OnboardingForm count={count} template={template} />
      ) : (
        <div className="form-panel max-w-md">
          <h2 className="text-xl font-semibold">
            Commençons par votre adresse e-mail
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            Un lien sécurisé vous permettra de créer votre association et de
            retrouver votre espace.
          </p>
          {configured ? (
            <LoginForm
              next={'/commencer?effectif=' + count + '&modele=' + template}
            />
          ) : (
            <p className="notice">
              La connexion sera disponible après configuration du service
              d’authentification. Vous pouvez déjà explorer les modèles et les
              espaces de démonstration.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
