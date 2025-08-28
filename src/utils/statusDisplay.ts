export const BetStatusLabel: Record<string, string> = {
  ACTIVE: "Actif",
  WON: "Gagné",
  LOST: "Perdu",
  CANCELLED: "Annulé ",
};

export const DuelStatusLabel: Record<string, string> = {
  PENDING: "En attente",
  ACCEPTED: "Accepté",
  RESOLVED: "Résolu",
  CANCELLED: "Annulé",
};

export function formatBetStatus(status: string): string {
  return BetStatusLabel[status] || status;
}

export function formatDuelStatus(status: string): string {
  return DuelStatusLabel[status] || status;
}

export function formatParlayStatus(status: string): string {
  // Parlays share BetStatus values
  return BetStatusLabel[status] || status;
}
