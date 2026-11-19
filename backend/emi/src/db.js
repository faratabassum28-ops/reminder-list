// EMI Manager keeps its data on its OWN connection, separate from the Reminder List's, so nothing can collide:
//  - EMI_MONGO_URI set  -> that connection string. Put the old EMI Manager's MONGODB_URI here to KEEP all its data:
//                          students, enrolments, instalments, payments, proofs, activity, backups settings (collections emi_*).
//  - otherwise          -> database EMI_DB_NAME (default "mysoul_emi") on the same cluster as the hub (starts empty).
const mongoose = require('mongoose');

let conn = null;
function emi() {
  if (!conn) {
    if (process.env.EMI_MONGO_URI) {
      conn = mongoose.createConnection(process.env.EMI_MONGO_URI, { serverSelectionTimeoutMS: 15000 });
      conn.asPromise().catch((e) => console.error('[emi] could not connect to EMI_MONGO_URI:', e.message));
    } else {
      conn = mongoose.connection.useDb(process.env.EMI_DB_NAME || 'mysoul_emi', { useCache: true });
    }
    conn.on('error', (e) => console.error('[emi] database error:', e.message));
  }
  return conn;
}
module.exports = { emi };
