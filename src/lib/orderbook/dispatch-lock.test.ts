/**
 * Die Sperre gegen den Doppelklick — wirklich ausgeführt, nicht zugesichert.
 *
 * WARUM DIESE DATEI ANDERS IST ALS DIE ÜBRIGEN UI-TESTS.
 *
 * Dieses Projekt hat kein jsdom und keine Testing Library; die Tests zu den
 * Oberflächen lesen Quelltext und prüfen Zeichenketten. Das kann eine
 * Zeitfrage nicht beantworten: ob der ZWEITE Klick durchkommt, hängt an
 * Microtasks, nicht an Textstellen.
 *
 * Deshalb liegt die Sperre in einer reinen Funktion mit der Menge als
 * Parameter. Hier läuft sie dann tatsächlich — mit richtigen Promises,
 * richtiger Reihenfolge und beiden Ausgängen. `dispatching.current` im
 * Fenster ist genau diese Menge, nur aus einem `useRef`.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * Alle anhängigen Microtasks abarbeiten lassen.
 *
 * Erst wurde hier `await Promise.resolve()` gezählt — zwei, drei Mal, je
 * nachdem. Das war falsch und ist beim ersten Lauf aufgefallen: `.finally()`
 * schiebt einen eigenen Durchlauf ein, und die Zusicherung hängt an einem
 * weiteren. Ein `setTimeout(0)` wartet, bis die Microtask-Schlange leer ist,
 * ohne dass jemand sie nachrechnen muss.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

import { dispatchItemAction } from "./dispatch-lock";

/** Ein Eltern-Element wie `act` im Einkaufsbuch: eigenes Ref, ruft sofort. */
function parentWithLock<T>() {
  const inflight = new Set<number>();
  const calls: number[] = [];
  const act = (key: number, run: () => Promise<T>) => {
    if (inflight.has(key)) return;
    inflight.add(key);
    calls.push(key);
    /* Wie im Einkaufsbuch: der Rumpf läuft bis zum ersten `await`, und
       `run()` ist dessen Operand — also synchron. */
    void (async () => {
      try { await run(); } catch { /* das Eltern-Element zeigt die Ablehnung an */ }
      finally { inflight.delete(key); }
    })();
  };
  return { act, calls, inflight };
}

/** Ein Eltern-Element OHNE Sperre — der Fall, gegen den wir uns schützen. */
function parentWithoutLock<T>() {
  const calls: number[] = [];
  const act = (key: number, run: () => Promise<T>) => {
    calls.push(key);
    void (async () => { try { await run(); } catch { /* egal */ } })();
  };
  return { act, calls };
}

/** Ein steuerbarer Serveraufruf. */
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("der zweite Klick kommt nicht durch", () => {
  it("auch dann nicht, wenn das Eltern-Element selbst keine Sperre hat", async () => {
    /*
     * DER EIGENTLICHE BEFUND. Ohne diese Funktion hing der Schutz allein an
     * `inflight` im Einkaufsbuch — einem Ref, das der Prop-Typ nicht
     * verspricht. Hier ruft das Eltern-Element ungebremst durch, und es geht
     * trotzdem nur eine Anfrage hinaus.
     */
    const held = new Set<number>();
    const parent = parentWithoutLock<string>();
    const server = vi.fn(() => pending<string>().promise);

    expect(dispatchItemAction(held, 42, parent.act, server)).toBe(true);
    expect(dispatchItemAction(held, 42, parent.act, server)).toBe(false);
    expect(dispatchItemAction(held, 42, parent.act, server)).toBe(false);

    expect(parent.calls).toEqual([42]);
    expect(server).toHaveBeenCalledTimes(1);
  });

  it("die Sperre greift SYNCHRON, ohne einen Renderdurchlauf abzuwarten", () => {
    /*
     * Zwei Klicks in derselben Aufgabe — kein `await` dazwischen, so wie ein
     * echter Doppelklick vor dem nächsten Render. Genau hier versagt
     * `disabled={running}`, weil `busy` noch die alte Darstellung ist.
     */
    const held = new Set<number>();
    const parent = parentWithLock<string>();
    const server = vi.fn(() => pending<string>().promise);

    dispatchItemAction(held, 7, parent.act, server);
    dispatchItemAction(held, 7, parent.act, server);

    expect(server).toHaveBeenCalledTimes(1);
    expect(held.has(7)).toBe(true);
  });

  it("verschiedene Positionen sperren sich nicht gegenseitig", () => {
    const held = new Set<number>();
    const parent = parentWithLock<string>();
    const a = vi.fn(() => pending<string>().promise);
    const b = vi.fn(() => pending<string>().promise);

    expect(dispatchItemAction(held, 1, parent.act, a)).toBe(true);
    expect(dispatchItemAction(held, 2, parent.act, b)).toBe(true);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect([...held].sort()).toEqual([1, 2]);
  });
});

