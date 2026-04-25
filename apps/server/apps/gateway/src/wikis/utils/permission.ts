import { ForbiddenException } from '@nestjs/common';

export type WikiPermissionLevel = 'read' | 'propose' | 'write';

const ORDER: Record<WikiPermissionLevel, number> = {
  read: 0,
  propose: 1,
  write: 2,
};

interface WikiPerms {
  humanPermission: WikiPermissionLevel;
  agentPermission: WikiPermissionLevel;
}

interface ActingUser {
  id: string;
  isAgent: boolean;
}

export function resolveWikiPermission(
  wiki: WikiPerms,
  user: ActingUser,
): WikiPermissionLevel {
  return user.isAgent ? wiki.agentPermission : wiki.humanPermission;
}

export function requirePermission(
  wiki: WikiPerms,
  user: ActingUser,
  required: WikiPermissionLevel,
): void {
  const actual = resolveWikiPermission(wiki, user);
  if (ORDER[actual] < ORDER[required]) {
    throw new ForbiddenException(
      `Wiki permission '${required}' required (you have '${actual}')`,
    );
  }
}
