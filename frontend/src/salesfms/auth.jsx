import { useAuth as useHubAuth } from "../context/AuthContext.jsx";

// Sales FMS used to have its own sign-in. Inside the hub the person is already signed in; this gives the app's screens the same
// shape they always used: who is signed in, whether they run the app (hub admin or "admin" role of this app) and their caller name.
export function useAuth() {
  const hub = useHubAuth();
  const user = hub.user;
  const admin = user?.role === "admin" || user?.salesFmsRole === "admin";
  return {
    user, loading: false, slow: false, logout: hub.logout, updateProfile: hub.updateProfile,
    appCount: [hub.hasReminder, hub.hasWorkshop, hub.hasTickets, hub.hasOrders, hub.hasCertificates, hub.hasEmi, hub.hasLeadFms, hub.hasSalesFms].filter(Boolean).length,
    isAdmin: admin, isLeadAdmin: admin, leadName: user?.salesFmsName || user?.name || "",
  };
}
