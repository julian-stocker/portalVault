import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  PlatformSourceError,
  fetchAuthInventoryRows,
  fetchPlatformDocument,
  listBucketObjects,
  makeStorageByteSource,
  type PlatformSourceClient,
  type RawStorageEntry,
} from "./platform-source";
import {
  PlatformExportError,
  confirmReceivedRun,
  preparePlatformExport,
  recordFailedRun,
  recordGeneratedRun,
} from "./platform-export";
import { PLATFORM_FORMAT, PLATFORM_FORMAT_VERSION, PLATFORM_SECTIONS } from "./platform-manifest";
import { CATALOG_BUCKET } from "../catalog/image";

/**
 * Die Adapter und der Ablauf.
 *
 * Der Client ist ein struktureller Typ, also braucht dieser Test kein Netz,
 * keine Cookies und kein Supabase. Was er prüft, ist genau das, was man an
 * einer Route nicht mehr prüfen könnte: welche Funktionen gerufen werden,
 * welche nicht, was bei einer verweigerten Datei passiert, und dass die
 * Prüfsumme zum ausgelieferten Strom gehört.
 */

const dec = new TextDecoder();
const STAGING = "https://qqxcpesbwfxzgytkdsac.supabase.co";

function documentFixture(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const section of PLATFORM_SECTIONS) data[section.key] = [];
  data.skylanders = [{ sky_id: "SKY-0009", image_override_path: "SKY-0009/aaaaaaaaaaaaaaaa.webp" }];
  return {
    format: PLATFORM_FORMAT,
    format_version: PLATFORM_FORMAT_VERSION,
    created_at: "2026-09-30T12:00:00.000Z",
    commerce_mode: "sandbox",
    snapshot_txid: "39698:39698:",
    data,
  };
}

function fileEntry(name: string, size: number): RawStorageEntry {
  return {
    name,
    id: "02bc58fa-a187-4148-88d0-e5713c6d1874",
    created_at: "2026-09-16T13:18:06.014Z",
    updated_at: "2026-09-16T13:18:06.014Z",
    metadata: { size, mimetype: "image/webp", eTag: '"abc"' },
  };
}

function folderEntry(name: string): RawStorageEntry {
  return { name, id: null, created_at: null, updated_at: null, metadata: null };
}

/**
 * Ein Client, der sich wie Supabase verhält — und mitschreibt, was gerufen
 * wurde.
 */
