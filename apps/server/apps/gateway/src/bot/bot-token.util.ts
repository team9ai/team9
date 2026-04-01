export const BOT_TOKEN_PREFIX = 't9bot_';
export const BOT_TOKEN_HEX_LENGTH = 96;
export const BOT_TOKEN_PATTERN = new RegExp(
  `^${BOT_TOKEN_PREFIX}[a-f0-9]{${BOT_TOKEN_HEX_LENGTH}}$`,
);

export function isValidBotTokenFormat(token: string): boolean {
  return BOT_TOKEN_PATTERN.test(token);
}

export function extractBotTokenHex(token: string): string | null {
  if (!isValidBotTokenFormat(token)) {
    return null;
  }

  return token.slice(BOT_TOKEN_PREFIX.length);
}
