/**
 * One data row of the user's historical spreadsheet, exactly as read.
 *
 * Nothing is interpreted here: the mapping to applications lives in the
 * `importApplicationHistory` use case. Text cells are trimmed strings, empty
 * cells are empty strings, date cells are `Date` when the cell holds a date.
 */
export interface HistoryRow {
  /** 1-based spreadsheet row number, for reporting skipped rows. */
  readonly rowNumber: number;
  readonly company: string;
  readonly title: string;
  readonly publishedAt?: Date;
  readonly appliedAt?: Date;
  readonly companyInfo: string;
  readonly city: string;
  readonly address: string;
  readonly phone: string;
  readonly contact: string;
  /** Hyperlink target when the cell has one, else the cell text. */
  readonly url: string;
  readonly listNumber: string;
  /** "¿Han contestado?" as written (e.g. "Sí" / "No"). */
  readonly replied: string;
  /** "Estado" as written (e.g. "En proceso" / "Rechazado"). */
  readonly status: string;
  readonly respondedAt?: Date;
  readonly portal: string;
}

export interface HistoryReader {
  read(): Promise<readonly HistoryRow[]>;
}
