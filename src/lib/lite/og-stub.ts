// Mode gratuit (LICYO_LITE=1) : remplace `next/og` dans le Worker pour rester sous 3 Mo (moteur de dessin de
// 1,4 Mo). Rien n'est supprimé : le build complet (offre Workers Paid) embarque le vrai module.
export class ImageResponse extends Response {
  constructor(..._args: unknown[]) {
    super('Image de partage disponible avec l’offre complète de Licyo.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
