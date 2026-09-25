// Shared by the live AI, the provider and the HTTP layer. Kept free of any
// Node or SDK imports so the engine can also run in the browser.
export class AIUnavailableError extends Error {
  constructor(msg, cause) {
    super(msg);
    this.name = 'AIUnavailableError';
    this.cause = cause;
  }
}
