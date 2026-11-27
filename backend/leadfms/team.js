import { makeTeam } from "../utils/fmsTeam.js";

// The people of Lead FMS = the hub accounts that have this app (see ../utils/fmsTeam.js).
export const Team = makeTeam({ app: "leadfms", nameField: "leadFmsName", roleField: "leadFmsRole" });
