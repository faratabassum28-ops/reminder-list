// One-off fix: bring every student on a fixed-EMI program (SUPER = 10, as in the PMS) to exactly that many EMIs.
//
//   cd backend
//   node emi/src/scripts/normalize-emis.js            # DRY RUN: prints + writes emi-normalize-report.csv, changes nothing
//   node emi/src/scripts/normalize-emis.js --apply    # does it (each student's old plan is kept in their plan history + activity log)
//
// Paid / part-paid EMIs are never touched. The untouched EMIs keep the same combined amount and are re-split equally over the
// remaining slots (rupee remainder on the last EMI), one month apart, starting from the first untouched EMI's due date.
// Students it cannot fix safely (e.g. already fully paid in 6 EMIs) are listed as MANUAL and left alone.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const { User, Program, Batch, Student, Enrollment, Instalment, Payment } = require('../models');
const money = require('../services/money');
const E = require('../lib/emi');

const APPLY = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/reminder_list');
  await require('../db').emi().asPromise();

  const admin = await User.findOne({ role: 'Admin', active: { $ne: false } });
  if (APPLY && !admin) throw new Error('No active EMI admin found to record the change under');

  const rows = [['program', 'batch', 'student', 'phone', 'emis_before', 'paid_or_part_paid', 'result', 'new_emi_count', 'balance_left', 'detail']];
  const tally = { already: 0, fix: 0, manual: 0, failed: 0 };

  for (const program of await Program.find({}).lean()) {
    const fixed = E.fixedEmiCount(program);
    if (!fixed) continue;
    for (const batch of await Batch.find({ program: program._id }).lean()) {
      for (const enr of await Enrollment.find({ batch: batch._id }).lean()) {
        if (['Dropped', 'Refunded'].includes(enr.manual_status)) continue;
        const student = await Student.findById(enr.student).lean();
        const insts = await Instalment.find({ enrollment: enr._id, type: 'EMI' }).lean();
        const touched = new Set((await Payment.distinct('allocations.instalment', { enrollment: enr._id })).map(String));
        const plan = E.planFixedEmis(insts.map((i) => ({ ...i, id: String(i._id) })), fixed, touched);
        const base = [program.code, batch.batch_name, student ? student.full_name : '?', student ? student.phone : '', plan.count, plan.locked ?? ''];
        tally[plan.status]++;
        if (plan.status === 'already') continue;
        if (plan.status === 'manual') { rows.push([...base, 'MANUAL', plan.count, plan.balance_left ?? '', plan.reason]); continue; }
        const detail = plan.emis.map((e) => `${e.amount_due}@${e.due_date}`).join(' | ');
        if (!APPLY) { rows.push([...base, 'WOULD FIX', fixed, '', detail]); continue; }
        try {
          await money.restructurePlan(admin, enr._id, plan.emis, `Standardised to the ${fixed}-EMI plan used in the PMS (was ${plan.count} EMIs)`);
          rows.push([...base, 'FIXED', fixed, '', detail]);
        } catch (e) { tally.failed++; tally.fix--; rows.push([...base, 'FAILED', plan.count, '', e.message]); }
      }
    }
  }

  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  fs.writeFileSync('emi-normalize-report.csv', csv + '\n');
  console.log(APPLY ? 'APPLIED' : 'DRY RUN (nothing changed; re-run with --apply)');
  console.log(`already on the fixed plan: ${tally.already} | ${APPLY ? 'fixed' : 'to fix'}: ${tally.fix} | need manual review: ${tally.manual} | failed: ${tally.failed}`);
  console.log('Report written to emi-normalize-report.csv');
  await require('../db').emi().close();
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
