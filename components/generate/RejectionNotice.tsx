import type { GenerateResult } from "@/lib/contracts/generate";

// Two rejections, told apart by whether `guardrails.failure` is present at all (the route only
// sends it for `step: "input"` — app/api/generate/route.ts's buildGenerateResult):
//
//   - the visitor's idea broke a rule → say which, because only they can fix it;
//   - our model output broke a rule → say so plainly and own it, without a rule list they
//     can't act on. The step name, the rules and the messages are all still recorded server
//     side; they just aren't this screen's job.
export function RejectionNotice({ result }: { result: GenerateResult }) {
  const failure = result.guardrails.failure;

  return (
    <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning-soft-ink">
      {failure ? (
        <>
          <p className="font-medium">Rejected at {failure.step === "input" ? "input" : failure.step.replace("_", " ")}</p>
          <ul className="mt-2 list-inside list-disc space-y-0.5">
            {failure.violations.map((v, i) => (
              <li key={i}>{v.message}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="font-medium">This one didn&apos;t pass our own quality checks</p>
          <p className="mt-1">
            The copy we generated broke one of our brand-safety rules, so we didn&apos;t show it. That&apos;s on us, not
            your idea — generating again will usually produce something that passes.
          </p>
        </>
      )}
    </div>
  );
}
