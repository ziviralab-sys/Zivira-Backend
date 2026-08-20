import mongoose, { Schema } from "mongoose";

// One row per employee per payroll month. Generated as DRAFT from the
// employee's latest ACTIVE salary structure plus attendance-derived LWP
// (Loss of Pay) days, then moves through HR_APPROVED -> LOCKED. Once
// LOCKED a row is treated as immutable (routes must refuse further edits).
const payrollRunSchema = new Schema(
  {
    tenantSlug: { type: String, required: true, lowercase: true, trim: true, index: true },
    employeeCode: { type: String, required: true, trim: true, index: true },
    month: { type: String, required: true, trim: true, index: true }, // "YYYY-MM"
    basic: { type: Number, required: true },
    hra: { type: Number, required: true },
    allowance: { type: Number, required: true },
    grossEarnings: { type: Number, required: true },
    workingDays: { type: Number, required: true },
    lwpDays: { type: Number, default: 0 },
    lwpDeduction: { type: Number, default: 0 },
    netPay: { type: Number, required: true },
    roundingRule: { type: String, default: "NEAREST_RUPEE" },
    status: { type: String, enum: ["DRAFT", "HR_APPROVED", "LOCKED"], default: "DRAFT", index: true },
    approvedBy: { type: String, trim: true, default: null },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

payrollRunSchema.index({ tenantSlug: 1, employeeCode: 1, month: 1 }, { unique: true });

export const PayrollRunModel = mongoose.model("PayrollRun", payrollRunSchema, "payroll_runs");
