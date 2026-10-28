import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadClubOr404, sitePrefix } from '@/lib/tenant';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { articleJsonLd, serializeJsonLd } from '@/lib/seo-geo/json-ld';
import { PlainText } from '@/components/vitrine/PageTitle';

type Props = { params: Promise<{ domain: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { domain, slug } = await params;
  const { club, posts } = await loadClubOr404(domain);
  const post = posts.find((p) => p.slug === slug);
  if (!post) return {};
  return clubMetadata(club, { title: post.title, description: post.content.slice(0, 155), path: `/actualites/${post.slug}` });
}

export default async function PostPage({ params }: Props) {
  const { domain, slug } = await params;
  const data = await loadClubOr404(domain);
  const post = data.posts.find((p) => p.slug === slug);
  if (!post) notFound();
  const prefix = sitePrefix(domain);
  return (
    <article className="page-container mt-8 max-w-3xl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd(post, data)) }} />
      <Link href={prefix || '/'} className="inline-flex min-h-11 items-center text-sm font-semibold underline">← Retour à l'accueil</Link>
      <h1 className="mt-2 text-3xl font-extrabold">{post.title}</h1>
      <time className="text-sm text-muted-foreground" dateTime={post.published_at}>
        {new Date(post.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
      </time>
      {post.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.cover_image_url} alt="" className="mt-6 aspect-video w-full rounded-xl object-cover" />
      ) : null}
      <div className="mt-6 text-lg">
        <PlainText text={post.content} />
      </div>
    </article>
  );
}
