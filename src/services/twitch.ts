import axios from "axios";
import { logger } from "../utils/logger";

export interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
  tag_ids: string[];
  is_mature: boolean;
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  type: string;
  broadcaster_type: string;
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  view_count: number;
  created_at: string;
}

export class TwitchService {
  private baseURL = "https://api.twitch.tv/helix";
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.clientId = process.env.TWITCH_CLIENT_ID || "";
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET || "";

    if (!this.clientId || !this.clientSecret) {
      throw new Error("Twitch credentials are required");
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(
        "https://id.twitch.tv/oauth2/token",
        null,
        {
          params: {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: "client_credentials",
          },
          timeout: 10000,
        }
      );

      const accessToken: string = response.data.access_token;
      if (!accessToken || typeof accessToken !== "string") {
        throw new Error("No access token received from Twitch");
      }

      this.accessToken = accessToken;
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiresAt = Date.now() + (expiresIn - 300) * 1000;

      logger.info("Twitch access token obtained");
      return this.accessToken;
    } catch (error: any) {
      logger.error("Error getting Twitch access token:", error);
      throw new Error("Failed to get Twitch access token");
    }
  }

  private async makeRequest(endpoint: string, params?: any): Promise<any> {
    try {
      const token = await this.getAccessToken();
      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        headers: {
          "Client-ID": this.clientId,
          Authorization: `Bearer ${token}`,
        },
        params,
        timeout: 30000,
      });
      return response.data;
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        logger.error(`Twitch API timeout for endpoint ${endpoint}`);
        throw new Error(`Timeout lors de la requête vers Twitch: ${endpoint}`);
      } else if (error.response) {
        logger.error(`Twitch API error for endpoint ${endpoint}:`, {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
        });
        throw new Error(
          `Erreur API Twitch (${error.response.status}): ${error.response.statusText}`
        );
      } else if (error.request) {
        logger.error(
          `Twitch API network error for endpoint ${endpoint}:`,
          error.message
        );
        throw new Error(
          `Erreur réseau lors de la requête vers Twitch: ${error.message}`
        );
      } else {
        logger.error(`Twitch API error for endpoint ${endpoint}:`, error);
        throw new Error(
          `Erreur inattendue lors de la requête vers Twitch: ${error.message}`
        );
      }
    }
  }

  async getUsersByLogin(logins: string[]): Promise<TwitchUser[]> {
    try {
      if (logins.length === 0) return [];

      const users: TwitchUser[] = [];
      const batchSize = 100;

      for (let i = 0; i < logins.length; i += batchSize) {
        const batch = logins.slice(i, i + batchSize);
        const data = await this.makeRequest("/users", {
          login: batch,
        });
        users.push(...(data.data || []));
      }

      return users;
    } catch (error) {
      logger.error("Error fetching Twitch users:", error);
      throw error;
    }
  }

  async getStreamsByUserIds(userIds: string[]): Promise<TwitchStream[]> {
    try {
      if (userIds.length === 0) return [];

      const streams: TwitchStream[] = [];
      const batchSize = 100;

      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        const data = await this.makeRequest("/streams", {
          user_id: batch,
        });
        streams.push(...(data.data || []));
      }

      return streams;
    } catch (error) {
      logger.error("Error fetching Twitch streams:", error);
      throw error;
    }
  }

  async getStreamsByUserLogins(logins: string[]): Promise<TwitchStream[]> {
    try {
      const users = await this.getUsersByLogin(logins);
      const userIds = users.map((user) => user.id);
      return await this.getStreamsByUserIds(userIds);
    } catch (error) {
      logger.error("Error fetching streams by logins:", error);
      throw error;
    }
  }

  getStreamThumbnailUrl(
    thumbnailUrl: string,
    width: number = 640,
    height: number = 360
  ): string {
    return thumbnailUrl
      .replace("{width}", width.toString())
      .replace("{height}", height.toString());
  }
}


