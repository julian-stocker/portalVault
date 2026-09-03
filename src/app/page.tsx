import { de } from "@/lib/i18n/de";

/**
 * Provisional landing page.
 *
 * A placeholder until the public catalog exists (V1.4). It is here so the
 * foundation demonstrably builds and runs — not as a draft of the final design.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-muted uppercase">
        {de.home.status}
      </p>

      <h1 className="mt-3 text-4xl font-semibold tracking-tight">
        {de.app.name}
      </h1>

      <p className="mt-2 text-lg text-muted">{de.app.tagline}</p>

      <p className="mt-8 leading-relaxed">{de.home.intro}</p>

      <section className="mt-10 border-t border-border pt-6">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">
          {de.home.nextUp}
        </h2>
        <ol className="mt-4 space-y-2">
          {de.home.steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="text-muted tabular-nums">{index + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
