import type { NextRequest } from "next/server";
import type { GenerateEvent } from "@/lib/contracts/generate";
import { findReplayableRun, type ReplayableRun } from "@/lib/adapters/postgres/replay";
import { pool } from "@/lib/adapters/postgres/pool";
import { errorResponse } from "../../_shared/response";

// Same 25s-of-real-latency budget a live run already respects (any recorded run this replays
// succeeded under that same deadline, TRD.md §5) plus headroom, same as POST /api/generate.
export const maxDuration = 30;

// Stage 5, item 1: no admission checks at all — rate limiting and the daily cap exist to
// protect the LLM provider's quota, and replay never calls an LLM (lib/adapters/postgres/
// replay.ts reads already-persisted rows). It has to work precisely when that quota is
// exhausted, which is the entire point of offering it.
export async function GET(request: NextRequest) {
  let replayable: ReplayableRun | null;
  try {
    replayable = await findReplayableRun(pool);
  } catch {
    return errorResponse("internal", "Something went wrong loading a recorded run.", 500);
  }
  if (!replayable) {
    return errorResponse("no_replayable_run", "No recorded run is available to replay yet.", 404);
  }
  return streamReplay(replayable, request.signal);
}

function streamReplay(replayable: ReplayableRun, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenerateEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        send({ type: "run_started", run_id: replayable.runId });

        for (const step of replayable.steps) {
          if (step.attempt === 1) {
            send({ type: "step_started", step: step.step });
          }
          // Waits out the step's real recorded latency before reporting it finished — "with
          // its original timings" (PRD.md Stage 5) is the whole point of a replay over just
          // showing the stored result instantly.
          const aborted = await sleep(step.latencyMs, signal);
          if (aborted) return;
          send({ type: "step_finished", step: step.step, attempt: step.attempt, passed: step.passed });
        }

        send({ type: "result", result: replayable.result });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// Resolves `true` if the signal aborted before (or during) the wait — same "a client
// disconnect stops in-flight work" contract POST /api/generate honors via LlmClient's
// AbortSignal, just with a timer instead of a network call to cancel.
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
