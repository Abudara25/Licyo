// Section « preregistration » : formulaire de pré-inscription (liste d'intérêt d'un groupe pas encore ouvert, voir
// functions/_shared/preinscriptions.js). Comme « registration » : balisage, noms de champs et identifiants lus par
// assets/js/preinscription.js FIXÉS ICI ; la configuration ne fournit que des textes (chaînes ou segments) et la
// valeur de secours du nombre de places, mise à jour par le script depuis /api/preinscriptions.
import { escapeAttr, escapeText, safeHref } from './html.js';
import { renderInline } from './inline.js';
import { allowKeys } from './blocks.js';

const FIELD = { label: 's', placeholder: 's' };
const SHAPE = {
  eyebrow: 's',
  title: 's',
  intro: 'g',
  childFirstName: FIELD,
  childLastName: FIELD,
  birthDate: { label: 's', hint: 'g' },
  // Message immédiat quand l'année ne correspond pas au groupe ({annee}, {groupe}, {categorie} remplacés par le script).
  age: { young: 's', old: 's', category: 's', none: 's', inscription: 's', contact: 's' },
  birthCountry: FIELD,
  birthCity: FIELD,
  size: { label: 's', placeholder: 's', hint: 'g' },
  parentFirstName: FIELD,
  parentLastName: FIELD,
  email: FIELD,
  phone: FIELD,
  secondParent: { summary: 's', optional: 's', firstName: FIELD, lastName: FIELD, email: FIELD, phone: FIELD, hint: 's' },
  comment: { label: 's', optional: 's', placeholder: 's' },
  consentPrivacy: 'g',
  note: 'g',
  submit: 's',
  success: { title: 's', text: 'g' },
  full: { title: 's', text: 'g', button: 's' },
  closed: { title: 's', text: 'g', button: 's' },
  // Groupe ouvert (places toutes prises, catégorie créée) : renvoi vers le formulaire d'inscription.
  opened: { title: 's', text: 'g', button: 's' },
  aside: { label: 's', kicker: 's', remainingOne: 's', remainingMany: 's', of: 's', help: 'g' },
};

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isSegments = (v) => Array.isArray(v) && v.length > 0;

function checkShape(value, shape, where) {
  if (shape === 's') {
    if (!isText(value)) throw new Error(`${where} : texte requis`);
  } else if (shape === 'g') {
    if (!isSegments(value)) throw new Error(`${where} : segments requis`);
  } else {
    allowKeys(value, where, Object.keys(shape));
    for (const [key, inner] of Object.entries(shape)) checkShape(value[key], inner, `${where}.${key}`);
  }
}

