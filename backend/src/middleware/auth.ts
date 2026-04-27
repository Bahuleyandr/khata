import { config } from "../config.js";

export function isAllowedUser(userId: number): boolean {
  return config.allowedTelegramUserIds.includes(userId);
}
