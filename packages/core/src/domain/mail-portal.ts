/**
 * The portal an alert email reveals, derived from its sender address only.
 *
 * This is metadata the user's own mailbox carries, not scraping: the port's
 * `MailMessage.from` is the only input. A known alert domain maps to a stable
 * label; any other non-generic domain names itself (its registrable domain,
 * lowercased); a GENERIC mail provider answers null because a personal address
 * says nothing about where the offer lives - a guess there would be a lie in
 * the user's own table. Malformed input answers null too.
 */

/** Alert-sender domains this project's mail realistically carries, mapped to the stable label the UI shows. */
const KNOWN_PORTAL_DOMAINS: readonly { readonly domain: string; readonly label: string }[] = [
  { domain: 'infojobs.net', label: 'infojobs' },
  { domain: 'linkedin.com', label: 'linkedin' },
  { domain: 'indeed.com', label: 'indeed' },
  { domain: 'tecnoempleo.com', label: 'tecnoempleo' },
  // Manfred alerts come from its getmanfred.com domain; keep both spellings.
  { domain: 'getmanfred.com', label: 'manfred' },
  { domain: 'manfred.com', label: 'manfred' },
];

/**
 * Generic mailbox providers. A sender on one of these is a person, not an
 * alert pipeline: the address carries no portal information, so the answer
 * must be null rather than an invented name.
 */
const GENERIC_MAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.es',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.es',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'icloud.com',
  'me.com',
  'aol.com',
  'gmx.com',
  'gmx.es',
  'zoho.com',
  'fastmail.com',
  'tutanota.com',
  'tuta.io',
  'mail.com',
];

/**
 * Two-part public suffixes worth handling here: without them the registrable
 * domain of `empleos.example.co.uk` would be `co.uk`, which names nothing.
 * Deliberately a short list of the common ones, not a public-suffix database.
 */
const TWO_PART_SUFFIXES: readonly string[] = [
  'co.uk',
  'org.uk',
  'gov.uk',
  'com.es',
  'org.es',
  'com.mx',
  'com.ar',
  'com.br',
  'com.co',
  'com.pe',
  'com.uy',
  'com.au',
  'co.nz',
  'co.za',
  'co.jp',
  'co.in',
  'co.il',
  'com.sg',
  'com.hk',
  'com.tr',
  'com.cn',
];

function isSubdomainOf(domain: string, base: string): boolean {
  return domain === base || domain.endsWith(`.${base}`);
}

/** Keeps the public suffix plus one label, so `mail.tecnologia-jobs.com` names `tecnologia-jobs.com`. */
function registrableDomain(domain: string): string {
  const labels = domain.split('.');
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_PART_SUFFIXES.includes(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * The portal an alert sender reveals, or null when the address carries none.
 * Pure, total: any input answers something, never throws.
 */
export function portalFromSender(from: string): string | null {
  const address = from.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) {
    return null;
  }
  const domain = address.slice(at + 1);
  // A dot-less domain (or an IP literal in brackets) is not a registrable domain.
  if (!/^[a-z0-9.-]+\.[a-z0-9.-]+$/.test(domain)) {
    return null;
  }

  for (const portal of KNOWN_PORTAL_DOMAINS) {
    if (isSubdomainOf(domain, portal.domain)) {
      return portal.label;
    }
  }
  for (const generic of GENERIC_MAIL_DOMAINS) {
    if (isSubdomainOf(domain, generic)) {
      return null;
    }
  }
  return registrableDomain(domain);
}
