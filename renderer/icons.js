// Icônes des réseaux sociaux connus du moteur (SVG fixes, jamais fournis par la configuration).
export const SOCIAL_ICONS = {
  facebook: {
    label: 'Facebook',
    svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M13.5 21v-7.2h2.4l.4-2.8h-2.8v-1.6c0-.8.2-1.4 1.4-1.4h1.5V5.4c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.2v1.9H7.5v2.8h2.1V21h3.9z"/></svg>',
  },
  instagram: {
    label: 'Instagram',
    svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 8.2a3.8 3.8 0 100 7.6 3.8 3.8 0 000-7.6zm0 6.3a2.5 2.5 0 110-5 2.5 2.5 0 010 5zm5-6.6a1 1 0 11-2 0 1 1 0 012 0zM12 3c-2.5 0-2.8 0-3.7.1-1 .1-1.7.2-2.3.5-.6.2-1.1.6-1.6 1.1-.5.5-.8 1-1.1 1.6-.2.6-.4 1.3-.5 2.3C3 9.5 3 9.8 3 12.3s0 2.8.1 3.7c.1 1 .2 1.7.5 2.3.2.6.6 1.1 1.1 1.6.5.5 1 .8 1.6 1.1.6.2 1.3.4 2.3.5.9.1 1.2.1 3.7.1s2.8 0 3.7-.1c1-.1 1.7-.2 2.3-.5.6-.2 1.1-.6 1.6-1.1.5-.5.8-1 1.1-1.6.2-.6.4-1.3.5-2.3.1-.9.1-1.2.1-3.7s0-2.8-.1-3.7c-.1-1-.2-1.7-.5-2.3-.2-.6-.6-1.1-1.1-1.6-.5-.5-1-.8-1.6-1.1-.6-.2-1.3-.4-2.3-.5C14.8 3 14.5 3 12 3z"/></svg>',
  },
};

// Icônes d'illustration (cartes et pages d'actualités), référencées par nom dans la configuration.
export const ILLUSTRATION_ICONS = {
  'shield-check': '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M9 13l2 2 4-4"/>',
  heart: '<path d="M12 21s-7-5.2-9.5-9.4C.7 8 2.2 4 6 3.2c2.1-.4 4 .6 5 2.3 1-1.7 2.9-2.7 5-2.3C19.8 4 21.3 8 19.5 11.6 17 15.8 12 21 12 21z"/>',
  'calendar-star': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9.5h18"/><path d="M8 3v4M16 3v4"/><path d="M12 12.5l1.1 2.2 2.4.3-1.8 1.7.4 2.3-2.1-1.1-2.1 1.1.4-2.3-1.8-1.7 2.4-.3z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
};

// Icônes des listes d'informations (trait 1,8), référencées par nom dans la configuration. Le moteur écrit
// lui-même la balise <svg> ; la configuration ne fournit jamais de SVG.
export const INFO_ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  pin: '<path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  tag: '<path d="M12.5 3H5a2 2 0 0 0-2 2v7.5a2 2 0 0 0 .59 1.41l8.5 8.5a2 2 0 0 0 2.82 0l7.5-7.5a2 2 0 0 0 0-2.82l-8.5-8.5A2 2 0 0 0 12.5 3z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h2l10 5V4L6 9H4a1 1 0 0 0-1 1z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.3A5.5 5.5 0 0 1 21 20"/>',
  shirt: '<path d="M8 3 4 6l1.5 3L8 8v13h8V8l2.5 1L20 6l-4-3-2 2h-4z"/>',
  shoe: '<path d="M3 16c0-1.5 1-2.5 2-3l5-3 3 1 4-1 4 3c1 .7 1.5 1.5 1.5 3v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M8 10v3"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  'shield-check': '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
};

export const infoSvg = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${INFO_ICONS[name]}</svg>`;
