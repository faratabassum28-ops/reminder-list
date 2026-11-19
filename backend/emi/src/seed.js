// Usage (from backend/):  npm run seed:emi            -> SUPER + RGM programs, adjustment list, default settings
//                         npm run seed:emi -- --demo  -> additionally creates a demo batch with sample students
// Safe to re-run: it only adds what is missing. People are NOT created here any more: sign in on the hub and tick EMI Manager
// on the Users page (hub admins are EMI admins). Uses MONGO_URI (the hub) and EMI_MONGO_URI / EMI_DB_NAME, like the server.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { User, Program, Batch, AdjustmentType, Setting } = require('./models');
const { DEFAULTS } = require('./services/settings');
const { todayIST, addDays } = require('./lib/dates');
const E = require('./lib/emi');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/reminder_list');
  await require('./db').emi().asPromise();
  for (const M of Object.values(require('./models'))) await M.createIndexes();

  // The demo needs "someone" to record the payments: the first EMI admin, or a switched-off placeholder.
  let admin = await User.findOne({ role: 'Admin' });
  if (!admin && process.argv.includes('--demo')) admin = await User.create({ name: 'Demo admin', email: 'demo-admin@example.invalid', password_hash: await bcrypt.hash('x'.repeat(24), 4), role: 'Admin', active: false });

  // Ticket sizes come from the spec; application/commitment defaults are left at 0 (an open question in the spec).
  for (const p of [{ code: 'SUPER', name: 'SUPER', default_fee: 250000 }, { code: 'RGM', name: 'RGM (Reiki Grand Master L4/L5)', default_fee: 120000 }]) {
    await Program.updateOne({ code: p.code }, { $setOnInsert: { ...p, max_emis: 12 } }, { upsert: true });
  }
  const super_ = await Program.findOne({ code: 'SUPER' });
  // Only Tarot L1 (10,000) and Reiki L1+L2 (6,999) amounts are given in the spec; set the others in Settings.
  const types = [['Tarot L1', 10000], ['Reiki L1+L2', 6999], ['Tarot L2', 0], ['Reiki L3', 0], ['Numerology L1', 0]];
  for (const [name, amt] of types) {
    await AdjustmentType.updateOne({ name }, { $setOnInsert: { name, default_amount: amt, active: true, target_programs: [super_._id] } }, { upsert: true });
  }
  await Setting.updateOne({ key: 'main' }, { $setOnInsert: { key: 'main', ...DEFAULTS } }, { upsert: true });
  console.log('Programs, adjustment list and settings are in place.');

  if (process.argv.includes('--demo')) await demo(admin, super_);
  await require('./db').emi().close();
  await mongoose.disconnect();
}

async function demo(admin, program) {
  const money = require('./services/money');
  if (await Batch.exists({ code: 'SUPER-B01' })) return console.log('Demo batch already exists, skipping.');
  const batch = await Batch.create({ code: 'SUPER-B01', program: program._id, batch_name: 'Demo Batch - Oct 2026', status: 'Running', owner: admin._id });
  const today = todayIST();
  // [name, first EMI offset in days from today, EMIs paid, partial amount on next]
  const people = [
    ['Asha Verma', -150, 6, 0], ['Rohan Mehta', -65, 2, 0], ['Priya Nair', -40, 1, 0],
    ['Karan Shah', -75, 2, 0], ['Meera Iyer', -35, 1, 10000], ['Vikram Rao', -5, 0, 0], ['Sana Khan', 12, 0, 0],
  ];
  let n = 0;
  for (const [name, offset, paidCount, partial] of people) {
    const total = 250000, adj = [{ name: 'Tarot L1', amount: 10000 }, { name: 'Reiki L1+L2', amount: 6999 }];
    const fees = E.computeFees({ total_fee: total, adjustments: adj, application_fee: 10000, commitment_fee: 40000 });
    const emis = E.autoSplit(fees.balance_due, 6, addDays(today, offset));
    // dates must be ascending and a paid EMI must be in the past for the demo to make sense
    const emi_paid = emis.map((e, i) => (i < paidCount ? e.amount_due : i === paidCount && partial ? partial : 0));
    await money.createEnrollment(admin, {
      batch: batch._id, student: { full_name: name, phone: `+9198000${String(10000 + n++)}`, email: `${name.split(' ')[0].toLowerCase()}@example.com` },
      adjustments: adj, application: { amount: 10000, date: addDays(today, offset - 20) }, commitment: { amount: 40000, date: addDays(today, offset - 10) },
      enrollment_date: addDays(today, offset - 20), emis, emi_paid, total_fee: total,
    }, { imported: true });
  }
  console.log(`Demo batch created with ${people.length} students.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
