// 1. Garde-fou prévisualisation : voir functions/_shared/environment.js.
// 2. Protection CSRF de tout l'espace admin (origine + jeton) : voir functions/_shared/csrf.js.
import { onRequest as previewGuard } from '../_shared/environment.js';
import { adminCsrfMiddleware } from '../_shared/csrf.js';

export const onRequest = [previewGuard, adminCsrfMiddleware];
