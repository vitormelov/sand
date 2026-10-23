import type { SourceMeta } from '../normalization/normalize';
import type { RawItem } from '../types';

export interface ConnectorState {
  etag?: string;
  lastModified?: string;
}

export interface FetchContext {
  signal: AbortSignal;
  state: ConnectorState;
  now: number;
}

export interface FetchResult {
  items: RawItem[];
  /** True when the server answered 304 Not Modified. */
  notModified?: boolean;
  state?: ConnectorState;
}

export interface SourceConnector extends SourceMeta {
  /** Poll interval when healthy. */
  intervalMs: number;
  /** Minimum spacing between requests imposed by the provider. */
  minSpacingMs?: number;
  enabled: boolean;
  disabledReason?: string;
  fetch(ctx: FetchContext): Promise<FetchResult>;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}
