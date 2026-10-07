import type { z } from 'zod';
import {
  LlmError, type AnalyzeDocumentInput, type ClassifyClaimInput, type LlmCallMeta, type LlmProvider, type LlmResult,
} from './llm-provider.js';
import { ClaimClassificationSchema, DocumentAnalysisSchema, type ClaimClassification, type DocumentAnalysis } from './classification.schemas.js';
import { parseModelOutput } from './parse-model-output.js';
import { PROMPT_VERSION, buildAnalyzeDocumentMessages, buildClassifyClaimMessages, type ChatMessage } from './prompts.js';

export interface NvidiaLlmConfig {
  apiKey: string;
  model: string;
  textModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class NvidiaLlmProvider implements LlmProvider {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  readonly providerName = 'nvidia';
  get modelName(): string { return this.config.model; }

  constructor(private readonly config: NvidiaLlmConfig) {
    const base = (config.baseUrl ?? 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
    this.url = `${base}/chat/completions`;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.maxTokens = config.maxTokens ?? 3000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  analyzeDocument(
    input: AnalyzeDocumentInput,
    signal?: AbortSignal,
  ): Promise<LlmResult<DocumentAnalysis>> {
    return this.run(
      buildAnalyzeDocumentMessages(input),
      DocumentAnalysisSchema,
      this.config.model,
      signal,
    );
  }

  classifyClaim(
    input: ClassifyClaimInput,
    signal?: AbortSignal,
  ): Promise<LlmResult<ClaimClassification>> {
    return this.run(
      buildClassifyClaimMessages(input),
      ClaimClassificationSchema,
      this.config.textModel ?? this.config.model,
      signal,
    );
  }

  private async run<S extends z.ZodType>(
  messages: ChatMessage[],
  schema: S,
  model: string,
  callerSignal?: AbortSignal,
): Promise<LlmResult<z.infer<S>>> {
    const started = Date.now();
    const partial = (extra: Partial<LlmCallMeta> = {}): Partial<LlmCallMeta> => ({
      model,
      promptVersion: PROMPT_VERSION,
      latencyMs: Date.now() - started,
      ...extra,
    });

    let status: number;
    let text: string;
    try {
      const signals = [AbortSignal.timeout(this.timeoutMs), ...(callerSignal ? [callerSignal] : [])];
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: this.maxTokens,
          stream: false,
        }),
        signal: AbortSignal.any(signals),
      });
      status = res.status;
      text = await res.text();
    } catch (e) {
      throw this.transportError(e, callerSignal, partial());
    }

    if (status < 200 || status >= 300) throw this.httpError(status, partial({ rawOutput: text.slice(0, 500) }));

    let data: ChatCompletionResponse;
    try {
      data = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      throw new LlmError('unavailable', 'El proveedor devolvió algo que no es JSON', partial({ rawOutput: text.slice(0, 500) }));
    }

    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? null;
    // El razonamiento (reasoning_content) no se lee ni se guarda: puede repetir datos del documento.
    const meta: LlmCallMeta = {
      model,
      promptVersion: PROMPT_VERSION,
      latencyMs: Date.now() - started,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      rawOutput: content,
    };

    if (choice?.message?.refusal) throw new LlmError('refused', 'El modelo se negó a responder', meta);
    if (choice?.finish_reason === 'length') {
      throw new LlmError('invalid_output', 'La respuesta del modelo se cortó por el límite de tokens', meta);
    }

    try {
      return { data: parseModelOutput(content, schema), meta };
    } catch (e) {
      if (e instanceof LlmError) {
        const detail =
          `finish_reason=${choice?.finish_reason ?? 'n/d'}, ` +
          `tokens_salida=${data.usage?.completion_tokens ?? 'n/d'}, latencia_ms=${meta.latencyMs}`;

        throw new LlmError(
          e.kind,
          `${e.message} (${detail})`,
          meta,
        );
      }

      throw e;
    }
  }

  private transportError(e: unknown, callerSignal: AbortSignal | undefined, meta: Partial<LlmCallMeta>): LlmError {
    if ((e as { name?: string } | null)?.name === 'TimeoutError') {
      return new LlmError('timeout', `El modelo no respondió en ${this.timeoutMs} ms`, meta);
    }
    if (callerSignal?.aborted) return new LlmError('unavailable', 'La llamada fue cancelada', meta);
    return new LlmError('unavailable', 'No se pudo contactar al proveedor del modelo', meta);
  }

  private httpError(status: number, meta: Partial<LlmCallMeta>): LlmError {
    const message = `El proveedor respondió con estado ${status}`;
    if (status === 429) return new LlmError('rate_limited', message, meta);
    if (status === 408 || status === 504) return new LlmError('timeout', message, meta);
    if (status >= 500) return new LlmError('unavailable', message, meta);
    return new LlmError('bad_request', message, meta); // 400, 401, 403, 404...: reintentar no ayuda
  }
}