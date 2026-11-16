// 1. Garde-fou prévisualisation : voir functions/_shared/environment.js.
// 2. Envois de l'éducateur (fiche, photo, nouveau lien) acceptés seulement depuis le site : voir functions/_shared/csrf.js.
import { onRequest as previewGuard } from '../_shared/environment.js';
import { sameOriginMiddleware } from '../_shared/csrf.js';

export const onRequest = [previewGuard, sameOriginMiddleware];
