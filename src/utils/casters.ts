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
    leagues: ["RL"],
  },
  {
    name: "Fatih",
    twitchLink: "https://www.twitch.tv/fatiiiih",
    leagues: ["TFT"],
  },
];

export function getCasterForLeague(leagueName: string): Caster | null {
  // The most specific keyword wins, so "LFL Division 2" matches Slipix
  // rather than the shorter "LFL" keyword.
  const name = leagueName.toLowerCase();
  let best: { caster: Caster; length: number } | null = null;
  for (const caster of casters) {
    for (const league of caster.leagues) {
      const keyword = league.toLowerCase();
      if (name.includes(keyword) && (!best || keyword.length > best.length)) {
        best = { caster, length: keyword.length };
      }
    }
  }
  return best ? best.caster : null;
}

export function getStreamingUrl(leagueName: string): string | null {
  const caster = getCasterForLeague(leagueName);
  return caster ? caster.twitchLink : null;
}
export { casters };