describe("die Freigabe — der schwierige Teil", () => {
  it("nach dem Erfolg ist die Position wieder bedienbar", async () => {
    const held = new Set<number>();
    const parent = parentWithLock<string>();
    const first = pending<string>();
    const second = pending<string>();

    dispatchItemAction(held, 5, parent.act, () => first.promise);
    expect(held.has(5)).toBe(true);

    first.resolve("ok");
    await settle();

    expect(held.has(5)).toBe(false);
    expect(dispatchItemAction(held, 5, parent.act, () => second.promise)).toBe(true);
  });

  it("nach einer ABLEHNUNG der Datenbank genauso — ein Wiederholen ist erlaubt", async () => {
    /*
     * Eine Ablehnung ist ein erfülltes Promise mit `ok: false`, kein Fehler.
     * Bliebe die Sperre dann liegen, wäre „verkauft, kein Bestand" ein
     * Einbahnweg: der Betreiber könnte nach dem Behandeln der Ursache nicht
     * mehr klicken.
     */
    const held = new Set<number>();
    const parent = parentWithLock<{ ok: boolean }>();
    const refused = pending<{ ok: boolean }>();

    dispatchItemAction(held, 9, parent.act, () => refused.promise);
    refused.resolve({ ok: false });
    await settle();

    expect(held.has(9)).toBe(false);
  });

  it("und nach einem geworfenen Fehler — sonst wäre die Zeile tot", async () => {
    const held = new Set<number>();
    const parent = parentWithLock<string>();
    const broken = pending<string>();

    dispatchItemAction(held, 11, parent.act, () => broken.promise);
    broken.reject(new Error("network"));
    await settle();

    expect(held.has(11)).toBe(false);
  });

  it("VERWEIGERT das Eltern-Element, bleibt nichts gesperrt", async () => {
    /*
     * Der Fall, der eine naive `held.add()`-Sperre dauerhaft verklemmt: die
     * grosse Tabelle hat dieselbe Position schon in Arbeit, `act` fällt an
     * seinem eigenen Ref aus, und `run` wird NIE gerufen. Ohne die
     * Freigabe-Zeile am Ende wäre der Knopf bis zum Schliessen des Fensters
     * tot — eine schlimmere Störung als der Doppelklick.
     */
    const held = new Set<number>();
    const parent = parentWithLock<string>();
    const elsewhere = pending<string>();
    const mine = vi.fn(() => pending<string>().promise);

    /* Die grosse Tabelle beginnt, am Fenster vorbei. */
    parent.act(3, () => elsewhere.promise);
    expect(parent.inflight.has(3)).toBe(true);

    /* Das Fenster versucht es und wird abgewiesen. */
    expect(dispatchItemAction(held, 3, parent.act, mine)).toBe(true);
    expect(mine).not.toHaveBeenCalled();
    expect(held.has(3)).toBe(false);

    /* Und ist danach sofort wieder bedienbar, nicht verklemmt. */
    elsewhere.resolve("ok");
    await settle();
    const retry = vi.fn(() => pending<string>().promise);
    expect(dispatchItemAction(held, 3, parent.act, retry)).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("ein Eltern-Element, das `run` SPÄTER ruft, verklemmt auch nicht", async () => {
    /*
     * `act` ruft heute synchron. Täte ein künftiges Eltern-Element das nicht,
     * sähe diese Funktion `started === false` und gäbe sofort frei — der
     * Schutz fiele auf das zurück, was das Eltern-Element selbst mitbringt.
     * Das ist die richtige Richtung: im schlechtesten Fall kein Zusatznutzen,
     * nie eine blockierte Zeile.
     */
    const held = new Set<number>();
    const late: Array<() => Promise<string>> = [];
    const act = (_key: number, run: () => Promise<string>) => { late.push(run); };
    const server = vi.fn(() => pending<string>().promise);

    dispatchItemAction(held, 13, act, server);
    expect(held.has(13)).toBe(false);
    expect(server).not.toHaveBeenCalled();

    late[0]();
    expect(server).toHaveBeenCalledTimes(1);
    expect(held.has(13)).toBe(false);
  });
});

describe("was die Funktion dem Eltern-Element NICHT antut", () => {
  it("sie reicht das Ergebnis unverändert weiter", async () => {
    const held = new Set<number>();
    const seen: unknown[] = [];
    const act = (_key: number, run: () => Promise<{ ok: true; items: number }>) => {
      void run().then((value) => { seen.push(value); });
    };
    dispatchItemAction(held, 1, act, async () => ({ ok: true as const, items: 4 }));
    await settle();
    expect(seen).toEqual([{ ok: true, items: 4 }]);
  });

  it("und den Fehler unverändert — `finally` schluckt nichts", async () => {
    const held = new Set<number>();
    let caught: unknown = null;
    const act = (_key: number, run: () => Promise<string>) => {
      void run().catch((error) => { caught = error; });
    };
    const boom = new Error("boom");
    dispatchItemAction(held, 1, act, () => Promise.reject(boom));
    await settle();
    expect(caught).toBe(boom);
    expect(held.has(1)).toBe(false);
  });

  it("sie ruft das Eltern-Element genau einmal je zugelassenem Klick", () => {
    const held = new Set<number>();
    /* Ohne benannte Parameter: `vi.fn()` genügt, und zwei ungenutzte Namen
       wären zwei Lint-Warnungen für nichts. */
    const act = vi.fn();
    dispatchItemAction<string>(held, 1, act, () => Promise.resolve("a"));
    expect(act).toHaveBeenCalledTimes(1);
  });
});
