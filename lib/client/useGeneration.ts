"use client";

import { useCallback, useReducer, useRef } from "react";
import type { GenerateRequest } from "@/lib/contracts/generate";
import { generationReducer, initialGenerationState } from "./generationReducer";
import { readNdjsonEvents } from "./ndjsonReader";

// Wires the pure generationReducer to a real POST /api/generate call. Kept separate from the
// reducer so the state machine itself stays testable without fetch/AbortController/React.
export function useGeneration() {
  const [state, dispatch] = useReducer(generationReducer, initialGenerationState);
  const controllerRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (request: GenerateRequest) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "submit" });

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

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

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    dispatch({ type: "reset" });
  }, []);

  return { state, generate, reset };
}
