export const teamIdToName: Record<string, string> = {
  "134078": "KC (LEC)",
  "128268": "KCB (LFL)",
  "136080": "KCBS (LFL2)",
  "130922": "KC Valorant",
  "132777": "KCGC Valorant",
  "136165": "KCBS Valorant",
  "129570": "KC Rocket League",
};

export function getTeamDisplayName(teamId: string): string {
  return teamIdToName[teamId] || teamId;
}
