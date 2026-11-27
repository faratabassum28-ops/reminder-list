import { makeTeam } from "../utils/fmsTeam.js";

// The people of Sales FMS = the hub accounts that have this app (see ../utils/fmsTeam.js).
export const Team = makeTeam({ app: "salesfms", nameField: "salesFmsName", roleField: "salesFmsRole" });
