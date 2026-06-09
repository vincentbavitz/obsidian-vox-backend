import "express";

declare module "express-serve-static-core" {
  interface Request {
    vaultId: string;
    apiKey: string | null;
  }
}
