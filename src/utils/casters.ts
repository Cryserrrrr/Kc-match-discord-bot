interface Caster {
  name: string;
  twitchLink: string;
  leagues: string[];
}

const casters: Caster[] = [
  {
    name: "Kameto",
    twitchLink: "https://www.twitch.tv/kamet0",
    leagues: ["LEC", "LFL", "VCT"],
  },
  {
    name: "Slipix",
    twitchLink: "https://www.twitch.tv/slipix",
    leagues: ["LFL Division 2"],
  },
  {
    name: "Fugu",
    twitchLink: "https://www.twitch.tv/fugu_fps",
    leagues: ["VCL"],
  },
  {
    name: "Helydia",
    twitchLink: "https://www.twitch.tv/helydia",
    leagues: ["GC", "Game Changers"],
  },
  {
    name: "Kenny",
    twitchLink: "https://www.twitch.tv/kennystream",
    leagues: ["RL", "RLCS", "Rocket League"],
  },
  {
    name: "Fatih",
    twitchLink: "https://www.twitch.tv/fatiiiih",
    leagues: ["TFT"],
  },
];

const ROCKET_LEAGUE_TEAM_ID = "129570";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getCasterForLeague(
  leagueName: string,
  kcId?: string
): Caster | null {
  // Keywords must match whole words ("RL" must not match "World"), and the
  // most specific keyword wins ("LFL Division 2" beats "LFL").
  let best: { caster: Caster; length: number } | null = null;
  for (const caster of casters) {
    for (const league of caster.leagues) {
      const pattern = new RegExp(
        `(^|[^a-z0-9])${escapeRegExp(league)}($|[^a-z0-9])`,
        "i"
      );
      if (pattern.test(leagueName) && (!best || league.length > best.length)) {
        best = { caster, length: league.length };
      }
    }
  }
  if (best) return best.caster;

  // Unknown league name for the Rocket League roster: fall back to its caster
  if (kcId === ROCKET_LEAGUE_TEAM_ID) {
    return casters.find((c) => c.leagues.includes("RL")) || null;
  }
  return null;
}

export function getStreamingUrl(leagueName: string): string | null {
  const caster = getCasterForLeague(leagueName);
  return caster ? caster.twitchLink : null;
}
export { casters };
