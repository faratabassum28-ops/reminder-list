// One-time (and safe to repeat) copy of an existing STANDALONE Certificate Studio database into this hub's database.
//
//   cd backend
//   npm run migrate:certificates -- --from "mongodb+srv://USER:PASS@host/certificate-generator" --dry-run
//   npm run migrate:certificates -- --from "mongodb+srv://USER:PASS@host/certificate-generator"
//
// (or put the old connection string in CERT_OLD_MONGODB_URI). The hub's own MONGO_URI is the destination.
//
// What is copied, keeping every id so references stay valid: templates, their images (GridFS), issued certificates
// and change requests. People are NOT copied: the hub's Users page is the single list of accounts. Old users are matched to
// hub users by e-mail so "issued by" / "requested by" keep pointing at the right person; anyone without a hub account
// is listed at the end (add them on the hub's Users page and tick Certificate Studio). Existing documents are never overwritten,
// so running it twice is harmless.
import "dotenv/config";
import mongoose from "mongoose";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
};
const DRY = process.argv.includes("--dry-run");
const OLD_URI = arg("from") || process.env.CERT_OLD_MONGODB_URI;
const NEW_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";

const same = (a, b) => a.replace(/\/\/[^@]*@/, "//").split("?")[0] === b.replace(/\/\/[^@]*@/, "//").split("?")[0];
function preflight() {
  if (!OLD_URI || OLD_URI === true) {
    console.error('Give the OLD Certificate Studio connection string: --from "mongodb+srv://..." (or set CERT_OLD_MONGODB_URI).');
    process.exit(1);
  }
  if (same(OLD_URI, NEW_URI)) {
    console.error("The old and the new database are the same one. Nothing to migrate.");
    process.exit(1);
  }
}

const BATCH = 200;

// Pure helper (also what the tests exercise): old person -> hub person, matched by e-mail.
export function makeUserMapper(oldUsers, hubUsers) {
  const hubByEmail = new Map(hubUsers.map((u) => [String(u.email || "").toLowerCase(), u]));
  const oldById = new Map(oldUsers.map((u) => [String(u._id), u]));
  const unmatched = new Map();
  const mapPerson = (p) => {
    if (!p || !p.id) return p;
    const old = oldById.get(String(p.id));
    const hub = old && hubByEmail.get(String(old.email || "").toLowerCase());
    if (hub) return { id: String(hub._id), name: hub.name || p.name };
    if (old) unmatched.set(String(old.email).toLowerCase(), old.name);
    return p; // keep as written: history stays readable
  };
  return { mapPerson, unmatched };
}

