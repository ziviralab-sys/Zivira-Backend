import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { signToken } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { UserModel } from "../models/user.model.js";

const loginSchema = z.object({
  username: z.string().min(2).transform((value) => value.toLowerCase()),
  password: z.string().min(6),
  portal: z.enum(["SUPER_ADMIN", "COMPANY_ADMIN", "FIELD_FORCE"])
});

export const authRouter = Router();

authRouter.post("/login", asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body);
  const user = await UserModel.findOne({ username: body.username, portal: body.portal, active: true });

  if (!user) {
    throw new HttpError(401, "Invalid credentials");
  }

  const valid = await bcrypt.compare(body.password, user.passwordHash);

  if (!valid) {
    throw new HttpError(401, "Invalid credentials");
  }

  const token = signToken({
    sub: String(user._id),
    role: user.role,
    portal: user.portal,
    ...(user.tenantSlug ? { tenantSlug: user.tenantSlug } : {})
  });

  res.json({
    data: {
      token,
      user: {
        id: String(user._id),
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        portal: user.portal,
        tenantSlug: user.tenantSlug
      }
    }
  });
}));
