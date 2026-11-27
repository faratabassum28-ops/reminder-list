import mongoose from "mongoose";

// Sales FMS keeps its data in its OWN database, separate from the Reminder List's, so the collections ("leads", "configs", ...) can
// never collide with the other apps:
//  - SALESFMS_MONGO_URI set -> that connection string (use this to keep the data of your existing standalone Sales FMS; nothing is copied)
//  - otherwise                -> database SALESFMS_DB_NAME (default "mysoul_salesfms") on the same cluster as the hub.
let conn = null;
export function db() {
  if (!conn) {
    conn = process.env.SALESFMS_MONGO_URI
      ? mongoose.createConnection(process.env.SALESFMS_MONGO_URI, { serverSelectionTimeoutMS: 10_000 })
      : mongoose.connection.useDb(process.env.SALESFMS_DB_NAME || "mysoul_salesfms", { useCache: true });
  }
  return conn;
}
