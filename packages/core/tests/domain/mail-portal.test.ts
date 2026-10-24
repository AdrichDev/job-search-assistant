import { describe, expect, it } from 'vitest';
import { portalFromSender } from '../../src/domain/mail-portal.js';

describe('portalFromSender', () => {
  it('maps the known alert domains to their stable label', () => {
    expect(portalFromSender('no-reply@infojobs.net')).toBe('infojobs');
    expect(portalFromSender('jobalerts-noreply@linkedin.com')).toBe('linkedin');
    expect(portalFromSender('alertas@indeed.com')).toBe('indeed');
    expect(portalFromSender('noreply@tecnoempleo.com')).toBe('tecnoempleo');
    expect(portalFromSender('myjob@getmanfred.com')).toBe('manfred');
  });

  it('recognises a known portal behind a mailing subdomain', () => {
    expect(portalFromSender('alerts@bounces.infojobs.net')).toBe('infojobs');
  });

  it('returns the registrable domain of any other non-generic sender, lowercased', () => {
    expect(portalFromSender('ofertas@NubeSol.Example')).toBe('nubesol.example');
    expect(portalFromSender('alerts@mail.tecnologia-jobs.com')).toBe('tecnologia-jobs.com');
    // A two-part public suffix is not mistaken for the registrable domain.
    expect(portalFromSender('ofertas@empleos.example.co.uk')).toBe('example.co.uk');
  });

  it('returns null for the generic mail providers: a personal address says nothing about a portal', () => {
    expect(portalFromSender('alguien@gmail.com')).toBeNull();
    expect(portalFromSender('alguien@googlemail.com')).toBeNull();
    expect(portalFromSender('alguien@outlook.com')).toBeNull();
    expect(portalFromSender('alguien@hotmail.es')).toBeNull();
    expect(portalFromSender('alguien@yahoo.com')).toBeNull();
    expect(portalFromSender('alguien@proton.me')).toBeNull();
    expect(portalFromSender('alguien@icloud.com')).toBeNull();
    // A subdomain of a generic provider is still a personal mailbox.
    expect(portalFromSender('news@mail.gmail.com')).toBeNull();
  });

  it('returns null for a malformed or empty address', () => {
    expect(portalFromSender('')).toBeNull();
    expect(portalFromSender('   ')).toBeNull();
    expect(portalFromSender('nubesol.example')).toBeNull();
    expect(portalFromSender('@example.com')).toBeNull();
    expect(portalFromSender('user@')).toBeNull();
    // No dot: not a registrable domain, so no portal can be named.
    expect(portalFromSender('user@localhost')).toBeNull();
    expect(portalFromSender('user@[192.168.1.1]')).toBeNull();
  });
});
