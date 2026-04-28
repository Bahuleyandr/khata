import { config } from "../config.js";

export const DASHBOARD_CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

export function dashboardCorsOptions() {
  return {
    origin: config.allowedOrigins,
    credentials: true,
    methods: [...DASHBOARD_CORS_METHODS],
  };
}
