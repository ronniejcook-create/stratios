// Email providers anyone can sign up with. An address at one of these says
// nothing about which company a person belongs to, so it is never used to
// match someone to an organization.
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com',
  'hotmail.co.uk', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'zoho.com', 'fastmail.com',
  'hey.com', 'comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net', 'cox.net', 'charter.net',
])

export function getEmailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at < 1) return null
  const domain = email.slice(at + 1).trim().toLowerCase()
  return domain.includes('.') ? domain : null
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain)
}