function fakeClient(options: {
  document?: unknown;
  documentError?: unknown;
  auth?: unknown;
  authError?: unknown;
  tree?: Record<string, RawStorageEntry[]>;
  listError?: unknown;
  download?: (path: string) => { data: Blob | null; error: unknown };
} = {}) {
  const calls: { rpc: string[]; list: string[]; download: string[] } =
    { rpc: [], list: [], download: [] };
  const tree = options.tree ?? {
    "": [folderEntry("SKY-0009")],
    "SKY-0009": [fileEntry("aaaaaaaaaaaaaaaa.webp", 4)],
  };

  const client: PlatformSourceClient = {
    async rpc(fn: string) {
      calls.rpc.push(fn);
      if (fn === "system_platform_export") {
        return {
          data: "document" in options ? options.document : documentFixture(),
          error: options.documentError ?? null,
        };
      }
      if (fn === "system_auth_inventory") {
        return {
          data: "auth" in options ? options.auth : [{ id: "a", email: "a@example.test" }],
          error: options.authError ?? null,
        };
      }
      return { data: null, error: { message: "unknown function" } };
    },
    storage: {
      from(bucket: string) {
        return {
          async list(path: string) {
            calls.list.push(`${bucket}:${path}`);
            if (options.listError) return { data: null, error: options.listError };
            return { data: tree[path] ?? [], error: null };
          },
          async download(path: string) {
            calls.download.push(`${bucket}:${path}`);
            if (options.download) return options.download(path);
            // Pfad in Verzeichnis und Namen zerlegen, beliebig tief — sonst
            // stolpert der Fake über genau die Struktur, die der Test prüft.
            const cut = path.lastIndexOf("/");
            const dir = cut < 0 ? "" : path.slice(0, cut);
            const base = cut < 0 ? path : path.slice(cut + 1);
            const size = tree[dir]?.find((e) => e.name === base)?.metadata?.size ?? 0;
            return { data: new Blob([new Uint8Array(size)]), error: null };
          },
        };
      },
    },
  };
  return { client, calls };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Die Adapter holen genau aus den vorgesehenen Quellen
// ---------------------------------------------------------------------------

describe("database.json kommt ausschließlich aus system_platform_export()", () => {
  it("ruft genau diese Funktion und keine Tabelle", async () => {
    const { client, calls } = fakeClient();
    const document = await fetchPlatformDocument(client);
    expect(calls.rpc).toEqual(["system_platform_export"]);
    expect(Object.keys(document.data ?? {})).toHaveLength(PLATFORM_SECTIONS.length);
  });

  it("liest null nicht als leeres Backup", async () => {
    // So antwortet die Funktion einem Konto ohne Plattformrecht. Eine Datei
    // mit `{}` sähe aus wie eine Sicherung ohne Inhalt.
    const { client } = fakeClient({ document: null });
    await expect(fetchPlatformDocument(client)).rejects.toThrow(PlatformSourceError);
  });

  it("gibt die Fehlermeldung der Datenbank nicht weiter", async () => {
    const { client } = fakeClient({ documentError: { message: 'relation "orders" does not exist' } });
    try {
      await fetchPlatformDocument(client);
      expect.unreachable("hätte werfen müssen");
    } catch (error) {
      expect((error as Error).message).not.toContain("orders");
      expect((error as PlatformSourceError).stage).toBe("database");
    }
  });
});

describe("auth-users.json kommt ausschließlich aus system_auth_inventory()", () => {
  it("ruft genau diese Funktion", async () => {
    const { client, calls } = fakeClient();
    const rows = await fetchAuthInventoryRows(client);
    expect(calls.rpc).toEqual(["system_auth_inventory"]);
    expect(rows).toHaveLength(1);
  });

  it("liest weder auth.users noch profiles selbst", () => {
    const code = readFileSync("src/lib/backup/platform-source.ts", "utf8");
    for (const verboten of ["auth.users", 'from("profiles")', "from('profiles')",
                            'from("auth', "admin_find_accounts"]) {
      expect(code, `${verboten} wäre eine zweite Quelle`).not.toContain(verboten);
    }
  });

  it("weist null und eine falsche Form ab, mit der richtigen Stufe", async () => {
    for (const auth of [null, { nope: true }, "text"]) {
      const { client } = fakeClient({ auth });
      try {
        await fetchAuthInventoryRows(client);
        expect.unreachable("hätte werfen müssen");
      } catch (error) {
        expect((error as PlatformSourceError).stage).toBe("auth_inventory");
      }
    }
  });
});

describe("das Storage-Inventar liest die vorhandene Struktur", () => {
  it("steigt in die SKY-ID-Präfixe ab und setzt den Pfad zusammen", async () => {
    const { client, calls } = fakeClient();
    const { objects } = await listBucketObjects(client);
    expect(objects.map((o) => o.name)).toEqual(["SKY-0009/aaaaaaaaaaaaaaaa.webp"]);
    expect(calls.list).toEqual(["catalog:", "catalog:SKY-0009"]);
  });

  it("nimmt die sieben Metadaten aus der Antwort, ohne sie zu erfinden", async () => {
    const { client } = fakeClient();
    const [object] = (await listBucketObjects(client)).objects;
    expect(object).toEqual({
      name: "SKY-0009/aaaaaaaaaaaaaaaa.webp",
      size: 4,
      mimetype: "image/webp",
      etag: '"abc"',
      created_at: "2026-09-16T13:18:06.014Z",
      updated_at: "2026-09-16T13:18:06.014Z",
    });
  });

  it("verwendet den Bucketnamen aus der Katalogschicht", () => {
    expect(CATALOG_BUCKET).toBe("catalog");
    const code = readFileSync("src/lib/backup/platform-source.ts", "utf8");
    expect(code).toContain('from "../catalog/image"');
    // Kein zweites Literal: der Bucketname hat genau eine Quelle.
    expect(code).not.toContain('"catalog"');
  });

  it("verwirft einen Objektnamen, den der ZIP-Schreiber nicht annähme", async () => {
    /*
     * Ein Name aus einer fremden API ist Eingabe, nicht Wahrheit. Geprüft
     * wird der Pfad, den das Archiv tragen würde — vor dem Archiv.
     */
    const { client } = fakeClient({
      tree: {
        "": [fileEntry("gut.webp", 1), fileEntry("../boese.webp", 1), fileEntry("/absolut.webp", 1)],
      },
    });
    const { objects, rejected } = await listBucketObjects(client);
    expect(objects.map((o) => o.name)).toEqual(["gut.webp"]);
    // Und die beiden anderen sind nicht verschwunden, sondern benannt.
    expect(rejected).toEqual(["../boese.webp", "/absolut.webp"]);
  });

  it("blättert weiter, solange eine Seite voll ist", async () => {
    const voll = Array.from({ length: 100 }, (_, i) => fileEntry(`f${String(i).padStart(3, "0")}.webp`, 1));
    let runde = 0;
    const client: PlatformSourceClient = {
      async rpc() { return { data: null, error: null }; },
      storage: {
        from() {
          return {
            async list() {
              runde += 1;
              return { data: runde === 1 ? voll : [fileEntry("letzte.webp", 1)], error: null };
            },
            async download() { return { data: new Blob([]), error: null }; },
          };
        },
      },
    };
    const { objects } = await listBucketObjects(client);
    expect(objects).toHaveLength(101);
    expect(runde).toBe(2);
  });

  it("steigt beliebig tief ab — eine zukünftige Struktur verschwindet nicht", async () => {
    /*
     * Der Bucket ist heute eine Ebene tief. Eine Sicherung, die eine spätere
     * tiefere Struktur still ausließe, wäre wertlos — deshalb gibt es keine
     * Tiefenbegrenzung, nur einen Schleifenschutz.
     */
    const { client } = fakeClient({
      tree: {
        "": [folderEntry("SKY-0009")],
        "SKY-0009": [folderEntry("2026"), fileEntry("flach.webp", 1)],
        "SKY-0009/2026": [folderEntry("q3"), fileEntry("mittel.webp", 2)],
        "SKY-0009/2026/q3": [folderEntry("tief"), fileEntry("tiefer.webp", 3)],
        "SKY-0009/2026/q3/tief": [fileEntry("ganz-unten.webp", 4)],
      },
    });
    const { objects, rejected } = await listBucketObjects(client);
    expect(objects.map((o) => o.name)).toEqual([
      "SKY-0009/2026/mittel.webp",
      "SKY-0009/2026/q3/tief/ganz-unten.webp",
      "SKY-0009/2026/q3/tiefer.webp",
      "SKY-0009/flach.webp",
    ]);
    expect(rejected).toEqual([]);
  });

  it("und die tiefen Dateien landen wirklich im Archiv", async () => {
    const { client } = fakeClient({
      tree: {
        "": [folderEntry("SKY-0009")],
        "SKY-0009": [folderEntry("a")],
        "SKY-0009/a": [folderEntry("b")],
        "SKY-0009/a/b": [fileEntry("tief.webp", 2)],
      },
    });
    const prepared = await preparePlatformExport({ client, supabaseUrl: STAGING });
    const zip = await readAll(prepared.body);
    expect(dec.decode(zip)).toContain("storage/catalog/SKY-0009/a/b/tief.webp");
    expect(prepared.measured()!.storage_file_count).toBe(1);
  });

  it("wirft, statt zu überspringen, wenn ein Präfix zweimal genannt wird", async () => {
    // Eine API, die sich im Kreis dreht, darf keine halbe Sicherung ergeben.
    const { client } = fakeClient({
      tree: { "": [folderEntry("a")], a: [folderEntry("a")], "a/a": [] },
    });
    // `a/a` wird gemeldet, ist neu — erst `a/a/a` wäre eine Wiederholung.
    // Der echte Kreis: derselbe Name auf derselben Ebene, zweimal.
    const { client: kreis } = fakeClient({
      tree: { "": [folderEntry("a"), folderEntry("a")] },
    });
    await expect(listBucketObjects(kreis)).rejects.toThrow(PlatformSourceError);
    await expect(listBucketObjects(client)).resolves.toBeTruthy();
  });

  it("wirft bei einem Ordnernamen mit Trennzeichen und bei einem ohne Namen", async () => {
    for (const eintrag of [folderEntry("a/b"), folderEntry("")]) {
      const { client } = fakeClient({ tree: { "": [eintrag] } });
      await expect(listBucketObjects(client)).rejects.toThrow(PlatformSourceError);
    }
  });

  it("wirft bei zu großer Tiefe, statt still abzuschneiden", async () => {
    /*
     * Die Grenze ist ein Schleifenschutz, keine Inhaltsgrenze — und sie führt
     * zum Fehler, nicht zum Auslassen. Der Test baut eine Kette, die tiefer
     * ist als sie.
     */
    const tree: Record<string, RawStorageEntry[]> = {};
    let prefix = "";
    for (let i = 0; i < 40; i++) {
      const name = `d${i}`;
      tree[prefix] = [folderEntry(name)];
      prefix = prefix === "" ? name : `${prefix}/${name}`;
    }
    tree[prefix] = [fileEntry("unten.webp", 1)];
    const { client } = fakeClient({ tree });
    try {
      await listBucketObjects(client);
      expect.unreachable("hätte werfen müssen");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformSourceError);
      expect((error as PlatformSourceError).stage).toBe("storage_manifest");
      expect((error as Error).message).toContain("Verzeichnistiefe");
    }
  });

  it("verworfene Namen zählen als fehlend und stehen im Storage-Manifest", async () => {
    const { client } = fakeClient({
      tree: { "": [fileEntry("gut.webp", 1), fileEntry("../boese.webp", 1)] },
    });
    const prepared = await preparePlatformExport({ client, supabaseUrl: STAGING });
    const zip = await readAll(prepared.body);
    /*
     * Der Name steht IM storage-manifest.json, und dessen Inhalt ist im
     * Archiv komprimiert — geprüft wird er deshalb auf Archivebene
     * (platform-archive.test.ts). Hier zählt, dass er nicht als Archivpfad
     * auftaucht und dass die Zahlen ihn als fehlend führen.
     */
    expect(dec.decode(zip)).not.toContain("storage/catalog/../");
    /*
     * Zwei, und beide zu Recht: der verworfene Name UND das laut Dokument
     * erwartete `SKY-0009/aaaaaaaaaaaaaaaa.webp`, das in diesem Bucket-Baum
     * nicht vorkommt. Genau die Trennung, die das Storage-Manifest aufführt.
     */
    expect(prepared.measured()!.storage_missing_count).toBe(2);
    expect(prepared.measured()!.storage_file_count).toBe(1);
  });

  it("meldet eine unlesbare Objektliste mit der Stufe storage_manifest", async () => {
    const { client } = fakeClient({ listError: { message: "bucket not found: catalog-secret" } });
    try {
      await listBucketObjects(client);
      expect.unreachable("hätte werfen müssen");
    } catch (error) {
      expect((error as PlatformSourceError).stage).toBe("storage_manifest");
      expect((error as Error).message).not.toContain("catalog-secret");
    }
  });

  it("holt Bytes über dieselbe Sitzung, nicht über eine öffentliche Adresse", async () => {
    const { client, calls } = fakeClient();
    const bytes = await makeStorageByteSource(client)("catalog", "SKY-0009/aaaaaaaaaaaaaaaa.webp");
    expect(bytes).toHaveLength(4);
    expect(calls.download).toEqual(["catalog:SKY-0009/aaaaaaaaaaaaaaaa.webp"]);
    const code = readFileSync("src/lib/backup/platform-source.ts", "utf8");
    expect(code).not.toContain("storageUrl");
    expect(code).not.toContain("/storage/v1/object/public/");
  });
});

