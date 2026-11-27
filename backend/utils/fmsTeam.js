import User from "../models/User.js";
import { storedAppsOf, fmsRoleOf } from "./access.js";

// Lead FMS and Sales FMS used to keep their own login table. Inside the hub the people are the hub's accounts (Users page);
// this adapter shows them to the FMS code in the shape it already understands:
//   { _id, name, email, active, role: "admin" | "caller", leadName: <caller name, "" = use the account name>, hubAdmin }
// `app` is the app id ("leadfms" | "salesfms"); `nameField` / `roleField` are the User fields that hold the caller name and the role.
export function makeTeam({ app, nameField, roleField }) {
  const roleOf = (u) => fmsRoleOf(u, roleField);
  const shape = (u) => ({
    _id: u._id, name: u.name, email: u.email, active: u.active !== false,
    role: roleOf(u), leadName: String(u[nameField] || "").trim(), hubAdmin: u.role === "admin",
  });
  // Everybody who has the app ticked (hub admins always do), whether active or not.
  const everyone = async () => (await User.find().select("-passwordHash").sort({ name: 1 }).lean()).filter((u) => storedAppsOf(u).includes(app)).map(shape);
  const active = async () => (await everyone()).filter((u) => u.active);
  return {
    app, nameField, roleField, roleOf, shape, everyone, active,
    // active people who work leads (not admins)
    callers: async () => (await active()).filter((u) => u.role !== "admin"),
    // The signed-in hub account as the FMS routes see it: `leadAdmin` says if they run the app, `leadName` is their caller name.
    luOf: (user) => ({ ...user, role: roleOf(user), leadName: String(user?.[nameField] || "").trim(), leadAdmin: roleOf(user) === "admin" }),
    otherActiveAdmins: async (id) => (await active()).filter((u) => u.role === "admin" && String(u._id) !== String(id)).length,
  };
}
