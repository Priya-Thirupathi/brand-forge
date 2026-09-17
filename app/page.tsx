import { Tabs } from "@/components/ui/Tabs";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line px-6 py-5 sm:px-10">
        <div className="mx-auto flex max-w-4xl items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">
            Brand<span className="text-accent">Forge</span>
          </h1>
          <p className="text-sm text-muted">Turn a product idea into a feasible brand.</p>
        </div>
      </header>
      <Tabs />
    </div>
  );
}
