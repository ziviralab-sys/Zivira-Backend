import mongoose, { Schema } from "mongoose";

const doctorSchema = new Schema(
  {
    tenantSlug: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    specialty: { type: String, required: true, trim: true, index: true },
    category: { type: String, enum: ["A", "B", "C", "D"], default: "C", index: true },
    state: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    territory: { type: String, required: true, trim: true, index: true },
    mappedEmployeeCode: { type: String, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true }
  },
  { timestamps: true }
);

doctorSchema.index({ tenantSlug: 1, name: 1, city: 1, specialty: 1 });

export const DoctorModel = mongoose.model("Doctor", doctorSchema);
