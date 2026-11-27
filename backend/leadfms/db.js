import mongoose from "mongoose";

// Lead FMS keeps its data in its OWN database, separate from the Reminder List's, so the collections ("leads", "configs", ...) can
// never collide with the other apps:
//  - LEADFMS_MONGO_URI set -> that connection string (use this to keep the data of your existing standalone Lead FMS; nothing is copied)
//  - otherwise                -> database LEADFMS_DB_NAME (default "mysoul_leadfms") on the same cluster as the hub.
let conn = null;
export function db() {
  if (!conn) {
    conn = process.env.LEADFMS_MONGO_URI
      ? mongoose.createConnection(process.env.LEADFMS_MONGO_URI, { serverSelectionTimeoutMS: 10_000 })
      : mongoose.connection.useDb(process.env.LEADFMS_DB_NAME || "mysoul_leadfms", { useCache: true });
  }
  return conn;
}