// ---------------------------------------------------------------------------
// 2. Keine Service Role, keine zweite Rollenlogik, keine Logs
// ---------------------------------------------------------------------------

describe("die Grenzen des Exportwegs", () => {
  /**
   * Ausführbarer Code, ohne Kommentare.
   *
   * Die Kopfkommentare beider Dateien ERKLÄREN gerade, welche Wächter in der
   * Datenbank sitzen und warum `source_project` nicht aus dem Anfrage-Host
   * kommt. Eine Prüfung gegen den Rohtext würde also genau die Sätze
   * bestrafen, die die Regel festhalten.
   */
  function codeOf(file: string): string {
    return readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
  }
  const source = codeOf("src/lib/backup/platform-source.ts");
  const orchestrator = codeOf("src/lib/backup/platform-export.ts");
  const both = `${source}\n${orchestrator}`;

  it("kennt keinen Service-Role-Schlüssel und keine zweite Verbindung", () => {
    for (const verboten of ["SERVICE_ROLE", "service_role", "createClient(",
                            "SUPABASE_SERVICE", "apikey", "Authorization"]) {
      expect(both.includes(verboten), `${verboten} gehört nicht in den Exportweg`).toBe(false);
    }
  });

  it("erfindet keine Rollenlogik neben den DB-Wächtern", () => {
    for (const verboten of ["is_platform_admin", "isPlatformAdmin", "platform_admins",
                            "capabilities(", "accountType"]) {
      expect(both.includes(verboten), `${verboten} wäre eine zweite Wahrheit`).toBe(false);
    }
  });

  it("schreibt nichts in ein Protokoll", () => {
    for (const verboten of ["console.log", "console.error", "console.warn", "console.info",
                            "console.debug", "process.stdout", "process.stderr"]) {
      expect(both.includes(verboten), `${verboten} könnte Backup-Inhalt tragen`).toBe(false);
    }
  });

  it("schreibt niemals direkt auf platform_export_runs", () => {
    /*
     * Die Tabelle hat keine Policy und keine Grants — es gibt technisch
     * keinen anderen Weg als die drei Funktionen aus 0106. Dieser Test hält
     * fest, dass auch der Code keinen versucht.
     */
    // Kein Tabellenzugriff überhaupt: das einzige `.from(` im Exportweg ist
    // `client.storage.from(<bucket>)`.
    const froms = [...both.matchAll(/(\w+(?:\.\w+)*)\.from\(/g)].map((m) => m[1]);
    expect([...new Set(froms)]).toEqual(["client.storage"]);
    expect(both).not.toContain("platform_export_runs");
    expect(both).not.toContain(".insert(");
    expect(both).not.toContain(".upsert(");
    expect(both).not.toContain(".delete(");
  });

  it("ruft ausschließlich die vier vorgesehenen Funktionen", () => {
    const gerufen = [...both.matchAll(/rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect([...new Set(gerufen)]).toEqual([
      "admin_record_platform_export",
      "admin_settle_platform_export",
      "system_auth_inventory",
      "system_platform_export",
    ]);
  });

  it("bestimmt source_project aus der kanonischen Projekt-URL, nie aus dem Anfrage-Host", () => {
    expect(orchestrator).toContain("projectRefFromUrl(input.supabaseUrl)");
    for (const verboten of ["headers()", "request.url", "req.headers", "host", "origin",
                            "x-forwarded"]) {
      expect(orchestrator.toLowerCase().includes(verboten.toLowerCase()),
        `${verboten} darf source_project nicht bestimmen`).toBe(false);
    }
  });

  it("baut den ZIP-Schreiber nicht neu", () => {
    expect(orchestrator).toContain('from "../zip/zip-writer"');
    for (const verboten of ["crc32", "0x504b", "local file header", "central directory",
                            "deflate", "CompressionStream"]) {
      expect(orchestrator.includes(verboten), `${verboten} wäre ein zweiter ZIP-Schreiber`)
        .toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Der Ablauf
// ---------------------------------------------------------------------------

describe("preparePlatformExport", () => {
  it("holt in der vorgesehenen Reihenfolge und liefert einen Strom", async () => {
    const { client, calls } = fakeClient();
    const prepared = await preparePlatformExport({ client, supabaseUrl: STAGING });
    expect(calls.rpc).toEqual(["system_platform_export", "system_auth_inventory"]);
    expect(calls.list).toEqual(["catalog:", "catalog:SKY-0009"]);
    // Noch kein Byte geholt: der Strom läuft erst beim Lesen.
    expect(calls.download).toEqual([]);
    expect(prepared.fileName).toMatch(/^skyisles-platform-backup-\d{4}-\d{2}-\d{2}T\d{6}Z\.zip$/);
    expect(prepared.measured()).toBeNull();

    const zip = await readAll(prepared.body);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(calls.download).toEqual(["catalog:SKY-0009/aaaaaaaaaaaaaaaa.webp"]);
  });

  it("die Prüfsumme gehört zum ausgelieferten Strom", async () => {
    const { client } = fakeClient();
    const prepared = await preparePlatformExport({ client, supabaseUrl: STAGING });
    const zip = await readAll(prepared.body);
    const measured = prepared.measured()!;
    expect(measured.sha256).toBe(createHash("sha256").update(zip).digest("hex"));
    expect(measured.size_bytes).toBe(zip.length);
    expect(measured.source_project).toBe("qqxcpesbwfxzgytkdsac");
    expect(measured.format_version).toBe(PLATFORM_FORMAT_VERSION);
    expect(measured.section_count).toBe(PLATFORM_SECTIONS.length);
    expect(measured.storage_file_count).toBe(1);
    expect(measured.storage_missing_count).toBe(0);
  });

  it("liefert das Archiv auch dann, wenn eine Datei nicht lesbar ist", async () => {
    const { client } = fakeClient({
      download: () => ({ data: null, error: { message: "object not found" } }),
    });
    const prepared = await preparePlatformExport({ client, supabaseUrl: STAGING });
    const zip = await readAll(prepared.body);
    expect(zip.length).toBeGreaterThan(0);
    const measured = prepared.measured()!;
    expect(measured.storage_file_count).toBe(0);
    expect(measured.storage_missing_count).toBe(1);
  });

  it("wirft mit der Stufe, wenn eine Quelle vor dem Strom scheitert", async () => {
    for (const [options, stage] of [
      [{ documentError: { message: "x" } }, "database"],
      [{ authError: { message: "x" } }, "auth_inventory"],
      [{ listError: { message: "x" } }, "storage_manifest"],
    ] as const) {
      const { client } = fakeClient(options);
      try {
        await preparePlatformExport({ client, supabaseUrl: STAGING });
        expect.unreachable("hätte werfen müssen");
      } catch (error) {
        expect(error).toBeInstanceOf(PlatformExportError);
        expect((error as PlatformExportError).stage).toBe(stage);
      }
    }
  });

  it("wirft, bevor ein Byte das Haus verlässt, wenn ein gesperrtes Auth-Feld ankommt", async () => {
    /*
     * Die Stelle, an der ein versehentliches `select *` in einer künftigen
     * Migration auffällt — und zwar vor dem ersten Byte.
     */
    const { client } = fakeClient({ auth: [{ id: "a", encrypted_password: "$2a$…" }] });
    await expect(preparePlatformExport({ client, supabaseUrl: STAGING }))
      .rejects.toThrow(/Gesperrte Felder/);
  });

  it("trägt keine Projektreferenz, wenn die Adresse keine ist", async () => {
    const { client } = fakeClient();
    const prepared = await preparePlatformExport({ client, supabaseUrl: "http://localhost:54321" });
    await readAll(prepared.body);
    // `0105` verlangt sie für jeden nicht-gescheiterten Lauf; ein leerer Wert
    // lässt `admin_record_platform_export()` am CHECK scheitern, statt eine
    // Sicherung unbekannter Herkunft zu verbuchen.
    expect(prepared.measured()!.source_project).toBe("");
  });

  it("das Archiv enthält die vier Wurzeldateien und nur erlaubte Pfade", async () => {
    const { client } = fakeClient();
    const prepared = await preparePlatformExport({ client, supabaseUrl: STAGING });
    const zip = await readAll(prepared.body);
    const text = dec.decode(zip);
    for (const name of ["manifest.json", "database.json", "auth-users.json",
                        "storage-manifest.json", "storage/catalog/SKY-0009/"]) {
      expect(text, `${name} fehlt im Archiv`).toContain(name);
    }
    expect(text).not.toContain("../");
  });
});

// ---------------------------------------------------------------------------
// 4. Die Historie
// ---------------------------------------------------------------------------

describe("die Historie läuft ausschließlich über 0106", () => {
  function historyClient(result: { data?: unknown; error?: unknown } = {}) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    return {
      calls,
      client: {
        async rpc(fn: string, args: Record<string, unknown>) {
          calls.push({ fn, args });
          return { data: result.data ?? 7, error: result.error ?? null };
        },
      },
    };
  }

  const measured = {
    format_version: 1,
    source_project: "qqxcpesbwfxzgytkdsac",
    size_bytes: 2240705,
    sha256: "a".repeat(64),
    section_count: 53,
    storage_file_count: 36,
    storage_missing_count: 0,
  };

  it("generated mit genau den sieben gemessenen Werten", async () => {
    const { client, calls } = historyClient();
    expect(await recordGeneratedRun(client, measured)).toBe(7);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("admin_record_platform_export");
    expect(calls[0].args).toEqual({
      p_format_version: 1,
      p_source_project: "qqxcpesbwfxzgytkdsac",
      p_size_bytes: 2240705,
      p_sha256: "a".repeat(64),
      p_section_count: 53,
      p_storage_file_count: 36,
      p_storage_missing_count: 0,
    });
    // Kein Status als Parameter: nur die Funktion entscheidet, dass es
    // `generated` ist.
    expect(Object.keys(calls[0].args)).not.toContain("p_status");
  });

  it("received übergibt die Prüfsumme und vergleicht sie nicht selbst", async () => {
    const { client, calls } = historyClient({ data: "received" });
    await confirmReceivedRun(client, 7, "b".repeat(64));
    expect(calls[0].fn).toBe("admin_settle_platform_export");
    expect(calls[0].args).toEqual({ p_id: 7, p_sha256: "b".repeat(64) });
    // Keine failure_stage: genau eine Absicht pro Aufruf (0106).
    expect(calls[0].args).not.toHaveProperty("p_failure_stage");
  });

  it("failed übergibt eine Stufe und keine Prüfsumme", async () => {
    const { client, calls } = historyClient({ data: "failed" });
    await recordFailedRun(client, 7, "confirmation");
    expect(calls[0].args).toEqual({ p_id: 7, p_failure_stage: "confirmation" });
    expect(calls[0].args).not.toHaveProperty("p_sha256");
  });

  it("die Stufen sind genau die, die 0105 als CHECK kennt", () => {
    const sql = readFileSync("supabase/migrations/0105_platform_export.sql", "utf8");
    const erlaubt = sql
      .slice(sql.indexOf("failure_stage in ("))
      .slice(0, 200)
      .match(/'([a-z_]+)'/g)!
      .map((s) => s.replaceAll("'", ""));
    const code = readFileSync("src/lib/backup/platform-export.ts", "utf8");
    const typ = code.slice(code.indexOf("export type FailureStage"), code.indexOf(";", code.indexOf("export type FailureStage")));
    const imCode = (typ.match(/"([a-z_]+)"/g) ?? []).map((s) => s.replaceAll('"', ""));
    expect(imCode.sort()).toEqual([...erlaubt].sort());
  });

  it("gibt keine Fehlermeldung der Datenbank weiter", async () => {
    const { client } = historyClient({ error: { message: 'duplicate key value violates "x"' } });
    for (const call of [
      () => recordGeneratedRun(client, measured),
      () => confirmReceivedRun(client, 7, "a".repeat(64)),
      () => recordFailedRun(client, 7, "archive"),
    ]) {
      try {
        await call();
        expect.unreachable("hätte werfen müssen");
      } catch (error) {
        expect((error as Error).message).not.toContain("duplicate key");
      }
    }
  });
});
