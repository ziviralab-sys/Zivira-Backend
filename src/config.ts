import dotenv from "dotenv";

dotenv.config();

const defaultCorsOrigins = [
  "http://localhost:3001",
  "http://localhost:3002",
  "https://zivira-labs-admin.vercel.app",
  "https://zivira-labs-super-admin.vercel.app",
  "https://zivira-labs-field-repo.vercel.app",
  "https://zivira-labs-manager.vercel.app"
];

const configuredCorsOrigins = (process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const vercelPreviewOriginPattern = /^https:\/\/zivira-labs-(admin|super-admin|field-repo|manager)(-[a-z0-9-]+)?\.vercel\.app$/;

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/zivira-labs",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-replace-this-secret",
  corsOrigins: Array.from(new Set([...defaultCorsOrigins, ...configuredCorsOrigins])),
  isCorsOriginAllowed(origin: string) {
    return this.corsOrigins.includes(origin) || vercelPreviewOriginPattern.test(origin);
  }
};
