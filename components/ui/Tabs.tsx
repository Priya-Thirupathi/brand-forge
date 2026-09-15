"use client";

import { useState } from "react";
import { GenerateTab } from "@/components/generate/GenerateTab";
import { GalleryTab } from "@/components/gallery/GalleryTab";
import { UnderTheHoodTab } from "@/components/runs/UnderTheHoodTab";

const TABS = [
  { id: "generate", label: "Generate" },
  { id: "gallery", label: "Gallery" },
  { id: "runs", label: "Under the hood" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Tabs() {
  const [active, setActive] = useState<TabId>("generate");

  return (
    <div className="flex flex-col flex-1">
      <nav className="flex gap-1 border-b border-zinc-200 px-6 dark:border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active === tab.id
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="flex-1 px-6 py-8">
        {active === "generate" && <GenerateTab />}
        {active === "gallery" && <GalleryTab />}
        {active === "runs" && <UnderTheHoodTab />}
      </main>
    </div>
  );
}
