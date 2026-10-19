// 1. Garde-fou prévisualisation : voir functions/_shared/environment.js.
// 2. Protection CSRF de tout l'espace admin (origine + jeton) : voir functions/_shared/csrf.js.
// 3. Permissions par rôle, navigation adaptée et journal d'audit : voir functions/_shared/admin-access.js.
import { onRequest as previewGuard } from '../_shared/environment.js';
import { adminCsrfMiddleware } from '../_shared/csrf.js';
import { adminAccessMiddleware } from '../_shared/admin-access.js';

export const onRequest = [previewGuard, adminCsrfMiddleware, adminAccessMiddleware];
