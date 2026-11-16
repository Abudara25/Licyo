// Garde-fou prévisualisation : voir functions/_shared/environment.js. Pas de contrôle d'origine global ici : la
// désinscription en un clic (RFC 8058) arrive des serveurs des messageries (voir desinscription/[token].js).
import { onRequest as previewGuard } from '../_shared/environment.js';

export const onRequest = [previewGuard];
