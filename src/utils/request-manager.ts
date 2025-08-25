export class RequestManager {
  private controller: AbortController | null = null;

  abort(): void {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }

  getSignal(): AbortSignal {
    this.abort();
    this.controller = new AbortController();
    return this.controller.signal;
  }

  isAborted(): boolean {
    return this.controller?.signal.aborted ?? false;
  }

  reset(): void {
    this.abort();
    this.controller = null;
  }

  getCurrentSignal(): AbortSignal | null {
    return this.controller?.signal ?? null;
  }

  hasActiveRequest(): boolean {
    return this.controller !== null && !this.isAborted();
  }
}

export function createRequestManager(): RequestManager {
  return new RequestManager();
}


export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
