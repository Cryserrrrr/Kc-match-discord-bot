import axios from "axios";
import { logger } from "../utils/logger";

// Karmine Corp team IDs by game
const TEAM_IDS = {
  LOL: {
    KC: "134078",
    KCB: "128268",
    KCBS: "136080",
  },
  VAL: {
    KC: "130922",
    KCGC: "132777",
    KCBS: "136165",
  },
  RL: {
    KC: "129570",
  },
};

export interface PandaScoreMatch {
  id: number;
  name: string;
  scheduled_at: string;
  end_at: string | null;
  game: {
    name: string;
  };
  opponents: Array<{
    opponent: {
      id: number;
      name: string;
      acronym: string;
      image_url: string;
    };
  }>;
  league: {
    name: string;
    image_url: string;
  };
  serie: {
    full_name: string;
  };
  tournament: {
    name: string;
  };
  number_of_games: number;
  tournament_id: number;
}

export class PandaScoreService {
  private baseURL = "https://api.pandascore.co";
  private token: string;

  constructor() {
    this.token = process.env.PANDASCORE_TOKEN || "";
    if (!this.token) {
      throw new Error("PandaScore token is required");
    }
  }

  private async makeRequest(endpoint: string, params?: any): Promise<any> {
    try {
      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        params,
      });
      return response.data;
    } catch (error) {
      logger.error(`PandaScore API error for endpoint ${endpoint}:`, error);
      throw error;
    }
  }

  async getKarmineCorpMatches(date: string): Promise<PandaScoreMatch[]> {
    // Get all KC team IDs
    const kcTeamIds = [
      TEAM_IDS.LOL.KC,
      TEAM_IDS.LOL.KCB,
      TEAM_IDS.LOL.KCBS,
      TEAM_IDS.VAL.KC,
      TEAM_IDS.VAL.KCGC,
      TEAM_IDS.VAL.KCBS,
      TEAM_IDS.RL.KC,
    ];

    try {
      // Fetch upcoming matches for all KC teams
      const matches = await this.makeRequest("/matches/upcoming", {
        "filter[opponent_id]": kcTeamIds.join(","),
        sort: "begin_at",
        per_page: 100,
        page: 1,
      });

      // Filter matches to only include those with Karmine Corp teams
      const karmineMatches = matches.filter((match: PandaScoreMatch) =>
        match.opponents.some((opponent) =>
          kcTeamIds.includes(opponent.opponent.id.toString())
        )
      );

      logger.info(
        `Found ${karmineMatches.length} Karmine Corp matches for today`
      );
      return karmineMatches;
    } catch (error) {
      logger.error("Error fetching Karmine Corp matches:", error);
      return [];
    }
  }

  getGameName(gameName: string): string {
    const gameMap: { [key: string]: string } = {
      "League of Legends": "lol",
      Valorant: "valorant",
      "Rocket League": "rocket_league",
    };
    return gameMap[gameName] || gameName.toLowerCase().replace(" ", "_");
  }

  getKcTeamAndId(match: PandaScoreMatch): { kcTeam: string; kcId: number } {
    const kcTeamIds = [
      TEAM_IDS.LOL.KC,
      TEAM_IDS.LOL.KCB,
      TEAM_IDS.LOL.KCBS,
      TEAM_IDS.VAL.KC,
      TEAM_IDS.VAL.KCGC,
      TEAM_IDS.VAL.KCBS,
      TEAM_IDS.RL.KC,
    ];

    // Find the KC team in the match
    const kcTeam = match.opponents.find((opponent) =>
      kcTeamIds.includes(opponent.opponent.id.toString())
    );

    return {
      kcTeam: kcTeam?.opponent.name || "Karmine Corp",
      kcId: kcTeam?.opponent.id || 0,
    };
  }

  getOpponentNameAndImage(match: PandaScoreMatch): {
    opponentName: string;
    opponentImage: string;
  } {
    const kcTeamIds = [
      TEAM_IDS.LOL.KC,
      TEAM_IDS.LOL.KCB,
      TEAM_IDS.LOL.KCBS,
      TEAM_IDS.VAL.KC,
      TEAM_IDS.VAL.KCGC,
      TEAM_IDS.VAL.KCBS,
      TEAM_IDS.RL.KC,
    ];

    // Find the opponent that is NOT a KC team
    const opponent = match.opponents.find(
      (opponent) => !kcTeamIds.includes(opponent.opponent.id.toString())
    );

    return {
      opponentName: opponent?.opponent.name || "Unknown Team",
      opponentImage: opponent?.opponent.image_url || "",
    };
  }

  async getMatchById(matchId: number): Promise<PandaScoreMatch> {
    return await this.makeRequest(`/matches/${matchId}`);
  }
}
