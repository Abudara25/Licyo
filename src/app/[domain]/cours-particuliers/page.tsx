import { notFound } from 'next/navigation';
import { loadClubOr404 } from '@/lib/tenant';
import { moduleEnabled } from '@/lib/platform';
import { LessonForm } from '@/components/platform/CommunityForms';
import { PageTitle } from '@/components/vitrine/PageTitle';
export default async function Lessons({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { club } = await loadClubOr404((await params).domain);
  if (!moduleEnabled(club.enabled_modules, 'private_lessons')) notFound();
  return (
    <>
      <PageTitle
        title="Un accompagnement personnel"
        intro="Un objectif, une envie de progresser ? Parlez-nous de votre projet et de vos disponibilités."
      />
      <div className="page-container py-10">
        <LessonForm slug={club.slug} />
      </div>
    </>
  );
}
