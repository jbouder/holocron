import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

/**
 * The Web Worker that runs the analysis model, so the board stays
 * responsive while it downloads and generates. Loaded only when the owner
 * opens the Analysis panel; see `analysis-engine.ts`.
 */

// Hugging Face refuses requests that carry a Referer from a `*.workers.dev`
// page (the browser then reports a bare "Failed to fetch"). The weights are
// public and the board is never in the request, so send no referrer at all.
const originalFetch = self.fetch.bind(self);
self.fetch = (input, init) =>
  originalFetch(input, { referrerPolicy: 'no-referrer', ...init });

const handler = new WebWorkerMLCEngineHandler();
self.addEventListener('message', (event) => handler.onmessage(event));
