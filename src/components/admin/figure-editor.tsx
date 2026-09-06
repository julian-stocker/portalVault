/**
 * The editor for one figure.
 *
 * Three fields, each saved on its own: an editor who fixes a name should not
 * have to resubmit a note they never touched. Every save goes to a server
 * action, which goes to a database function, which asks `is_shop_admin()` —
 * the form is the last of three layers and the least important one.
 *
 * The imported name is shown and not editable. It is the import's column
 * (ADR-0039); an override sits beside it and can be cleared again, which is
 * why the field explains that an empty value restores the derived name.
 */
"use client";

import { useState, useTransition } from "react";

import { setAdminNote, setDisplayNameOverride } from "@/lib/admin/actions";
import { de } from "@/lib/i18n/de";

type State = "idle" | "saved" | "failed";

function Status({ state, message }: { state: State; message: string }) {
  if (state === "idle") return null;
  return (
    <p
      role="status"
      className={`text-xs ${state === "saved" ? "text-accent" : "text-danger"}`}
    >
      {state === "saved" ? de.admin.saved : message}
    </p>
  );
}

export function FigureEditor({
  skyId,
  canonicalName,
  derivedName,
  override,
  note,
}: {
  skyId: string;
  canonicalName: string;
  /** What the public would see without an override — the ADR-0030 derivation. */
  derivedName: string;
  override: string | null;
  note: string | null;
}) {
  const [nameValue, setNameValue] = useState(override ?? "");
  const [noteValue, setNoteValue] = useState(note ?? "");
  const [nameState, setNameState] = useState<State>("idle");
  const [noteState, setNoteState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function save(kind: "name" | "note") {
    setNameState("idle");
    setNoteState("idle");
    startTransition(async () => {
      const result =
        kind === "name"
          ? await setDisplayNameOverride(skyId, nameValue)
          : await setAdminNote(skyId, noteValue);
      const next: State = result.ok ? "saved" : "failed";
      if (!result.ok) setMessage(result.message);
      if (kind === "name") setNameState(next);
      else setNoteState(next);
    });
  }

  // What a visitor would read after saving: the override if there is one,
  // otherwise the derivation. Shown live so the effect is visible before the
  // page reloads.
  const preview = nameValue.trim() === "" ? derivedName : nameValue.trim();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{de.admin.canonicalName}</h2>
        {/* Read-only, and visibly so: this is the import's column. */}
        <p className="rounded-sky-md bg-surface/60 px-3 py-2 text-sm text-muted ring-1 ring-border/50">
          {canonicalName}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <label htmlFor="override" className="text-sm font-medium">
          {de.admin.overrideLabel}
        </label>
        <input
          id="override"
          value={nameValue}
          onChange={(event) => setNameValue(event.target.value)}
          placeholder={derivedName}
          className="min-h-11 rounded-sky-md bg-surface/80 px-3 text-base ring-1 ring-border/70 focus:ring-border-strong"
        />
        <p className="text-xs text-muted">{de.admin.overrideHint}</p>
        <p className="text-sm">
          <span className="text-muted">{de.admin.publicName}: </span>
          <span className="font-medium">{preview}</span>
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => save("name")}
            disabled={pending}
            className="min-h-10 rounded-sky-md bg-surface px-4 text-sm ring-1 ring-border-strong disabled:opacity-60"
          >
            {de.admin.save}
          </button>
          <Status state={nameState} message={message} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <label htmlFor="note" className="text-sm font-medium">
          {de.admin.note}
        </label>
        <textarea
          id="note"
          rows={3}
          value={noteValue}
          onChange={(event) => setNoteValue(event.target.value)}
          className="rounded-sky-md bg-surface/80 px-3 py-2 text-base ring-1 ring-border/70 focus:ring-border-strong"
        />
        <p className="text-xs text-muted">{de.admin.noteHint}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => save("note")}
            disabled={pending}
            className="min-h-10 rounded-sky-md bg-surface px-4 text-sm ring-1 ring-border-strong disabled:opacity-60"
          >
            {de.admin.save}
          </button>
          <Status state={noteState} message={message} />
        </div>
      </section>
    </div>
  );
}
