import mongoose, { Schema } from "mongoose";

const hospitalSchema = new Schema(
  {
    tenantSlug: { type: String, required: true, lowercase: true, trim: true, index: true },
    hospitalCode: { type: String, required: true, trim: true },
    hospitalName: { type: String, required: true, trim: true },
    type: { type: String, enum: ["Private", "Government", "Trust", "Other"], default: "Private" },
    city: { type: String, trim: true, default: null },
    medicalRepresentative: { type: String, trim: true, default: null },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true }
  },
  { timestamps: true }
);

hospitalSchema.index({ tenantSlug: 1, hospitalCode: 1 }, { unique: true });

export const HospitalModel = mongoose.model("Hospital", hospitalSchema, "hospitals");
