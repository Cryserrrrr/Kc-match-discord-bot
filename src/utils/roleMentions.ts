export function formatRoleMentions(pingRoles: string[]): string {
  if (!pingRoles || pingRoles.length === 0) {
    return "";
  }

  const roleMentions = pingRoles
    .map((roleId: string) => {
      if (roleId === "everyone") return "@everyone";
      if (roleId === "here") return "@here";
      return `<@&${roleId}>`;
    })
    .join(" ");

  return roleMentions;
}
