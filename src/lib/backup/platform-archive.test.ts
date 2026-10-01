import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  BackupRedactionError,
  EXPECTED_SECTION_COUNT,
  PlatformArchiveError,
  authInventoryDocument,
  expectedStoragePaths,
  exportMeasurements,
  platformArchive,
  platformArchiveFileName,
  platformManifestDocument,
  storageEntryPath,
  storageManifestDocument,
  type PlatformExportDocument,
  type StorageObject,
} from "./platform-archive";
import {
  AUTH_FORBIDDEN_FIELDS,
  AUTH_INVENTORY_DISCLAIMER,
  AUTH_INVENTORY_FIELDS,
  PLATFORM_ARCHIVE_LAYOUT,
  PLATFORM_FORBIDDEN_FIELDS,
  PLATFORM_FORMAT,
  PLATFORM_FORMAT_VERSION,
  PLATFORM_METADATA_FIELDS,
  PLATFORM_METADATA_SOURCE,
  PLATFORM_SECTIONS,
  STORAGE_BUCKETS_INCLUDED,
} from "./platform-manifest";
import { isSafeZipPath } from "../zip/zip-path";
import { zipBytes, type ZipEntry } from "../zip/zip-writer";

/**
 * Die Archivschicht des Plattform-Exports.
 *
 * Reine Funktionen, deshalb hier vollständig prüfbar — ohne Datenbank, ohne
 * Netz, ohne Schlüssel. Genau deshalb liegt die Redaktionsregel („kein
 * Geheimnis im ZIP") hier und nicht in einer Route: sie ist die Regel, die man
 * nicht durch Ausprobieren prüfen will.
 */

const dec = new TextDecoder();

/** Ein kleines, aber formtreues Datenbankdokument. */
function documentFixture(): PlatformExportDocument {
  const data: Record<string, unknown> = {};
  for (const section of PLATFORM_SECTIONS) data[section.key] = [];
  data.skylanders = [
    { sky_id: "SKY-0009", image_override_path: "SKY-0009/c29021891080cd90.jpg" },
    { sky_id: "SKY-0027", image_override_path: "SKY-0027/aaaaaaaaaaaaaaaa.webp" },
    { sky_id: "SKY-0031", image_override_path: null },
    { sky_id: "SKY-0033" },
  ];
  data.orders = [{ id: 1, total_amount: "24.90" }];
  return {
    format: PLATFORM_FORMAT,
    format_version: PLATFORM_FORMAT_VERSION,
    created_at: "2026-09-30T12:00:00.000Z",
    commerce_mode: "sandbox",
    snapshot_txid: "39698:39698:",
    data,
  };
}

function objectFixture(name: string, size: number): StorageObject {
  return {
    name,
    size,
    mimetype: "image/webp",
    etag: '"29e986ecfca943f70f32b751fe588abb"',
    created_at: "2026-09-16T13:18:06.014Z",
    updated_at: "2026-09-16T13:18:06.014Z",
  };
}

/** Der übliche Aufbau: zwei erwartete Objekte, beide lesbar. */
function setup(overrides: {
  listed?: StorageObject[];
  bytes?: (bucket: string, name: string) => Promise<Uint8Array>;
} = {}) {
  const document = documentFixture();
  const auth = authInventoryDocument([{ id: "a", email: "a@example.test" }]);
  const listed = overrides.listed ?? [
    objectFixture("SKY-0009/c29021891080cd90.jpg", 3),
    objectFixture("SKY-0027/aaaaaaaaaaaaaaaa.webp", 4),
  ];
  const bytes =
    overrides.bytes ??
    (async (_b: string, name: string) => new Uint8Array(name.endsWith(".jpg") ? 3 : 4));
  const archive = platformArchive({
    document, auth, listed,
    expected: expectedStoragePaths(document),
    bytes,
    sourceProject: "qqxcpesbwfxzgytkdsac",
  });
  return { document, auth, listed, archive };
}

