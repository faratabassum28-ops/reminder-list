// Order Analytics keeps its data in its OWN database, separate from the Reminder List's, so nothing can collide:
//  - ORDERS_MONGO_URI set  -> that connection string (use this to keep the data of your existing Order Analytics deployment)
//  - otherwise             -> database ORDERS_DB_NAME (default "mysoul_orders") on the same cluster as the hub.
const mongoose = require('mongoose');
let conn = null;
function orders() {
  if (!conn) {
    conn = process.env.ORDERS_MONGO_URI
      ? mongoose.createConnection(process.env.ORDERS_MONGO_URI)
      : mongoose.connection.useDb(process.env.ORDERS_DB_NAME || 'mysoul_orders', { useCache: true });
  }
  return conn;
}
module.exports = { orders };
