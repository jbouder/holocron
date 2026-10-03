import type { ExportFormat } from '#shared/export';
import type { BoardMeta, CreateBoardResponse } from '#shared/protocol';

/** The three HTTP calls. Everything else happens over the WebSocket. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error ?? `Request failed (${response.status})`,
    );
  }
  return body;
}

export function createBoard(input: {
  title: string;
  templateId: string;
  participantId: string;
  name: string;
  /** Only sent when the deployment requires a Turnstile check. */
  turnstileToken?: string;
}): Promise<CreateBoardResponse> {
  return request('/api/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getBoardMeta(code: string): Promise<BoardMeta> {
  return request(`/api/boards/${encodeURIComponent(code)}`);
}

export function deleteBoard(code: string, ownerToken: string): Promise<void> {
  return request(`/api/boards/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${ownerToken}` },
  });
}

export function exportUrl(code: string, format: ExportFormat = 'md'): string {
  return `/api/boards/${encodeURIComponent(code)}/export.${format}`;
}

export function socketUrl(
  code: string,
  identity: { id: string; secret: string; name: string },
  token: string | null,
): string {
  const url = new URL(`/ws/${encodeURIComponent(code)}`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('pid', identity.id);
  url.searchParams.set('secret', identity.secret);
  url.searchParams.set('name', identity.name);
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}
