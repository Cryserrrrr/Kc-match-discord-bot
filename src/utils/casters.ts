interface Caster {
  name: string;
  twitchLink: string;
  leagues: string[];
}

const casters: Caster[] = [
  {
    name: "Kameto",
    twitchLink: "https://www.twitch.tv/kamet0",
    leagues: ["LEC", "VCT"],
  },
  {
    name: "Slipix",
    twitchLink: "https://www.twitch.tv/slipix",
    leagues: ["LFL"],
  },
  {
    name: "Bibou",
    twitchLink: "https://www.twitch.tv/bibou_lol",
    leagues: ["LFL Division 2", "Nexus League"],
  },
  {
    name: "Fatih",
    twitchLink: "https://www.twitch.tv/fatiiiih",
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

// Biggest league of each game: its caster is used when a league has no caster
const MAIN_LEAGUE_BY_TEAM_ID: Record<string, string> = {
  // League of Legends: KC, KCB, KCBS
  "134078": "LEC",
  "128268": "LEC",
  "136080": "LEC",
  // Valorant: KC, KCGC, KCBS
  "130922": "VCT",
  "132777": "VCT",
  "136165": "VCT",
  // Rocket League
  "129570": "RLCS",
};

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

  // No caster for this league: use the caster of the game's biggest league
  const mainLeague = kcId ? MAIN_LEAGUE_BY_TEAM_ID[kcId] : undefined;
  if (mainLeague) {
    return (
      casters.find((c) =>
        c.leagues.some((l) => l.toLowerCase() === mainLeague.toLowerCase())
      ) || null
    );
  }
  return null;
}

export function getStreamingUrl(
  leagueName: string,
  kcId?: string
): string | null {
  const caster = getCasterForLeague(leagueName, kcId);
  return caster ? caster.twitchLink : null;
}
export { casters };
