"use client";

import { useState } from "react";
import { GenerateTab } from "@/components/generate/GenerateTab";
import { GalleryTab } from "@/components/gallery/GalleryTab";
import { RunsTab } from "@/components/runs/RunsTab";
import { EvaluationTab } from "@/components/runs/EvaluationTab";

const TABS = [
  { id: "generate", label: "Generate" },
  { id: "gallery", label: "Gallery" },
  { id: "runs", label: "Runs" },
  { id: "evaluation", label: "Evaluation" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Tabs() {
  const [active, setActive] = useState<TabId>("generate");

  return (
    <div className="flex flex-col flex-1">
      <nav className="border-b border-line px-6 sm:px-10">
        <div className="mx-auto flex max-w-4xl gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                active === tab.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 sm:px-10">
        {active === "generate" && <GenerateTab />}
        {active === "gallery" && <GalleryTab />}
        {active === "runs" && <RunsTab />}
        {active === "evaluation" && <EvaluationTab />}
      </main>
    </div>
  );
}
