import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { HttpError } from "./errors.js";

export type JwtPayload = {
  sub: string;
  role: string;
  portal: string;
  tenantSlug?: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export function signToken(payload: JwtPayload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "8h" });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return next(new HttpError(401, "Missing bearer token"));
  }

  try {
    req.auth = jwt.verify(header.slice("Bearer ".length), config.jwtSecret) as JwtPayload;
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.role !== "SUPER_ADMIN" || req.auth.portal !== "SUPER_ADMIN") {
    return next(new HttpError(403, "Super Admin access required"));
  }

  next();
}

export function requireCompanyAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.role !== "COMPANY_ADMIN" || req.auth.portal !== "COMPANY_ADMIN" || !req.auth.tenantSlug) {
    return next(new HttpError(403, "Company Admin access required"));
  }

  next();
}

export function requireFieldForce(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.role !== "MR" || req.auth.portal !== "FIELD_FORCE" || !req.auth.tenantSlug) {
    return next(new HttpError(403, "Field Force access required"));
  }

  next();
}

