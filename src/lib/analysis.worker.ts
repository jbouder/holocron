import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

/**
 * The Web Worker that runs the analysis model, so the board stays
 * responsive while it downloads and generates. Loaded only when the owner
 * opens the Analysis panel; see `analysis-engine.ts`.
 */
const handler = new WebWorkerMLCEngineHandler();
self.addEventListener('message', (event) => handler.onmessage(event));
