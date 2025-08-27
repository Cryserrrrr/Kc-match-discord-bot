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
    has_bracket: boolean;
    id: number;
  };
  number_of_games: number;
  tournament_id: number;
  status?: string;
  results?: Array<{
    score: number;
    team_id: number;
  }>;
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

  async getKarmineCorpMatches(): Promise<PandaScoreMatch[]> {
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
        `Found ${karmineMatches.length} upcoming Karmine Corp matches`
      );
      return karmineMatches;
    } catch (error) {
      logger.error("Error fetching Karmine Corp matches:", error);
      throw error;
    }
  }

  async getKarmineCorpLiveMatches(): Promise<PandaScoreMatch[]> {
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
      const matches = await this.makeRequest("/matches/running", {
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

      logger.info(`Found ${karmineMatches.length} live Karmine Corp matches`);
      return karmineMatches;
    } catch (error) {
      logger.error("Error fetching live Karmine Corp matches:", error);
      throw error;
    }
  }

  async getKarmineCorpPastMatches(): Promise<PandaScoreMatch[]> {
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
      const matches = await this.makeRequest("/matches/past", {
        "filter[opponent_id]": kcTeamIds.join(","),
        sort: "-begin_at",
        per_page: 100,
        page: 1,
      });

      const karmineMatches = matches.filter((match: PandaScoreMatch) =>
        match.opponents.some((opponent) =>
          kcTeamIds.includes(opponent.opponent.id.toString())
        )
      );

      logger.info(`Found ${karmineMatches.length} past Karmine Corp matches`);
      return karmineMatches;
    } catch (error) {
      logger.error("Error fetching past Karmine Corp matches:", error);
      throw error;
    }
  }

  getMatchScore(match: PandaScoreMatch): string | null {
    if (!match.results || match.results.length < 2) {
      return null;
    }

    const kcTeamIds = [
      TEAM_IDS.LOL.KC,
      TEAM_IDS.LOL.KCB,
      TEAM_IDS.LOL.KCBS,
      TEAM_IDS.VAL.KC,
      TEAM_IDS.VAL.KCGC,
      TEAM_IDS.VAL.KCBS,
      TEAM_IDS.RL.KC,
    ];

    const kcResult = match.results.find((result) =>
      kcTeamIds.includes(result.team_id.toString())
    );
    const opponentResult = match.results.find(
      (result) => !kcTeamIds.includes(result.team_id.toString())
    );

    if (kcResult && opponentResult) {
      return `${kcResult.score}-${opponentResult.score}`;
    }

    return null;
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

  async getMatch(matchId: string): Promise<any> {
    try {
      const match = await this.getMatchById(parseInt(matchId));

      const { kcTeam, kcId } = this.getKcTeamAndId(match);
      const { opponentName, opponentImage } =
        this.getOpponentNameAndImage(match);

      return {
        kcTeam,
        kcId: kcId.toString(),
        opponent: opponentName,
        opponentImage,
        leagueName: match.league.name,
        leagueImage: match.league.image_url,
        serieName: match.serie.full_name,
        tournamentName: match.tournament.name,
        tournamentId: match.tournament.id.toString(),
        hasBracket: match.tournament.has_bracket,
        numberOfGames: match.number_of_games,
        beginAt: new Date(match.scheduled_at),
      };
    } catch (error) {
      logger.error(`Error fetching match ${matchId}:`, error);
      return null;
    }
  }

  async getTournamentStandings(tournamentId: string): Promise<any> {
    try {
      return await this.makeRequest(`/tournaments/${tournamentId}/standings`);
    } catch (error) {
      logger.error(
        `Error fetching tournament standings for ${tournamentId}:`,
        error
      );
      throw error;
    }
  }

  async getTournamentBrackets(tournamentId: string): Promise<any> {
    try {
      return await this.makeRequest(`/tournaments/${tournamentId}/brackets`);
    } catch (error) {
      logger.error(
        `Error fetching tournament brackets for ${tournamentId}:`,
        error
      );
      throw error;
    }
  }
}
