import mongoose, { Schema } from "mongoose";

const employeeSchema = new Schema(
  {
    tenantSlug: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    employeeCode: { type: String, required: true, trim: true },
    designation: { type: String, required: true, trim: true },
    division: { type: String, required: true, trim: true },
    reportingManager: { type: String, trim: true },
    territory: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ["NBH", "BH", "RBM", "ZBM", "ABM", "SR_MR", "MR"],
      required: true,
      index: true
    },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true }
  },
  { timestamps: true }
);

employeeSchema.index({ tenantSlug: 1, employeeCode: 1 }, { unique: true });

export const EmployeeModel = mongoose.model("Employee", employeeSchema);