async function collect(archive: ReturnType<typeof platformArchive>): Promise<ZipEntry[]> {
  const out: ZipEntry[] = [];
  for await (const entry of archive.entries()) out.push(entry);
  return out;
}

// ---------------------------------------------------------------------------
// 1. Die Schicht bleibt rein
// ---------------------------------------------------------------------------

describe("die Archivschicht rechnet und holt nichts", () => {
  const code = readFileSync("src/lib/backup/platform-archive.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

  it("kennt weder Netz noch Datenbank noch Umgebung", () => {
    for (const verboten of ["fetch(", "process.env", "createClient", "supabase",
                            "SERVICE_ROLE", "readFileSync", "writeFileSync", "rpc("]) {
      expect(code.includes(verboten), `${verboten} gehört nicht in diese Schicht`).toBe(false);
    }
  });

  it("importiert nur das Manifest, die Zähler und den ZIP-Typ", () => {
    const imports = [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["../zip/zip-writer", "./document", "./platform-manifest"]);
  });

  it("definiert die 53 Bereiche nicht neu", () => {
    // Kanonisch bleibt platform-manifest.ts. Ein zweiter Bereichsname hier
    // wäre der Anfang einer zweiten Wahrheit.
    for (const section of PLATFORM_SECTIONS) {
      if (section.key === "skylanders") continue; // Quelle der Bilderwartung
      expect(code, `${section.key} steht in der Archivschicht`).not.toContain(`"${section.key}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. auth-users.json
// ---------------------------------------------------------------------------

describe("das Auth-Inventar ist ein Inventar", () => {
  it("gibt genau die sieben Felder des Vertrags aus", () => {
    const doc = authInventoryDocument([
      { id: "b", email: "b@example.test", created_at: "x", last_sign_in_at: null,
        email_confirmed_at: "y", provider: "email", banned_until: null },
    ]);
    expect(Object.keys(doc.users[0])).toEqual([...AUTH_INVENTORY_FIELDS]);
    expect(AUTH_INVENTORY_FIELDS).toHaveLength(7);
  });

  it("ergänzt fehlende Felder als null statt sie wegzulassen", () => {
    const doc = authInventoryDocument([{ id: "a", email: "a@example.test" }]);
    expect(doc.users[0]).toEqual({
      id: "a", email: "a@example.test", created_at: null, last_sign_in_at: null,
      email_confirmed_at: null, provider: null, banned_until: null,
    });
  });

  it("lässt jedes Feld liegen, das nicht im Vertrag steht", () => {
    const doc = authInventoryDocument([
      { id: "a", email: "a@example.test", phone: "+43", is_super_admin: true, aud: "authenticated" },
    ]);
    expect(Object.keys(doc.users[0])).toEqual([...AUTH_INVENTORY_FIELDS]);
    expect(JSON.stringify(doc)).not.toContain("+43");
    expect(JSON.stringify(doc)).not.toContain("is_super_admin");
  });

  for (const feld of Object.keys(AUTH_FORBIDDEN_FIELDS)) {
    it(`wirft, wenn die Quelle ${feld} mitschickt`, () => {
      expect(() => authInventoryDocument([{ id: "a", [feld]: "egal" }]))
        .toThrow(BackupRedactionError);
    });
  }

  it("nennt alle Verstöße auf einmal, sortiert", () => {
    try {
      authInventoryDocument([
        { id: "a", encrypted_password: "x" },
        { id: "b", confirmation_token: "y", factors: [] },
      ]);
      expect.unreachable("hätte werfen müssen");
    } catch (error) {
      expect(error).toBeInstanceOf(BackupRedactionError);
      expect((error as BackupRedactionError).fields)
        .toEqual(["confirmation_token", "encrypted_password", "factors"]);
    }
  });

  it("wirft auch bei den Sperren des Datenbankvertrags", () => {
    expect(() => authInventoryDocument([{ id: "a", client_salt: "x" }]))
      .toThrow(BackupRedactionError);
    expect(Object.keys(PLATFORM_FORBIDDEN_FIELDS)).toContain("client_salt");
  });

  it("trägt den Disclaimer und sagt, dass kein Konto daraus entsteht", () => {
    const doc = authInventoryDocument([]);
    expect(doc.disclaimer).toBe(AUTH_INVENTORY_DISCLAIMER);
    expect(doc.disclaimer).toContain("kein Auth-Backup");
    expect(doc.restore_supported).toBe(false);
    expect(doc.auth_user_count).toBe(0);
  });

  it("sortiert nach id, damit zwei Sicherungen vergleichbar sind", () => {
    const doc = authInventoryDocument([{ id: "c" }, { id: "a" }, { id: "b" }]);
    expect(doc.users.map((u) => u.id)).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// 3. storage-manifest.json
// ---------------------------------------------------------------------------

describe("die Erwartung kommt aus dem Dokument, nicht aus einer zweiten Abfrage", () => {
  it("liest genau image_override_path", () => {
    expect(expectedStoragePaths(documentFixture())).toEqual([
      "SKY-0009/c29021891080cd90.jpg",
      "SKY-0027/aaaaaaaaaaaaaaaa.webp",
    ]);
  });

  it("ignoriert image_file — das liegt im Deployment, nicht im Bucket", () => {
    const doc = documentFixture();
    (doc.data!.skylanders as Record<string, unknown>[])[0].image_file = "deadbeefdeadbeef.webp";
    expect(expectedStoragePaths(doc)).not.toContain("deadbeefdeadbeef.webp");
  });

  it("verträgt ein Dokument ohne Katalog", () => {
    expect(expectedStoragePaths({})).toEqual([]);
    expect(expectedStoragePaths({ data: {} })).toEqual([]);
    expect(expectedStoragePaths({ data: { skylanders: "kaputt" } })).toEqual([]);
  });
});

describe("das Storage-Manifest trennt die beiden Arten von Lücke", () => {
  const expected = expectedStoragePaths(documentFixture());

  it("zählt und benennt, was erwartet wird und im Bucket nicht liegt", () => {
    const storage = storageManifestDocument({
      listed: [objectFixture("SKY-0009/c29021891080cd90.jpg", 70284)],
      expected,
    });
    expect(storage.storage_object_count).toBe(1);
    expect(storage.missing_from_bucket).toEqual(["SKY-0027/aaaaaaaaaaaaaaaa.webp"]);
    expect(storage.unreadable).toEqual([]);
    expect(storage.storage_missing_count).toBe(1);
  });

  it("zählt getrennt, was aufgelistet war und sich nicht lesen ließ", () => {
    const listed = [
      objectFixture("SKY-0009/c29021891080cd90.jpg", 1),
      objectFixture("SKY-0027/aaaaaaaaaaaaaaaa.webp", 1),
    ];
    const storage = storageManifestDocument({
      listed,
      written: [listed[0]],
      unreadable: ["SKY-0027/aaaaaaaaaaaaaaaa.webp"],
      expected,
    });
    expect(storage.missing_from_bucket).toEqual([]);
    expect(storage.unreadable).toEqual(["SKY-0027/aaaaaaaaaaaaaaaa.webp"]);
    // Beide Ursachen zusammen: „wie viele Dateien fehlen in dieser Sicherung".
    expect(storage.storage_missing_count).toBe(1);
    expect(storage.storage_object_count).toBe(1);
  });

  it("addiert beide Ursachen", () => {
    const listed = [objectFixture("SKY-0009/c29021891080cd90.jpg", 1)];
    const storage = storageManifestDocument({
      listed, written: [], unreadable: ["SKY-0009/c29021891080cd90.jpg"], expected,
    });
    expect(storage.storage_missing_count).toBe(2);
    expect(storage.storage_object_count).toBe(0);
  });

  it("zählt getrennt, was im Bucket liegt und niemand referenziert", () => {
    // Der Upload-Pfad nimmt Waisen in Kauf — „ein Verwaister ist billiger als
    // ein verlorenes Bild" (image-actions.ts). Sie werden mitgesichert, aber
    // sie sind kein Fehlen.
    const storage = storageManifestDocument({
      listed: [
        objectFixture("SKY-0009/c29021891080cd90.jpg", 1),
        objectFixture("SKY-0027/aaaaaaaaaaaaaaaa.webp", 1),
        objectFixture("SKY-0099/orphan0000000000.webp", 1),
      ],
      expected,
    });
    expect(storage.storage_missing_count).toBe(0);
    expect(storage.unreferenced_count).toBe(1);
    expect(storage.storage_object_count).toBe(3);
  });

  it("trägt genau die sieben Metadatenfelder des Vertrags plus den Bucket", () => {
    const storage = storageManifestDocument({
      listed: [objectFixture("SKY-0009/a.webp", 5)], expected: [],
    });
    expect(Object.keys(storage.objects[0]).sort()).toEqual(
      ["bucket_id", "created_at", "etag", "mimetype", "name", "size", "updated_at"]);
    expect(storage.buckets).toEqual(STORAGE_BUCKETS_INCLUDED);
  });

  it("sortiert die Objekte nach Pfad", () => {
    const storage = storageManifestDocument({
      listed: [objectFixture("b", 1), objectFixture("a", 1), objectFixture("c", 1)],
      expected: [],
    });
    expect(storage.objects.map((o) => o.name)).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// 4. manifest.json
// ---------------------------------------------------------------------------

describe("manifest.json trägt genau die Felder des Vertrags", () => {
  const doc = documentFixture();
  const auth = authInventoryDocument([{ id: "a" }, { id: "b" }]);
  const storage = storageManifestDocument({
    listed: [objectFixture("SKY-0009/c29021891080cd90.jpg", 70284)],
    expected: expectedStoragePaths(doc),
  });
  const manifest = platformManifestDocument({
    document: doc, auth, storage,
    sourceProject: "qqxcpesbwfxzgytkdsac",
    files: ["database.json"],
  });

  it("nicht mehr und nicht weniger als PLATFORM_METADATA_FIELDS", () => {
    expect(Object.keys(manifest).sort()).toEqual([...PLATFORM_METADATA_FIELDS].sort());
    expect(PLATFORM_METADATA_FIELDS).toHaveLength(13);
  });

  it("nimmt created_at und commerce_mode aus der Datenbank", () => {
    const ausDb = PLATFORM_METADATA_FIELDS.filter((f) => PLATFORM_METADATA_SOURCE[f] === "database");
    expect(ausDb).toEqual(["created_at", "commerce_mode"]);
    expect(manifest.created_at).toBe("2026-09-30T12:00:00.000Z");
    expect(manifest.commerce_mode).toBe("sandbox");
  });

  it("erfindet nichts, wenn die Datenbank es nicht mitschickt", () => {
    const leer = platformManifestDocument({
      document: {}, auth, storage, sourceProject: null, files: [],
    });
    expect(leer.created_at).toBeNull();
    expect(leer.commerce_mode).toBeNull();
    expect(leer.source_project).toBeNull();
  });

  it("zählt die Bereiche aus dem fertigen Dokument", () => {
    expect(Object.keys(manifest.counts)).toHaveLength(EXPECTED_SECTION_COUNT);
    expect(EXPECTED_SECTION_COUNT).toBe(53);
    expect(manifest.counts.skylanders).toBe(4);
    expect(manifest.counts.orders).toBe(1);
  });

  it("sagt, was die Datei ist und was sie nicht kann", () => {
    expect(manifest.format).toBe(PLATFORM_FORMAT);
    expect(manifest.format_version).toBe(PLATFORM_FORMAT_VERSION);
    expect(manifest.contains_personal_data).toBe(true);
    expect(manifest.auth_inventory_only).toBe(true);
    expect(manifest.restore_supported).toBe(false);
  });

  it("trägt nicht den eigenen Hash — den könnte es nicht kennen", () => {
    expect(PLATFORM_METADATA_FIELDS).not.toContain("sha256");
    expect(JSON.stringify(manifest)).not.toContain("sha256");
  });
});

// ---------------------------------------------------------------------------
// 5. Das Archiv
// ---------------------------------------------------------------------------

describe("das Archiv hat genau vier Wurzeldateien", () => {
  it("und die Objekte liegen ausschließlich unter storage/catalog/", async () => {
    const { archive } = setup();
    const entries = await collect(archive);
    const wurzel = entries.map((e) => e.path).filter((p) => !p.includes("/"));
    expect(wurzel.sort()).toEqual([
      "auth-users.json", "database.json", "manifest.json", "storage-manifest.json",
    ]);
    for (const path of entries.map((e) => e.path)) {
      if (wurzel.includes(path)) continue;
      expect(path.startsWith("storage/catalog/"), `${path} liegt nicht unter storage/catalog/`)
        .toBe(true);
    }
  });

  it("nennt genau die vier Namen aus PLATFORM_ARCHIVE_LAYOUT", () => {
    const { manifest, database, authUsers, storageManifest, storagePrefix } = PLATFORM_ARCHIVE_LAYOUT;
    expect([manifest, database, authUsers, storageManifest]).toEqual([
      "manifest.json", "database.json", "auth-users.json", "storage-manifest.json",
    ]);
    expect(storagePrefix).toBe("storage/");
    expect(storageEntryPath("catalog", "SKY-0009/a.webp")).toBe("storage/catalog/SKY-0009/a.webp");
  });

  it("jeder Pfad ist einer, den der ZIP-Schreiber annimmt", async () => {
    const { archive } = setup();
    for (const entry of await collect(archive)) {
      expect(isSafeZipPath(entry.path), `${entry.path} ist kein sicherer Pfad`).toBe(true);
    }
  });

  it("stellt die Deckblätter ans Ende, weil ihre Zahlen erst dann stimmen", async () => {
    /*
     * Ein Objekt kann sich beim Lesen verweigern, und der Export bricht daran
     * nicht ab — er NENNT die Lücke. Damit stehen die Zählwerte erst fest,
     * wenn die letzte Datei durch ist. Ein Deckblatt vorne müsste sie raten.
     */
    const { archive } = setup();
    const paths = (await collect(archive)).map((e) => e.path);
    expect(paths[0]).toBe("database.json");
    expect(paths[1]).toBe("auth-users.json");
    expect(paths.at(-2)).toBe("storage-manifest.json");
    expect(paths.at(-1)).toBe("manifest.json");
  });

  it("legt database.json unverändert ab — keine zweite Exportlogik", async () => {
    const { document, archive } = setup();
    const entries = await collect(archive);
    const database = entries.find((e) => e.path === "database.json")!;
    const wieder = JSON.parse(dec.decode(database.bytes));
    expect(wieder).toEqual(document);
    // Geld bleibt ein String, auf dem ganzen Weg.
    expect(wieder.data.orders[0].total_amount).toBe("24.90");
    expect(typeof wieder.data.orders[0].total_amount).toBe("string");
  });

  it("legt auth-users.json genau so ab, wie die Schicht es geformt hat", async () => {
    const { auth, archive } = setup();
    const entries = await collect(archive);
    const file = entries.find((e) => e.path === "auth-users.json")!;
    expect(JSON.parse(dec.decode(file.bytes))).toEqual(auth);
    expect(dec.decode(file.bytes)).toContain(AUTH_INVENTORY_DISCLAIMER);
  });

  it("legt die Bytes der Objekte unverändert ab", async () => {
    const { archive } = setup({
      bytes: async (_b, name) => new Uint8Array(name.endsWith(".jpg") ? [1, 2, 3] : [4, 5, 6, 7]),
    });
    const entries = await collect(archive);
    expect([...entries.find((e) => e.path.endsWith(".jpg"))!.bytes]).toEqual([1, 2, 3]);
  });

  it("holt die Bytes eines nach dem anderen, erst beim Durchlaufen", async () => {
    const geholt: string[] = [];
    const { archive } = setup({
      bytes: async (_b, name) => {
        geholt.push(name);
        return new Uint8Array(name.endsWith(".jpg") ? 3 : 4);
      },
    });
    const iterator = archive.entries();
    await iterator.next();            // database.json
    await iterator.next();            // auth-users.json
    expect(geholt).toEqual([]);
    await iterator.next();            // erstes Objekt
    expect(geholt).toEqual(["SKY-0009/c29021891080cd90.jpg"]);
  });

  it("ist deterministisch: zweimal derselbe Zustand, zweimal dasselbe Archiv", async () => {
    const a = await zipBytes(setup().archive.entries());
    const b = await zipBytes(setup().archive.entries());
    expect([...b]).toEqual([...a]);
  });

  it("baut mit dem bestehenden ZIP-Schreiber ein gültiges Archiv", async () => {
    const zip = await zipBytes(setup().archive.entries());
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Sechs Einträge: vier JSON, zwei Objekte.
    const count = new DataView(zip.buffer, zip.byteOffset).getUint16(zip.length - 22 + 10, true);
    expect(count).toBe(6);
  });
});

describe("eine fehlende Datei bricht den Export nicht ab", () => {
  it("zählt sie, nennt sie und liefert das Archiv trotzdem", async () => {
    const { archive } = setup({
      bytes: async (_b, name) => {
        if (name.endsWith(".webp")) throw new Error("503");
        return new Uint8Array(3);
      },
    });
    const entries = await collect(archive);
    const outcome = archive.outcome();

    // Das Archiv existiert und enthält die lesbare Datei.
    expect(entries.map((e) => e.path)).toContain("storage/catalog/SKY-0009/c29021891080cd90.jpg");
    expect(entries.map((e) => e.path)).not.toContain("storage/catalog/SKY-0027/aaaaaaaaaaaaaaaa.webp");

    expect(outcome.storage.unreadable).toEqual(["SKY-0027/aaaaaaaaaaaaaaaa.webp"]);
    expect(outcome.storage.storage_missing_count).toBe(1);
    expect(outcome.storage.storage_object_count).toBe(1);
    expect(outcome.manifest.storage_missing_count).toBe(1);
  });

  it("zählt ein Objekt, dessen Länge der Auflistung widerspricht, als nicht lesbar", async () => {
    const { archive } = setup({ bytes: async () => new Uint8Array(1) });
    await collect(archive);
    expect(archive.outcome().storage.unreadable).toHaveLength(2);
    expect(archive.outcome().storage.storage_object_count).toBe(0);
  });

  it("gibt die Ursache der Storage-API nicht weiter", async () => {
    /*
     * Eine Meldung der Storage-API kann eine signierte Adresse tragen. Der
     * Pfad steht im Manifest, der fremde Text nirgends.
     */
    const { archive } = setup({
      bytes: async () => { throw new Error("signed-url-secret-xyz"); },
    });
    const entries = await collect(archive);
    const alles = entries.map((e) => dec.decode(e.bytes)).join("\n");
    expect(alles).not.toContain("signed-url-secret-xyz");
    expect(alles).toContain("SKY-0009/c29021891080cd90.jpg");
  });

  it("das Manifest stimmt mit dem tatsächlichen Archiv überein", async () => {
    const { archive } = setup({
      bytes: async (_b, name) => {
        if (name.endsWith(".webp")) throw new Error("503");
        return new Uint8Array(3);
      },
    });
    const entries = await collect(archive);
    const manifest = JSON.parse(
      dec.decode(entries.find((e) => e.path === "manifest.json")!.bytes));

    // `files` nennt jeden Eintrag des Archivs, sich selbst eingeschlossen.
    expect(manifest.files).toEqual(entries.map((e) => e.path));
    // Und die Zählwerte beschreiben, was wirklich drin liegt.
    const objekte = entries.filter((e) => e.path.startsWith("storage/"));
    expect(manifest.storage_object_count).toBe(objekte.length);
  });

  it("ein verworfener Objektname wird benannt und als fehlend gezählt", async () => {
    /*
     * Ein Name, den der ZIP-Schreiber nicht annähme, wird von der Auflistung
     * verworfen — aber nicht verschwiegen. Er steht im Storage-Manifest und
     * zählt in `storage_missing_count`, weil eine Datei, die es gibt und die
     * nicht im Archiv liegt, fehlt.
     */
    const document = documentFixture();
    const archive = platformArchive({
      document,
      auth: authInventoryDocument([]),
      listed: [objectFixture("SKY-0009/c29021891080cd90.jpg", 3)],
      rejected: ["../boese.webp"],
      expected: expectedStoragePaths(document),
      bytes: async () => new Uint8Array(3),
      sourceProject: "qqxcpesbwfxzgytkdsac",
    });
    const entries = await collect(archive);
    const storage = JSON.parse(
      dec.decode(entries.find((e) => e.path === "storage-manifest.json")!.bytes));
    expect(storage.rejected).toEqual(["../boese.webp"]);
    // Ein erwartetes Objekt fehlt im Bucket, ein Name wurde verworfen.
    expect(storage.storage_missing_count).toBe(2);
    expect(entries.map((e) => e.path)).not.toContain("storage/catalog/../boese.webp");
  });

  it("outcome() gibt es erst nach dem letzten Eintrag", async () => {
    const { archive } = setup();
    expect(() => archive.outcome()).toThrow(PlatformArchiveError);
    await collect(archive);
    expect(archive.outcome().files).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// 6. Was in die Historie geht
// ---------------------------------------------------------------------------

describe("die Messwerte für admin_record_platform_export()", () => {
  it("liefert genau die sieben Parameter, die 0106 verlangt", async () => {
    const { archive } = setup();
    await collect(archive);
    const m = exportMeasurements({
      outcome: archive.outcome(),
      sourceProject: "qqxcpesbwfxzgytkdsac",
      sizeBytes: 2240705,
      sha256: "a".repeat(64),
    });
    expect(Object.keys(m).sort()).toEqual([
      "format_version", "section_count", "sha256", "size_bytes",
      "source_project", "storage_file_count", "storage_missing_count",
    ]);
    expect(m.section_count).toBe(EXPECTED_SECTION_COUNT);
    expect(m.storage_file_count).toBe(2);
    expect(m.storage_missing_count).toBe(0);
  });

  it("zählt die Bereiche am Dokument, nicht am Manifest der Codebasis", async () => {
    const document: PlatformExportDocument = { data: { skylanders: [], orders: [] } };
    const archive = platformArchive({
      document,
      auth: authInventoryDocument([]),
      listed: [], expected: [], bytes: async () => new Uint8Array(0),
      sourceProject: "x".repeat(20),
    });
    await collect(archive);
    expect(archive.outcome().sectionCount).toBe(2);
  });

  it("gibt Hash und Projektreferenz in der Form aus, die 0105 als CHECK verlangt", async () => {
    const { archive } = setup();
    await collect(archive);
    const m = exportMeasurements({
      outcome: archive.outcome(),
      sourceProject: "qqxcpesbwfxzgytkdsac",
      sizeBytes: 1,
      sha256: "0123456789abcdef".repeat(4),
    });
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.source_project).toMatch(/^[a-z0-9]{8,64}$/);
  });
});

describe("der Dateiname", () => {
  it("ist sortierbar, ohne Doppelpunkte und ohne Projektreferenz", () => {
    const name = platformArchiveFileName(new Date("2026-09-30T14:30:12.000Z"));
    expect(name).toBe("skyisles-platform-backup-2026-09-30T143012Z.zip");
    expect(name).not.toContain(":");
    expect(name).not.toContain("qqxcpesbwfxzgytkdsac");
  });

  it("ist vom Business-Export unterscheidbar und von .gitignore erfasst", () => {
    expect(platformArchiveFileName(new Date()).startsWith("skyisles-platform-backup-")).toBe(true);
    // Wenn dieser Test rot wird, könnte eine echte Sicherung im Repo landen.
    expect(readFileSync(".gitignore", "utf8")).toContain("skyisles-platform-backup-");
  });
});
