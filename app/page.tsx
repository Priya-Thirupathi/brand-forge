import { Tabs } from "@/components/ui/Tabs";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold">BrandForge</h1>
        <p className="text-sm text-zinc-500">Generate a feasible product brand from an idea.</p>
      </header>
      <Tabs />
    </div>
  );
}
