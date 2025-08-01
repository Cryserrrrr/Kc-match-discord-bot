import axios from "axios";
import { logger } from "../utils/logger";

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
        timeout: 30000,
      });
      return response.data;
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        logger.error(`PandaScore API timeout for endpoint ${endpoint}`);
        throw new Error(
          `Timeout lors de la requête vers PandaScore: ${endpoint}`
        );
      } else if (error.response) {
        logger.error(`PandaScore API error for endpoint ${endpoint}:`, {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
        });
        throw new Error(
          `Erreur API PandaScore (${error.response.status}): ${error.response.statusText}`
        );
      } else if (error.request) {
        logger.error(
          `PandaScore API network error for endpoint ${endpoint}:`,
          error.message
        );
        throw new Error(
          `Erreur réseau lors de la requête vers PandaScore: ${error.message}`
        );
      } else {
        logger.error(`PandaScore API error for endpoint ${endpoint}:`, error);
        throw new Error(
          `Erreur inattendue lors de la requête vers PandaScore: ${error.message}`
        );
      }
    }
  }

  async getKarmineCorpMatches(date: string): Promise<PandaScoreMatch[]> {
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
      logger.info(`Fetching matches for KC teams: ${kcTeamIds.join(", ")}`);

      const matches = await this.makeRequest("/matches/upcoming", {
        "filter[opponent_id]": kcTeamIds.join(","),
        sort: "begin_at",
        per_page: 100,
        page: 1,
      });

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
      throw error;
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

    const opponent = match.opponents.find(
      (opponent) => !kcTeamIds.includes(opponent.opponent.id.toString())
    );

    return {
      opponentName: opponent?.opponent.name || "Unknown Team",
      opponentImage: opponent?.opponent.image_url || "",
    };
  }

  async getMatchById(matchId: number): Promise<PandaScoreMatch> {
    try {
      return await this.makeRequest(`/matches/${matchId}`);
    } catch (error) {
      logger.error(`Error fetching match by ID ${matchId}:`, error);
      throw error;
    }
  }
}
