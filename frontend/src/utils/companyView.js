// Who sees the company-wide Team Performance on the hub: Nitin (company manager) and Fara. Nobody else.
// The server enforces the same list (backend/routes/company.js); this only decides whether to show the section.
export const COMPANY_VIEWERS = ["fara.tabassum09@gmail.com", "nitin@mysoulschool.in"];
export const canViewCompany = (user) => !!user && COMPANY_VIEWERS.includes(String(user.email || "").trim().toLowerCase());
