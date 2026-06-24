export function isPrivateChatType(chatType: string | undefined): boolean {
  // Telegram always sets chat.type for message updates. Treat missing chat type
  // as allowed so non-message updates do not become accidental false denials.
  return chatType === undefined || chatType === "private";
}
