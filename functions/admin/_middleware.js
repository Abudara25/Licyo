// 1. Garde-fou prévisualisation : voir functions/_shared/environment.js.
// 2. Protection CSRF de tout l'espace admin (origine + jeton) : voir functions/_shared/csrf.js.
// 3. Droits du rôle de la session (comptes nominatifs, lot 1) : voir functions/_shared/admin-permissions.js.
import { onRequest as previewGuard } from '../_shared/environment.js';
import { adminCsrfMiddleware } from '../_shared/csrf.js';
import { adminPermissionMiddleware } from '../_shared/admin-permissions.js';

export const onRequest = [previewGuard, adminCsrfMiddleware, adminPermissionMiddleware];
