// Section « registration » : formulaire d'inscription du module Inscriptions de la plateforme (phase 4D.2A).
// Le balisage, les noms de champs, les identifiants lus par assets/js/inscription.js, les valeurs des modes de
// paiement (contrat de functions/api/inscriptions.js) et les points d'accroche des scripts sont FIXÉS ICI. La
// configuration du site ne fournit que des textes (chaînes ou segments), des choix de repli et leurs liaisons de
// données : jamais d'action de formulaire, de nom de champ, de script ni de HTML.
import { escapeAttr, safeHref } from './html.js';
import { bindMarkers, renderInline } from './inline.js';
import { allowKeys } from './blocks.js';

// Valeurs acceptées par l'API (PAYMENT_METHODS de functions/api/inscriptions.js), dans l'ordre d'affichage.
export const PAYMENT_VALUES = ['HelloAsso', 'Carte bancaire', 'Espèces', 'Chèque'];

// Forme attendue de section.texts : "s" = chaîne, "g" = segments, objets = sous-formes.
const FIELD = { label: 's', placeholder: 's' };
const SHAPE = {
  eyebrow: 's',
  title: 's',
  intro: 'g',
  steps: ['s', 3],
  childStep: 's',
  parentStep: 's',
  finalStep: 's',
  next: 's',
  back: 's',
  childFirstName: FIELD,
  childLastName: FIELD,
  birthDate: { label: 's' },
  birthCountry: FIELD,
  birthPostalCode: { label: 's', placeholder: 's' },
  birthCity: { label: 's', placeholder: 's', suggestions: 's' },
  group: { label: 's' },
  ageWarning: 'g',
  size: { label: 's', placeholder: 's', hint: 'g' },
  parentFirstName: FIELD,
  parentLastName: FIELD,
  email: FIELD,
  phone: FIELD,
  duplicateWarning: 'g',
  secondParent: { summary: 's', optional: 's', firstName: FIELD, lastName: FIELD, email: FIELD, phone: FIELD, hint: 's' },
  address: { label: 's', placeholder: 's', suggestions: 's' },
  postalCode: FIELD,
  city: FIELD,
  payment: { label: 's', placeholder: 's' },
  passSport: { label: 's', optional: 's', placeholder: 's', hint: 'g' },
  passSportNote: 'g',
  consentParticipation: 'g',
  consentImage: 'g',
  consentPrivacy: 'g',
  notes: ['g', 2],
  submit: 's',
  duplicate: { title: 's', text: 'g' },
  nextSteps: {
    title: 's',
    steps: ['g', 3],
    button: 's',
    emailHint: 'g',
    fallbackBefore: 's',
    fallbackLink: 's',
    fallbackAfter: 's',
    onSiteBefore: 's',
    onSiteAfter: 's',
    onSitePassSport: 'g',
    passSportBefore: 's',
    passSportAfter: 's',
    widgetHintBefore: 's',
    widgetHintLink: 's',
    widgetHintAfter: 's',
  },
  closed: { title: 's', text: 'g', button: 's' },
  priority: { title: 's', before: 's', after: 's', button: 's' },
  aside: { label: 's', kicker: 'g', price: 'g', priceSub: 'g', afterTitle: 's', afterSteps: ['g', 3], help: 'g', noteStrong: 's', note: 's' },
};

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isSegments = (v) => Array.isArray(v) && v.length > 0;

function checkShape(value, shape, where) {
  if (shape === 's') {
    if (!isText(value)) throw new Error(`${where} : texte requis`);
  } else if (shape === 'g') {
    if (!isSegments(value)) throw new Error(`${where} : segments requis`);
  } else if (Array.isArray(shape)) {
    const [inner, count] = shape;
    if (!Array.isArray(value) || value.length !== count) throw new Error(`${where} : ${count} éléments attendus`);
    value.forEach((v, i) => checkShape(v, inner, `${where}[${i}]`));
  } else {
    allowKeys(value, where, Object.keys(shape));
    for (const [key, inner] of Object.entries(shape)) checkShape(value[key], inner, `${where}.${key}`);
  }
}

