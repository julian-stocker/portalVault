# Eingefrorene Baselines

Je Migration eine Datei: die Vertragszeilen, die ihr Preflight **vor** der
Migration ausgegeben hat. Die Nachkontrolle vergleicht gegen sie.

**Sie werden nach der Migration nie neu erhoben.** Das wäre der eine Fehler,
der jede Abweichung verschwinden lässt und nichts beweist: die Daten
verglichen sich dann mit sich selbst.

`tools/lib/baseline.mts` rechnet bei **jedem** Lesen Marke, Feldzahl und
Schutzsumme nach — eine Datei auf der Platte ist kein Beweis, dass ihr
Inhalt heil ist.

Versioniert, weil ein Wiederaufnahmelauf (`--resume`) sie auch nach einem
frischen Clone finden muss, und weil sie zur Akte eines Rollouts gehört. Sie
enthalten Zählstände und Prüfsummen — keine Namen, keine Adressen.

Die Laufprotokolle liegen dagegen unter `supabase/log/staging/` und sind
ungetrackt.

| Datei | Herkunft |
|---|---|
| `baseline-0146.json` | **nachgetragen** — `0146` lief von Hand, bevor es den Runner gab. Die Werte sind die Zeilen 900/901 aus genau dem Preflight, der vor der Migration lief |
