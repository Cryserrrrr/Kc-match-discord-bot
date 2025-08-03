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
    leagues: ["GC"],
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
  return (
    casters.find((caster) =>
      caster.leagues.some((league) =>
        leagueName.toLowerCase().includes(league.toLowerCase())
      )
    ) || null
  );
}

export function getStreamingUrl(leagueName: string): string | null {
  const caster = getCasterForLeague(leagueName);
  return caster ? caster.twitchLink : null;
}
export { casters };
