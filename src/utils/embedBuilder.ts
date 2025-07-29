import { EmbedBuilder } from "discord.js";

export interface MatchData {
  kcTeam: string;
  kcId: string;
  opponent: string;
  opponentImage?: string;
  tournamentName: string;
  leagueName: string;
  leagueImage?: string;
  serieName: string;
  numberOfGames: number;
  beginAt: Date;
}

export async function createMatchEmbed(
  match: MatchData
): Promise<EmbedBuilder> {
  const matchTime = new Date(match.beginAt);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Format the date
  let dateString: string;
  const matchDate = matchTime.toDateString();
  const todayDate = today.toDateString();
  const tomorrowDate = tomorrow.toDateString();

  if (matchDate === todayDate) {
    dateString = "Aujourd'hui";
  } else if (matchDate === tomorrowDate) {
    dateString = "Demain";
  } else {
    dateString = matchTime.toLocaleString("fr-FR", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  const timeString = matchTime.toLocaleString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });

  // Determine color based on team name
  const embedColor = getEmbedColor(match.kcId);

  // KC logo URL
  const kcLogoUrl =
    "https://cdn.pandascore.co/images/team/image/136165/karmine_corplogo_square.png";

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`⚔️ ${match.kcTeam} VS ${match.opponent} ⚔️`)
    .addFields([
      { name: "Date", value: dateString, inline: true },
      { name: "Heure", value: timeString, inline: true },
      { name: "Tournoi", value: match.tournamentName, inline: true },
      {
        name: "Games",
        value: `Bo${match.numberOfGames.toString()}`,
        inline: true,
      },
    ])
    .setTimestamp()
    .setFooter({ text: "Karmine Corp Match Bot" })
    .setThumbnail(match.leagueImage || kcLogoUrl);

  return embed;
}

function getEmbedColor(kcId: string): number {
  // League of Legends teams
  if (kcId === "136165" || kcId === "128268" || kcId === "136080") {
    return 0x1e90ff; // Dodger Blue for LoL
  }

  // Valorant teams
  if (kcId === "130922" || kcId === "132777" || kcId === "136165") {
    return 0xff4655; // Valorant Red
  }

  // Rocket League teams
  if (kcId === "129570") {
    return 0xffa500; // Orange for Rocket League
  }

  // Default color for unknown teams
  return 0x00ff00; // Green
}

export function createErrorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("❌ Erreur")
    .setDescription(message)
    .setTimestamp()
    .setFooter({ text: "Karmine Corp Bot" });
}

export function createSuccessEmbed(
  title: string,
  message: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`✅ ${title}`)
    .setDescription(message)
    .setTimestamp()
    .setFooter({ text: "Karmine Corp Bot" });
}

export function createInfoEmbed(title: string, message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`ℹ️ ${title}`)
    .setDescription(message)
    .setTimestamp()
    .setFooter({ text: "Karmine Corp Bot" });
}
