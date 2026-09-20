"use client";

import { useCallback, useReducer, useRef } from "react";
import type { GenerateRequest } from "@/lib/contracts/generate";
import type { StepName } from "@/lib/contracts/stepName";
import { generationReducer, initialGenerationState, STEP_NAMES } from "./generationReducer";
import { readNdjsonEvents } from "./ndjsonReader";

// Wires the pure generationReducer to a real POST /api/generate call. Kept separate from the
// reducer so the state machine itself stays testable without fetch/AbortController/React.
export function useGeneration() {
  const [state, dispatch] = useReducer(generationReducer, initialGenerationState);
  const controllerRef = useRef<AbortController | null>(null);
  // Remembered so `resume()` can resubmit the same idea/category/option without the caller
  // having to hold onto it — only ever read back inside this hook.
  const lastRequestRef = useRef<GenerateRequest | null>(null);

  // Shared by every way of starting a stream (a fresh submit, a resume, or a replay) — they
  // all consume the same NDJSON event contract (lib/contracts/generate.ts), so only how the
  // fetch is made differs between them.
  const runStream = useCallback(async (submitExtra: { resumedSteps?: StepName[]; isReplay?: boolean }, doFetch: (signal: AbortSignal) => Promise<Response>) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "submit", ...submitExtra });

    try {
      const response = await doFetch(controller.signal);

      // A 400/404/429/500 admission failure (TRD.md §8) is a plain JSON body regardless of the
      // Accept header we sent — only an admitted run actually streams NDJSON.
      if (!(response.headers.get("content-type") ?? "").includes("application/x-ndjson")) {
        const body: { error: string; message: string; retry_after_s?: number } = await response.json();
        dispatch({ type: "admission_error", httpStatus: response.status, error: body.error, message: body.message, retryAfterS: body.retry_after_s });
        return;
      }

      await readNdjsonEvents(response, (event) => dispatch({ type: "stream_event", event }), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch({ type: "stream_failed", message: error instanceof Error ? error.message : "Network error" });
    }
  }, []);

  const submit = useCallback(
    (request: GenerateRequest, resumedSteps?: StepName[]) => {
      lastRequestRef.current = request;
      return runStream({ resumedSteps }, (signal) =>
        fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          body: JSON.stringify(request),
          signal,
        }),
      );
    },
    [runStream],
  );

  const generate = useCallback((request: GenerateRequest) => submit(request), [submit]);

  // Stage 5, item 1: streams a stored succeeded run back with its original per-step timing
  // instead of calling an LLM — the server picks which one (GET /api/generate/replay), so
  // there's no request body and nothing to remember in lastRequestRef.
  const watchReplay = useCallback(
    () => runStream({ isReplay: true }, (signal) => fetch("/api/generate/replay", { headers: { Accept: "application/x-ndjson" }, signal })),
    [runStream],
  );

  // Retries a run that ended `status: "error"` after at least one step already succeeded —
  // the server (lib/adapters/postgres/resume.ts) replays those steps instead of redoing them.
  // `failedStep` is the step the prior run actually failed at; every step before it in
  // pipeline order is what's being skipped, both on the wire and in the StepProgress UI. Only
  // meaningful when `failedStep` isn't "naming"; callers are expected to have already checked
  // that (the button that calls this only renders then).
  const resume = useCallback(
    (runId: string, failedStep: StepName) => {
      const lastRequest = lastRequestRef.current;
      if (!lastRequest) return;
      const resumedSteps = STEP_NAMES.slice(0, STEP_NAMES.indexOf(failedStep));
      return submit({ ...lastRequest, resume_from_run_id: runId }, resumedSteps);
    },
    [submit],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    dispatch({ type: "reset" });
  }, []);

  return { state, generate, resume, watchReplay, reset };
}
