import mongoose, { Schema } from "mongoose";

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true },
    role: {
      type: String,
      enum: ["SUPER_ADMIN", "COMPANY_ADMIN", "NBH", "ABM", "MR"],
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