const OPTION_VALUE = /^[\p{L}\p{N} .,'()-]{1,60}$/u;

export function checkRegistration(section) {
  allowKeys(section, 'registration', ['type', 'id', 'texts', 'groupOptions', 'sizes', 'paymentLabels', 'asideItems', 'contactHref'], ['comment']);
  checkShape(section.texts, SHAPE, 'registration.texts');
  for (const list of ['groupOptions', 'asideItems']) {
    if (!Array.isArray(section[list]) || !section[list].length || section[list].length > 20) throw new Error(`registration.${list} : 1 à 20 éléments`);
  }
  // Tailles d'équipement : liste vide = sport sans tenue fournie, le champ n'est pas affiché.
  if (!Array.isArray(section.sizes) || section.sizes.length > 20) throw new Error('registration.sizes : 0 à 20 éléments');
  for (const o of section.groupOptions) {
    allowKeys(o, 'registration.groupOption', ['value', 'label'], ['bind']);
    if (!OPTION_VALUE.test(o.value) || !isText(o.label)) throw new Error('registration.groupOption : valeur et libellé');
  }
  for (const size of section.sizes) if (!OPTION_VALUE.test(size)) throw new Error(`registration.sizes : valeur invalide ${size}`);
  allowKeys(section.paymentLabels, 'registration.paymentLabels', PAYMENT_VALUES);
  for (const value of PAYMENT_VALUES) if (!isText(section.paymentLabels[value])) throw new Error(`registration.paymentLabels : libellé de ${value}`);
  for (const item of section.asideItems) {
    allowKeys(item, 'registration.asideItem', ['content'], ['bind']);
    if (!isSegments(item.content)) throw new Error('registration.asideItem : segments');
  }
  safeHref(section.contactHref);
}

export function renderRegistration(section, ctx) {
  const x = section.texts;
  const s = (v) => ctx.text(v);
  const g = (v) => renderInline(v, ctx);
  const a = (v) => escapeAttr(v);
  const m = (attrs) => bindMarkers(ctx, attrs);
  const field = (id, name, type, f, extra) =>
    `                  <div class="form-field">
                    <label for="${id}">${s(f.label)}</label>
                    <input type="${type}" id="${id}" name="${name}" placeholder="${a(f.placeholder)}"${extra}>
                  </div>`;
  const p2 = x.secondParent;
  const n = x.nextSteps;
  const contact = escapeAttr(safeHref(section.contactHref));
  return `  <section class="bg-surface" id="adhesion">
    <div class="container insc-layout">

      <div class="insc-main" id="formulaire" data-reveal>
        <span class="eyebrow">${s(x.eyebrow)}</span>
        <h2 class="section-title">${s(x.title)}</h2>

        <div class="inscription-status" data-status="open" id="inscription-status">

          <div class="inscription-open">
            <p class="section-sub">${g(x.intro)}</p>

            <ol class="form-steps" id="form-steps" hidden>
              <li class="is-current" aria-current="step"><span>1</span>${s(x.steps[0])}</li>
              <li><span>2</span>${s(x.steps[1])}</li>
              <li><span>3</span>${s(x.steps[2])}</li>
            </ol>

            <form id="inscription-form" novalidate>
              <fieldset class="form-step">
                <legend class="form-step-title">${s(x.childStep)}</legend>
                <div class="form-row">
${field('enfant-prenom', 'enfantPrenom', 'text', x.childFirstName, ' autocomplete="off" maxlength="200" required')}
${field('enfant-nom', 'enfantNom', 'text', x.childLastName, ' autocomplete="off" maxlength="200" required')}
                </div>
                <div class="form-row">
                  <div class="form-field">
                    <label for="naissance">${s(x.birthDate.label)}</label>
                    <input type="date" id="naissance" name="naissance" required>
                  </div>
                  <div class="form-field">
                    <label for="categorie">${s(x.group.label)}</label>
                    <select id="categorie" name="categorie" required>
${section.groupOptions.map((o) => `                      <option value="${a(o.value)}"${m(o.bind)}>${s(o.label)}</option>`).join('\n')}
                    </select>
                  </div>
                </div>

                <p id="inscription-age-warning" class="form-alert" role="alert" hidden>
                  ${g(x.ageWarning)}
                </p>

                <div class="form-row">
${field('pays-naissance', 'paysNaissance', 'text', x.birthCountry, ' autocomplete="off" maxlength="200" value="France" required')}
                  <div class="form-field">
                    <label for="cp-naissance">${s(x.birthPostalCode.label)}</label>
                    <input type="text" id="cp-naissance" name="cpNaissance" placeholder="${a(x.birthPostalCode.placeholder)}" autocomplete="off" inputmode="numeric" maxlength="5" pattern="[0-9]{5}">
                  </div>
                </div>
                <div class="form-field address-field">
                  <label for="ville-naissance">${s(x.birthCity.label)}</label>
                  <input type="text" id="ville-naissance" name="villeNaissance" placeholder="${a(x.birthCity.placeholder)}" autocomplete="off" maxlength="200" required>
                  <ul id="ville-naissance-suggestions" class="address-suggestions" role="listbox" aria-label="${a(x.birthCity.suggestions)}" hidden></ul>
                </div>

${section.sizes.length ? `                <div class="form-row">
                  <div class="form-field">
                    <label for="taille-maillot">${s(x.size.label)}</label>
                    <select id="taille-maillot" name="tailleMaillot" required>
                      <option value="" disabled selected>${s(x.size.placeholder)}</option>
${section.sizes.map((v) => `                      <option value="${a(v)}">${s(v)}</option>`).join('\n')}
                    </select>
                    <small class="form-hint">${g(x.size.hint)}</small>
                  </div>
                </div>

` : ''}                <div class="form-step-nav">
                  <button type="button" class="btn btn-primary" data-step-next>${s(x.next)}</button>
                </div>
              </fieldset>

              <fieldset class="form-step">
                <legend class="form-step-title">${s(x.parentStep)}</legend>
                <div class="form-row">
${field('parent-prenom', 'parentPrenom', 'text', x.parentFirstName, ' autocomplete="given-name" maxlength="200" required')}
${field('parent-nom', 'parentNom', 'text', x.parentLastName, ' autocomplete="family-name" maxlength="200" required')}
                </div>
                <div class="form-row">
${field('email', 'email', 'email', x.email, ' autocomplete="email" maxlength="200" required')}
${field('telephone', 'telephone', 'tel', x.phone, ' autocomplete="tel" maxlength="200" required')}
                </div>

                <p id="inscription-duplicate-warning" class="form-alert" hidden>
                  ${g(x.duplicateWarning)}
                </p>

                <details class="form-parent2">
                  <summary>${s(p2.summary)} <span>${s(p2.optional)}</span></summary>
                  <div class="form-row">
${indentField(field('parent2-prenom', 'parent2Prenom', 'text', p2.firstName, ' maxlength="200"'))}
${indentField(field('parent2-nom', 'parent2Nom', 'text', p2.lastName, ' maxlength="200"'))}
                  </div>
                  <div class="form-row">
${indentField(field('parent2-email', 'parent2Email', 'email', p2.email, ' maxlength="200"'))}
${indentField(field('parent2-telephone', 'parent2Telephone', 'tel', p2.phone, ' maxlength="200"'))}
                  </div>
                  <p class="form-parent2-hint">${s(p2.hint)}</p>
                </details>

                <div class="form-field address-field">
                  <label for="adresse">${s(x.address.label)}</label>
                  <input type="text" id="adresse" name="adresse" placeholder="${a(x.address.placeholder)}" autocomplete="street-address" maxlength="200">
                  <ul id="adresse-suggestions" class="address-suggestions" role="listbox" aria-label="${a(x.address.suggestions)}" hidden></ul>
                </div>
                <div class="form-row">
${field('code-postal', 'codePostal', 'text', x.postalCode, ' autocomplete="postal-code" inputmode="numeric" maxlength="200"')}
                  <div class="form-field address-field">
                    <label for="ville">${s(x.city.label)}</label>
                    <input type="text" id="ville" name="ville" placeholder="${a(x.city.placeholder)}" autocomplete="address-level2" maxlength="200">
                    <ul id="ville-suggestions" class="address-suggestions" role="listbox" aria-label="${a(x.city.label)}" hidden></ul>
                  </div>
                </div>

                <div class="form-step-nav">
                  <button type="button" class="btn btn-ghost" data-step-prev>${s(x.back)}</button>
                  <button type="button" class="btn btn-primary" data-step-next>${s(x.next)}</button>
                </div>
              </fieldset>

              <fieldset class="form-step">
                <legend class="form-step-title">${s(x.finalStep)}</legend>
                <div class="form-field">
                  <label for="mode-paiement">${s(x.payment.label)}</label>
                  <select id="mode-paiement" name="modePaiement" required>
                    <option value="" disabled selected>${s(x.payment.placeholder)}</option>
${PAYMENT_VALUES.map((v) => `                    <option value="${a(v)}">${s(section.paymentLabels[v])}</option>`).join('\n')}
                  </select>
                </div>

                <div class="form-field">
                  <label for="pass-sport-code">${s(x.passSport.label)} <span class="form-optional">${s(x.passSport.optional)}</span></label>
                  <input type="text" id="pass-sport-code" name="passSportCode" placeholder="${a(x.passSport.placeholder)}" autocomplete="off" maxlength="40">
                  <small class="form-hint">${g(x.passSport.hint)}</small>
                </div>
                <p id="pass-sport-note" class="form-note form-note-strong" hidden>
                  ${g(x.passSportNote)}
                </p>

                <div class="form-checks">
                  <label class="form-check">
                    <input type="checkbox" id="autorisation" name="autorisation" required>
                    <span>${g(x.consentParticipation)}</span>
                  </label>
                  <label class="form-check">
                    <input type="checkbox" id="droit-image" name="droitImage">
                    <span>${g(x.consentImage)}</span>
                  </label>
                  <label class="form-check">
                    <input type="checkbox" id="rgpd" name="rgpd" required>
                    <span>${g(x.consentPrivacy)}</span>
                  </label>
                </div>

${x.notes.map((note) => `                <p class="form-note">${g(note)}</p>`).join('\n')}

                <div class="form-step-nav">
                  <button type="button" class="btn btn-ghost" data-step-prev>${s(x.back)}</button>
                  <button type="submit" class="btn btn-primary">${s(x.submit)}</button>
                </div>
              </fieldset>
            </form>

            <div id="inscription-duplicate" class="form-result" role="status" hidden>
              <h3>${s(x.duplicate.title)}</h3>
              <p>${g(x.duplicate.text)}</p>
            </div>

            <div id="inscription-next-steps" class="form-result" hidden>
              <h3>${s(n.title)}</h3>
              <ol class="form-result-steps">
${n.steps.map((step) => `                <li>${g(step)}</li>`).join('\n')}
              </ol>
              <a id="depot-btn" target="_blank" rel="noopener" class="btn btn-dark">${s(n.button)}</a>
              <p id="depot-email-hint" class="form-hint">${g(n.emailHint)}</p>
              <p id="depot-fallback" class="form-hint" hidden>${s(n.fallbackBefore)}<a id="mailto-btn">${s(n.fallbackLink)}</a>${s(n.fallbackAfter)}</p>
              <div id="paiement-especes-cheque" class="form-result-box" hidden>
                ${s(n.onSiteBefore)}<strong id="paiement-especes-cheque-mode"></strong>${s(n.onSiteAfter)}<span id="paiement-especes-cheque-passsport"${m([['data-org-if', 'price.seasonAmount']])} hidden>${g(n.onSitePassSport)}</span>.
              </div>
              <div id="paiement-helloasso" hidden>
                <p id="paiement-passsport" class="form-note form-note-strong" hidden>
                  ${s(n.passSportBefore)}<strong id="paiement-passsport-code"></strong>${s(n.passSportAfter)}
                </p>
                <div id="helloasso-widget-container"></div>
                <p class="form-hint">${s(n.widgetHintBefore)}<a id="helloasso-fallback-link" target="_blank" rel="noopener">${s(n.widgetHintLink)}</a>${s(n.widgetHintAfter)}</p>
              </div>
            </div>
          </div>

          <div class="inscription-closed form-result">
            <h3>${s(x.closed.title)}</h3>
            <p>${g(x.closed.text)}</p>
            <a href="${contact}" class="btn btn-primary">${s(x.closed.button)}</a>
          </div>

          <div class="inscription-priority form-result">
            <h3>${s(x.priority.title)}</h3>
            <p>${s(x.priority.before)}<strong id="inscription-priority-date">—</strong>${s(x.priority.after)}</p>
            <a href="${contact}" class="btn btn-primary">${s(x.priority.button)}</a>
          </div>

        </div>
      </div>

      <aside class="insc-aside" data-reveal aria-label="${a(x.aside.label)}">
        <div class="insc-recap">
          <p class="insc-recap-kicker">${g(x.aside.kicker)}</p>
          <p class="insc-recap-price"${m([['data-org-if', 'price.seasonAmount']])}>${g(x.aside.price)}</p>
          <p class="insc-recap-sub"${m([['data-org-if', 'price.seasonAmount']])}>${g(x.aside.priceSub)}</p>
          <ul class="insc-recap-list">
${section.asideItems.map((item) => `            <li${m(item.bind)}>${g(item.content)}</li>`).join('\n')}
          </ul>
          <div class="insc-recap-after">
            <h3 class="insc-recap-title">${s(x.aside.afterTitle)}</h3>
            <ol class="insc-recap-steps">
${x.aside.afterSteps.map((step) => `              <li>${g(step)}</li>`).join('\n')}
            </ol>
          </div>
          <p class="insc-recap-help">${g(x.aside.help)}</p>
        </div>
        <p class="insc-aside-note"><strong>${s(x.aside.noteStrong)}</strong>${s(x.aside.note)}</p>
      </aside>

    </div>
  </section>
`;
}

// Champs du second responsable : deux espaces de plus (dans <details>).
const indentField = (text) =>
  text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
