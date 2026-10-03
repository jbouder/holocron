import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { SYSTEM_PROMPT } from '@/lib/analysis';

/**
 * The analysis model, behind a Web Worker. `@mlc-ai/web-llm` is imported
 * lazily here (and statically in the worker), so neither reaches the main
 * bundle: nothing loads until the owner opens the panel, and nothing
 * downloads until they agree.
 */

export interface LoadProgress {
  /** 0–1. */
  fraction: number;
  text: string;
}

export function webGpuSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** Whether a model's weights are already in this browser's cache. */
export async function isModelCached(modelId: string): Promise<boolean> {
  const { hasModelInCache } = await import('@mlc-ai/web-llm');
  try {
    return await hasModelInCache(modelId);
  } catch {
    return false;
  }
}

export class AnalysisEngine {
  private worker: Worker | null = null;
  private engine: WebWorkerMLCEngine | null = null;

  /** Download (first time) and load a model. Reports progress as it goes. */
  async load(
    modelId: string,
    onProgress: (progress: LoadProgress) => void,
  ): Promise<void> {
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
    const worker = new Worker(
      new URL('./analysis.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker = worker;
    try {
      this.engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (report) =>
          onProgress({ fraction: report.progress, text: report.text }),
        logLevel: 'WARN',
      });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** One request: the board context, then the instruction. Returns raw JSON text. */
  async complete(
    context: string,
    instruction: string,
    schema: Record<string, unknown>,
  ): Promise<string> {
    if (!this.engine) {
      throw new Error('The model is not loaded');
    }
    const result = await this.engine.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${context}\n\n${instruction}` },
      ],
      response_format: { type: 'json_object', schema: JSON.stringify(schema) },
      temperature: 0.3,
      max_tokens: 900,
      // Qwen3 would otherwise spend its budget on a <think> block first.
      extra_body: { enable_thinking: false },
    });
    return result.choices[0]?.message.content ?? '';
  }

  /** Stop the worker, which frees the GPU with it. The cached weights stay. */
  dispose() {
    this.engine = null;
    this.worker?.terminate();
    this.worker = null;
  }
}