export function checkPreregistration(section) {
  allowKeys(section, 'preregistration', ['type', 'id', 'texts', 'capacity', 'sizes', 'asideItems', 'contactHref', 'registrationHref'], ['comment']);
  if (!Array.isArray(section.sizes) || !section.sizes.length || section.sizes.length > 20 || section.sizes.some((v) => !/^[\p{L}\p{N} .,'()-]{1,60}$/u.test(v))) {
    throw new Error('preregistration.sizes : 1 à 20 tailles');
  }
  checkShape(section.texts, SHAPE, 'preregistration.texts');
  if (!Number.isInteger(section.capacity) || section.capacity < 1 || section.capacity > 60) throw new Error('preregistration.capacity : entier de 1 à 60');
  if (!Array.isArray(section.asideItems) || !section.asideItems.length || section.asideItems.length > 20) throw new Error('preregistration.asideItems : 1 à 20 éléments');
  for (const item of section.asideItems) if (!isSegments(item)) throw new Error('preregistration.asideItem : segments');
  safeHref(section.contactHref);
  safeHref(section.registrationHref);
}

export function renderPreregistration(section, ctx) {
  const x = section.texts;
  const s = (v) => ctx.text(v);
  const g = (v) => renderInline(v, ctx);
  const a = (v) => escapeAttr(v);
  const field = (id, name, type, f, extra) =>
    `              <div class="form-field">
                <label for="${id}">${s(f.label)}</label>
                <input type="${type}" id="${id}" name="${name}" placeholder="${a(f.placeholder)}"${extra}>
              </div>`;
  const contact = escapeAttr(safeHref(section.contactHref));
  const capacity = escapeText(String(section.capacity));
  return `  <section class="bg-surface" id="pre-inscription">
    <div class="container insc-layout">

      <div class="insc-main" data-reveal>
        <span class="eyebrow">${s(x.eyebrow)}</span>
        <h2 class="section-title">${s(x.title)}</h2>

        <div class="prein-status" id="preinscription-status" data-state="open">
          <div class="prein-open">
            <p class="section-sub">${g(x.intro)}</p>

            <form id="preinscription-form" novalidate>
              <div class="form-row">
${field('prein-enfant-prenom', 'enfantPrenom', 'text', x.childFirstName, ' autocomplete="off" maxlength="200" required')}
${field('prein-enfant-nom', 'enfantNom', 'text', x.childLastName, ' autocomplete="off" maxlength="200" required')}
              </div>
              <div class="form-field">
                <label for="prein-naissance">${s(x.birthDate.label)}</label>
                <input type="date" id="prein-naissance" name="naissance" required>
                <small class="form-hint">${g(x.birthDate.hint)}</small>
              </div>
              <div id="preinscription-age" class="form-alert prein-age" role="alert" hidden
                data-young="${a(x.age.young)}" data-old="${a(x.age.old)}" data-category="${a(x.age.category)}" data-none="${a(x.age.none)}"
                data-inscription="${a(x.age.inscription)}" data-inscription-href="${escapeAttr(safeHref(section.registrationHref))}"
                data-contact="${a(x.age.contact)}" data-contact-href="${contact}"></div>
              <div class="form-row">
${field('prein-pays-naissance', 'paysNaissance', 'text', x.birthCountry, ' autocomplete="off" maxlength="100" value="France" required')}
              <div class="form-field address-field">
                <label for="prein-ville-naissance">${s(x.birthCity.label)}</label>
                <input type="text" id="prein-ville-naissance" name="villeNaissance" placeholder="${a(x.birthCity.placeholder)}" autocomplete="off" maxlength="100" required>
                <ul id="prein-ville-naissance-suggestions" class="address-suggestions" role="listbox" aria-label="${a(x.birthCity.label)}" hidden></ul>
              </div>
              </div>
              <div class="form-field">
                <label for="prein-taille-maillot">${s(x.size.label)}</label>
                <select id="prein-taille-maillot" name="tailleMaillot" required>
                  <option value="" disabled selected>${s(x.size.placeholder)}</option>
${section.sizes.map((v) => `                  <option value="${a(v)}">${s(v)}</option>`).join('\n')}
                </select>
                <small class="form-hint">${g(x.size.hint)}</small>
              </div>
              <div class="form-row">
${field('prein-parent-prenom', 'parentPrenom', 'text', x.parentFirstName, ' autocomplete="given-name" maxlength="200" required')}
${field('prein-parent-nom', 'parentNom', 'text', x.parentLastName, ' autocomplete="family-name" maxlength="200" required')}
              </div>
              <div class="form-row">
${field('prein-email', 'email', 'email', x.email, ' autocomplete="email" maxlength="200" required')}
${field('prein-telephone', 'telephone', 'tel', x.phone, ' autocomplete="tel" maxlength="200" required')}
              </div>
              <details class="form-parent2">
                <summary>${s(x.secondParent.summary)} <span>${s(x.secondParent.optional)}</span></summary>
                <div class="form-row">
${field('prein-parent2-prenom', 'parent2Prenom', 'text', x.secondParent.firstName, ' autocomplete="off" maxlength="200"')}
${field('prein-parent2-nom', 'parent2Nom', 'text', x.secondParent.lastName, ' autocomplete="off" maxlength="200"')}
                </div>
                <div class="form-row">
${field('prein-parent2-email', 'parent2Email', 'email', x.secondParent.email, ' autocomplete="off" maxlength="200"')}
${field('prein-parent2-telephone', 'parent2Telephone', 'tel', x.secondParent.phone, ' autocomplete="off" maxlength="200"')}
                </div>
                <p class="form-parent2-hint">${s(x.secondParent.hint)}</p>
              </details>
              <div class="form-field">
                <label for="prein-commentaire">${s(x.comment.label)} <span class="form-optional">${s(x.comment.optional)}</span></label>
                <textarea id="prein-commentaire" name="commentaire" rows="3" maxlength="500" placeholder="${a(x.comment.placeholder)}"></textarea>
              </div>
              <div class="form-checks">
                <label class="form-check">
                  <input type="checkbox" id="prein-rgpd" name="rgpd" required>
                  <span>${g(x.consentPrivacy)}</span>
                </label>
              </div>
              <p class="form-note">${g(x.note)}</p>
              <div id="preinscription-turnstile"></div>
              <p id="preinscription-error" class="form-alert" role="alert" hidden></p>
              <button type="submit" class="btn btn-primary">${s(x.submit)}</button>
            </form>
          </div>

          <div id="preinscription-success" class="form-result" role="status" hidden>
            <h3>${s(x.success.title)}</h3>
            <p>${g(x.success.text)}</p>
          </div>

          <div class="prein-full form-result">
            <h3>${s(x.full.title)}</h3>
            <p>${g(x.full.text)}</p>
            <a href="${contact}" class="btn btn-primary">${s(x.full.button)}</a>
          </div>

          <div class="prein-closed form-result">
            <h3>${s(x.closed.title)}</h3>
            <p>${g(x.closed.text)}</p>
            <a href="${contact}" class="btn btn-primary">${s(x.closed.button)}</a>
          </div>

          <div class="prein-opened form-result">
            <h3>${s(x.opened.title)}</h3>
            <p>${g(x.opened.text)}</p>
            <a href="${escapeAttr(safeHref(section.registrationHref))}" class="btn btn-primary">${s(x.opened.button)}</a>
          </div>
        </div>
      </div>

      <aside class="insc-aside" data-reveal aria-label="${a(x.aside.label)}">
        <div class="insc-recap">
          <p class="insc-recap-kicker">${s(x.aside.kicker)}</p>
          <p class="insc-recap-price"><span id="preinscription-remaining">${capacity}</span></p>
          <p class="insc-recap-sub"><span id="preinscription-remaining-label" data-one="${a(x.aside.remainingOne)}" data-many="${a(x.aside.remainingMany)}">${s(x.aside.remainingMany)}</span> ${s(x.aside.of)} <span id="preinscription-capacity">${capacity}</span></p>
          <div class="prein-progress" aria-hidden="true"><span id="preinscription-progress" style="width:0%"></span></div>
          <ul class="insc-recap-list">
${section.asideItems.map((item) => `            <li>${g(item)}</li>`).join('\n')}
          </ul>
          <p class="insc-recap-help">${g(x.aside.help)}</p>
        </div>
      </aside>

    </div>
  </section>
`;
}
