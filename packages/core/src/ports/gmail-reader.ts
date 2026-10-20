/**
 * Read-only view of the user's mailbox.
 *
 * Deliberately narrow: a message carries only what the mail check needs to
 * recognise a job-related mail. No body, no attachments, no header dump - the
 * less personal data crosses this port, the less can leak or be stored. The
 * port has no write operation because the OAuth scope is read-only.
 */
export interface MailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly receivedAt: Date;
  /** Sender address only, for example `jobs@example.com`. */
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
}

export interface GmailQuery {
  readonly since: Date;
  readonly maxResults: number;
}

export type MailUnavailableReason = 'network' | 'rate_limited' | 'server' | 'bad_response';

/**
 * Expected failures are values, never exceptions. `auth_expired` means Google
 * answered `invalid_grant` (the 7-day testing-mode refresh token ran out).
 */
export type GmailFetchResult =
  | { readonly status: 'ok'; readonly messages: readonly MailMessage[] }
  | { readonly status: 'auth_expired' }
  | { readonly status: 'unavailable'; readonly reason: MailUnavailableReason };

export interface GmailReader {
  fetchRecent(query: GmailQuery): Promise<GmailFetchResult>;
}
