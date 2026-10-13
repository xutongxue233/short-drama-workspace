export class ProviderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}
