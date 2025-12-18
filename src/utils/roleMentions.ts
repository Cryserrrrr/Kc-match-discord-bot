export function formatRoleMentions(roleIds: string[]): string {
  if (!roleIds || roleIds.length === 0) {
    return "";
  }
  return roleIds
    .map((roleId: string) => {
      if (roleId === "everyone") return "@everyone";
      if (roleId === "here") return "@here";
      return `<@&${roleId}>`;
    })
    .join(" ");
}

export function formatSingleRoleMention(roleId: string | null): string {
  if (!roleId) {
    return "";
  }
  if (roleId === "everyone") return "@everyone";
  if (roleId === "here") return "@here";
  return `<@&${roleId}>`;
}
