/** Driven port: keeps `console` out of the domain and the app layer. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
