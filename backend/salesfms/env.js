// Secrets this app reads. In the hub several apps share one server, so each app first looks for its own prefixed name.
export const env = {
  razorpaySecret: () => process.env.SALESFMS_RAZORPAY_WEBHOOK_SECRET,
  intakeSecret: () => process.env.SALESFMS_INTAKE_SECRET,
  // AiSensy account: one key for the whole company is the normal case (SALESFMS_AISENSY_API_KEY overrides it for this app only)
  aisensyKey: () => process.env.SALESFMS_AISENSY_API_KEY || process.env.AISENSY_API_KEY,
};
