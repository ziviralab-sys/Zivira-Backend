import mongoose, { Schema } from "mongoose";

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true },
    role: {
      type: String,
      // Must stay in sync with EmployeeModel's role enum (NBH/BH/RBM/ZBM/ABM/
      // SR_MR/MR) plus the two portal-owner roles. Missing roles here caused
      // login-account creation to fail silently for RBM/SR_MR/BH/ZBM
      // employees — PRD 8.1 requires ABM AND RBM to both work as managers.
      enum: ["SUPER_ADMIN", "COMPANY_ADMIN", "NBH", "BH", "RBM", "ZBM", "ABM", "SR_MR", "MR"],
      required: true,
      index: true
    },
    portal: {
      type: String,
      enum: ["SUPER_ADMIN", "COMPANY_ADMIN", "FIELD_FORCE"],
      required: true,
      index: true
    },
    tenantSlug: { type: String, lowercase: true, trim: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("User", userSchema);