async function copyDocs(src, dst, name, transform, report) {
  let copied = 0, skipped = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    if (!DRY) {
      const ops = batch.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $setOnInsert: d }, upsert: true } }));
      const r = await dst.collection(name.to).bulkWrite(ops, { ordered: false });
      copied += r.upsertedCount; skipped += batch.length - r.upsertedCount;
    } else {
      const ids = batch.map((d) => d._id);
      const have = await dst.collection(name.to).countDocuments({ _id: { $in: ids } });
      copied += batch.length - have; skipped += have;
    }
    batch = [];
  };
  for await (const doc of src.collection(name.from).find({})) {
    batch.push(transform ? transform(doc) : doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  report.push(`${name.from.padEnd(18)} -> ${name.to.padEnd(22)} copied ${copied}, already there ${skipped}`);
}

async function copyImages(src, dst, report) {
  let files = 0, have = 0, chunks = 0, missing = 0;
  for await (const f of src.collection("certimages.files").find({})) {
    if (await dst.collection("certimages.files").countDocuments({ _id: f._id })) { have++; continue; }
    files++;
    if (DRY) continue;
    // chunks first, the file record last: an interrupted run leaves no half-copied image that looks complete
    const cur = src.collection("certimages.chunks").find({ files_id: f._id }).sort({ n: 1 });
    let any = false;
    let buf = [];
    for await (const c of cur) {
      any = true; buf.push(c); chunks++;
      if (buf.length >= 20) { await dst.collection("certimages.chunks").insertMany(buf, { ordered: false }).catch(ignoreDup); buf = []; }
    }
    if (buf.length) await dst.collection("certimages.chunks").insertMany(buf, { ordered: false }).catch(ignoreDup);
    if (!any && f.length > 0) { missing++; continue; }
    await dst.collection("certimages.files").insertOne(f);
  }
  report.push(`certimages (GridFS)  copied ${files - missing} image(s) (${chunks} chunks), already there ${have}${missing ? `, ${missing} had no data` : ""}`);
}
const ignoreDup = (e) => { if (e.code !== 11000 && !(e.writeErrors || []).every((w) => w.code === 11000)) throw e; };

async function main() {
  preflight();
  console.log(DRY ? "DRY RUN: nothing will be written.\n" : "Copying…\n");
  const oldConn = await mongoose.createConnection(OLD_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
  await mongoose.connect(NEW_URI, { serverSelectionTimeoutMS: 15000 });
  const src = oldConn.db, dst = mongoose.connection.db;

  const names = new Set((await src.listCollections().toArray()).map((c) => c.name));
  if (!names.has("templates") && !names.has("certificates")) {
    console.error(`Found no Certificate Studio data in "${src.databaseName}" (expected the "templates" and "certificates" collections). Check the connection string includes the database name.`);
    process.exit(1);
  }

  const oldUsers = names.has("users") ? await src.collection("users").find({}).toArray() : [];
  const hubUsers = await dst.collection("users").find({}, { projection: { email: 1, name: 1 } }).toArray();
  const { mapPerson, unmatched } = makeUserMapper(oldUsers, hubUsers);

  const report = [];
  if (names.has("templates")) {
    // Template IDs (CS-0001…) are unique labels. If the hub already has templates, an old one may clash: it gets the next free number.
    const existing = await dst.collection("cert_templates").find({}, { projection: { code: 1 } }).toArray();
    const have = new Set(existing.map((t) => String(t._id)));
    const taken = new Set(existing.map((t) => t.code).filter(Boolean));
    let maxN = [...taken].reduce((m, c) => Math.max(m, parseInt(String(c).replace("CS-", ""), 10) || 0), 0);
    const renumbered = [];
    const fixCode = (t) => {
      if (!t.code || have.has(String(t._id))) return t;
      if (!taken.has(t.code)) { taken.add(t.code); return t; }
      const code = `CS-${String(++maxN).padStart(4, "0")}`;
      taken.add(code);
      renumbered.push(`${t.name}: ${t.code} -> ${code}`);
      return { ...t, code };
    };
    await copyDocs(src, dst, { from: "templates", to: "cert_templates" }, fixCode, report);
    if (renumbered.length) report.push(`  renumbered (their old ID was already used here): ${renumbered.join("; ")}`);
  }
  if (names.has("certimages.files")) await copyImages(src, dst, report);
  if (names.has("certificates")) await copyDocs(src, dst, { from: "certificates", to: "cert_issued" }, (d) => ({ ...d, issuedBy: mapPerson(d.issuedBy) }), report);
  if (names.has("changerequests")) {
    await copyDocs(src, dst, { from: "changerequests", to: "cert_change_requests" }, (d) => ({ ...d, requestedBy: mapPerson(d.requestedBy), decidedBy: d.decidedBy ? mapPerson(d.decidedBy) : d.decidedBy }), report);
  }
  console.log(report.join("\n"));

  if (unmatched.size) {
    console.log("\nThese people had accounts in the old Certificate Studio but no hub account with the same e-mail:");
    for (const [email, name] of unmatched) console.log(`  - ${name} <${email}>`);
    console.log('Add them on the hub\'s Users page and tick "Certificate Studio" for them. Their old history is kept as written.');
  }
  console.log(`\n${DRY ? "Dry run finished. Run again without --dry-run to copy." : "Done."} Open the hub > Certificate Studio to check.`);
  await oldConn.close();
  await mongoose.disconnect();
}

// Run only when executed directly (so the helper above can be imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error("Migration failed:", e.message); process.exit(1); });
}
