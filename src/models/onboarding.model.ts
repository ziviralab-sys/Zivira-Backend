import mongoose, { Schema } from "mongoose";

// Zivira_HR_Client_Requirement_1B.docx "complete employee journey":
// ADD EMPLOYEE -> GENERATE ONBOARDING -> TRIGGER MAIL -> EMPLOYEE LOGIN ->
// CREATE PASSWORD -> FILL ONBOARDING (8 steps) -> SUBMIT -> HR VERIFY.
// One record per employee. Section data is stored loosely (Mixed) since
// each section (Personal/Address/Education/Experience/Bank/Statutory) is
// a free-form sub-form the employee fills in — mirroring how the generic
// masters registry avoids one hand-written schema per form.
const documentSchema = new Schema(
  {
    name: { type: String, required: true }, // Aadhaar / PAN / Photo / Degree Certificate / Experience Letter / Bank Proof
    fileName: { type: String, default: null },
    status: { type: String, enum: ["PENDING", "UPLOADED", "VERIFIED", "REJECTED"], default: "PENDING" },
    rejectReason: { type: String, default: null }
  },
  { _id: false }
);

const onboardingSchema = new Schema(
  {
    tenantSlug: { type: String, required: true, lowercase: true, trim: true, index: true },
    onboardingId: { type: String, required: true }, // e.g. ONB202600125
    employeeCode: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["NOT_STARTED", "INITIATED", "EMAIL_SENT", "PASSWORD_CREATED", "IN_PROGRESS", "SUBMITTED", "COMPLETED"],
      default: "NOT_STARTED"
    },
    personal: { type: Schema.Types.Mixed, default: null },
    address: { type: Schema.Types.Mixed, default: null },
    education: { type: [Schema.Types.Mixed], default: [] },
    experience: { type: [Schema.Types.Mixed], default: [] },
    bank: { type: Schema.Types.Mixed, default: null },
    statutory: { type: Schema.Types.Mixed, default: null },
    documents: {
      type: [documentSchema],
      default: () => [
        { name: "Aadhaar" },
        { name: "PAN" },
        { name: "Photo" },
        { name: "Degree Certificate" },
        { name: "Experience Letter" },
        { name: "Bank Proof" }
      ]
    },
    submittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

onboardingSchema.index({ tenantSlug: 1, employeeCode: 1 }, { unique: true });

export const OnboardingModel = mongoose.model("Onboarding", onboardingSchema, "onboardings");
