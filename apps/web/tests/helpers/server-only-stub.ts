/**
 * No-op stand-in for the `server-only` package under Vitest.
 *
 * In a Next build, importing `server-only` from a client bundle is a hard
 * error - which is exactly the protection we want in production code. Vitest
 * has no client/server split, so the real package would throw on every import.
 */
export {};
