import {
  QaSummaryExecutionV2Schema,
  QaSummaryModelOutputV2Schema,
  type QaSummaryExecutionV2,
  type QaSummaryFallbackReason,
  type QaSummaryModelOutputV2,
} from '@arsnova/shared-types';
import {
  countIncludedQaQuestionSources,
  createQaSummaryFallback,
  type PreparedModerationSummaryContext,
} from './moderationSummaryContext';
import { runOpenWeightLlmSummaryV2 } from './openWeightLlmClient';
import { runQaSummaryLegacyRequest } from './qaSummaryAdapter';
import { createExtractiveQaSummaryOutput } from './qaSummaryExtractive';

export type QaSummaryPreparedRun = Readonly<{
  output: QaSummaryModelOutputV2;
  execution: QaSummaryExecutionV2;
}>;

function extractiveRun(
  prepared: PreparedModerationSummaryContext,
  input: {
    readonly attemptedMode: QaSummaryExecutionV2['attemptedMode'];
    readonly reason: QaSummaryFallbackReason;
    readonly retry?: 'manual' | 'not-applicable';
  },
): QaSummaryPreparedRun {
  return {
    output: createExtractiveQaSummaryOutput(prepared.request.promptContext),
    execution: QaSummaryExecutionV2Schema.parse({
      attemptedMode: input.attemptedMode,
      effectiveMode: 'extractive',
      fallback: createQaSummaryFallback('extractive', input.reason, input.retry ?? 'manual'),
    }),
  };
}

function legacyFailureReason(modelVersion: string | undefined): QaSummaryFallbackReason {
  if (modelVersion === 'stub:timeout') return 'timeout';
  if (modelVersion === 'stub:unconfigured' || modelVersion === 'stub:saas-blocked') {
    return 'misconfigured';
  }
  if (modelVersion === 'stub:invalid-output' || modelVersion === 'stub:invalid-input') {
    return 'invalid_response';
  }
  return 'unavailable';
}

function packedAnalyzedQuestionCount(prepared: PreparedModerationSummaryContext): number {
  const questions = prepared.request.promptContext.context.questions;
  return questions.state === 'available' ? questions.corpus.analyzed : 0;
}

export async function runPreparedQaSummary(
  prepared: PreparedModerationSummaryContext,
  options: { readonly signal?: AbortSignal } = {},
): Promise<QaSummaryPreparedRun> {
  if (prepared.plan.selectedMode === 'full-context') {
    // Belt-and-suspenders: never call the runtime when the pack has no Q&A evidence.
    if (
      packedAnalyzedQuestionCount(prepared) > 0 &&
      countIncludedQaQuestionSources(prepared.request.promptContext) === 0
    ) {
      return extractiveRun(prepared, {
        attemptedMode: 'full-context',
        reason: 'no_packed_sources',
      });
    }
    const result = await runOpenWeightLlmSummaryV2(prepared.request, options);
    if (result.status === 'completed' && result.output.output.status !== 'failed') {
      return {
        output: result.output.output,
        execution: QaSummaryExecutionV2Schema.parse({
          attemptedMode: 'full-context',
          effectiveMode: 'full-context',
          fallback: null,
        }),
      };
    }
    return extractiveRun(prepared, {
      attemptedMode: 'full-context',
      reason: result.status === 'completed' ? 'invalid_response' : result.status,
    });
  }

  if (prepared.plan.selectedMode === 'legacy-text') {
    const legacy = await runQaSummaryLegacyRequest(prepared.legacyRequest, options);
    if (legacy.status !== 'failed') {
      return {
        output: QaSummaryModelOutputV2Schema.parse(legacy),
        execution: QaSummaryExecutionV2Schema.parse({
          attemptedMode: 'legacy-text',
          effectiveMode: 'legacy-text',
          fallback:
            prepared.plan.fallback ??
            createQaSummaryFallback('legacy-text', 'adapter_incompatible'),
        }),
      };
    }
    return extractiveRun(prepared, {
      attemptedMode: 'legacy-text',
      reason: legacyFailureReason(legacy.modelVersion),
    });
  }

  return extractiveRun(prepared, {
    attemptedMode: null,
    reason: prepared.plan.fallback?.reason ?? 'disabled',
    retry: prepared.plan.fallback?.retry,
  });
}
