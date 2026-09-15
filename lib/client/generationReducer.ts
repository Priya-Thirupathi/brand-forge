import type { StepName } from "@/lib/contracts/stepName";
import type { GenerateEvent, GenerateErrorCode, GenerateResult } from "@/lib/contracts/generate";

export type StepState = "pending" | "in_progress" | "passed" | "retrying" | "failed";

const STEP_NAMES: StepName[] = ["naming", "tagline_description", "packaging"];

function initialSteps(): Record<StepName, StepState> {
  return { naming: "pending", tagline_description: "pending", packaging: "pending" };
}

// Distinct from a mid-run `error` event (GenerationState "run_error", which has a run_id) —
// this is a 400/404/429/500 the route handler returns as a plain JSON body before a run is
// ever admitted (TRD.md §8's error-code table), so there's no run_id and no step progress.
export interface AdmissionError {
  httpStatus: number;
  error: string;
  message: string;
  retryAfterS?: number;
}

export type GenerationState =
  | { status: "idle" }
  | { status: "running"; runId?: string; steps: Record<StepName, StepState> }
  | { status: "succeeded"; result: GenerateResult }
  | { status: "rejected"; result: GenerateResult }
  | { status: "run_error"; runId: string; code: GenerateErrorCode; message: string }
  | ({ status: "admission_error" } & AdmissionError);

export const initialGenerationState: GenerationState = { status: "idle" };

export type GenerationAction =
  | { type: "submit" }
  | ({ type: "admission_error" } & AdmissionError)
  | { type: "stream_event"; event: GenerateEvent }
  // The stream ended (network drop, parse failure) without ever sending a `result`/`error`
  // event — TRD.md §11 says the server-side stream always terminates in one of those, but the
  // client still has to handle the connection itself failing before that happens.
  | { type: "stream_failed"; message: string }
  | { type: "reset" };

export function generationReducer(state: GenerationState, action: GenerationAction): GenerationState {
  switch (action.type) {
    case "submit":
      return { status: "running", steps: initialSteps() };
    case "admission_error":
      return { status: "admission_error", httpStatus: action.httpStatus, error: action.error, message: action.message, retryAfterS: action.retryAfterS };
    case "reset":
      return { status: "idle" };
    case "stream_failed":
      return state.status === "running"
        ? { status: "run_error", runId: state.runId ?? "", code: "internal", message: action.message }
        : state;
    case "stream_event":
      return applyStreamEvent(state, action.event);
    default:
      return state;
  }
}

function applyStreamEvent(state: GenerationState, event: GenerateEvent): GenerationState {
  // A stray event after the run already reached a terminal state shouldn't be able to revive
  // it — the server-side stream only ever sends one `result`/`error`, but the reducer doesn't
  // have to trust that to stay correct.
  if (state.status !== "running") return state;

  switch (event.type) {
    case "run_started":
      return { ...state, runId: event.run_id };
    case "step_started":
      return { ...state, steps: { ...state.steps, [event.step]: "in_progress" } };
    case "step_finished":
      return { ...state, steps: { ...state.steps, [event.step]: event.passed ? "passed" : event.attempt === 1 ? "retrying" : "failed" } };
    case "result":
      return { status: event.result.status, result: event.result };
    case "error":
      return { status: "run_error", runId: event.run_id, code: event.code, message: event.message };
  }
}

export { STEP_NAMES };
