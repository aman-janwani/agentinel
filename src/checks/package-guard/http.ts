/**
 * The one place npm's APIs get called.
 *
 * The timeout used to be 3 seconds with no retry, which was too tight. The downloads endpoint
 * normally answers in well under a second, but the tail runs long, and we check up to five
 * packages at once. A well known package like `date-fns` would occasionally blow the budget, and
 * a timeout means the check is skipped. Silently not checking a package is the failure this whole
 * tool exists to prevent, so it is worth waiting longer and trying twice before giving up.
 */

const TIMEOUT_MS = 10_000;
const ATTEMPTS = 2;

export class RequestFailed extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean,
  ) {
    super(message);
  }
}

/** Fetches a URL, retrying once if the attempt times out or the connection fails. */
export async function get(url: string): Promise<Response> {
  let last: RequestFailed | null = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      last = new RequestFailed(describe(error), isTimeout(error));
    }
  }

  throw last ?? new RequestFailed('request failed', false);
}

/**
 * A timeout arrives as a TimeoutError when it fires during the request, but as an AbortError when
 * it fires while the body is still streaming, sometimes wrapped in another error.
 */
export function isTimeout(error: unknown): boolean {
  if (!(error instanceof RequestFailed)) {
    if (!(error instanceof Error)) {
      return false;
    }
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return true;
    }
    return isTimeout(error.cause);
  }
  return error.timedOut;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
