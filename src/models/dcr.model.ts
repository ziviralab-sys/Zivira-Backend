import mongoose, { Schema } from "mongoose";

const sampleSchema = new Schema(
  { productName: { type: String, required: true }, qty: { type: Number, required: true, default: 0 } },
  { _id: false }
);

const inputSchema = new Schema(
  { inputName: { type: String, required: true }, qty: { type: Number, required: true, default: 0 } },
  { _id: false }
);

const dcrSchema = new Schema(
  {
    tenantSlug:      { type: String, required: true, lowercase: true, trim: true, index: true },
    employeeCode:    { type: String, required: true, trim: true, index: true },
    doctorId:        { type: Schema.Types.ObjectId, ref: "Doctor" },
    visitDate:       { type: Date, required: true, index: true },
    productsDetailed: [{ type: String }],
    notes:           { type: String },
    // ── New fields ──────────────────────────────────────────────────
    callSession:     { type: String, enum: ["MORNING", "AFTERNOON", "EVENING"], default: "MORNING" },
    callTime:        { type: String },                  // e.g. "10:30"
    samplesGiven:    { type: [sampleSchema], default: [] },
    inputsGiven:     { type: [inputSchema],  default: [] },
    jointWork: {
      accompanyingManager: { type: String },
      jointWorkType:       { type: String, enum: ["FIELD_WORK", "ON_JOB_TRAINING", "PERFORMANCE_REVIEW"], default: "FIELD_WORK" },
      managerObservations: { type: String }
    },
    // ── Workflow ─────────────────────────────────────────────────────
    status:          { type: String, enum: ["DRAFT", "SUBMITTED", "MANAGER_APPROVED", "APPROVED", "REJECTED"], default: "SUBMITTED", index: true },
    managerApprovedBy:   { type: String },
    managerApprovedAt:   { type: Date },
    adminVisibleAt:      { type: Date }
  },
  { timestamps: true }
);

dcrSchema.pre("save", function (next) {
  if (this.isNew && !this.adminVisibleAt) {
    this.adminVisibleAt = new Date();
  }
  next();
});

export const DcrModel = mongoose.model("Dcr", dcrSchema);
