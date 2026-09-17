import { Client, EmbedBuilder } from "discord.js";
import { prisma } from "../db";
import { logger } from "./logger";

const CHECK_INTERVAL_MS = 2 * 60 * 1000;
// DMs closed (50007) or unknown user (10013): the notification is cancelled, never retried
const PERMANENT_DM_ERRORS = new Set([50007, 10013]);

const STATUS_TEXT: Record<string, string> = {
  OPEN: "🟡 Ouvert",
  IN_PROGRESS: "🔵 En cours",
  RESOLVED: "🟢 Résolu",
  CLOSED: "⚫ Fermé",
};

type PendingTicket = {
  id: string;
  userId: string;
  type: string;
  status: string;
  description: string | null;
  answer: string;
};

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max - 3) + "..." : text;
}

function buildAnswerEmbed(ticket: PendingTicket, isUpdate: boolean) {
  return new EmbedBuilder()
    .setColor(0x00bcd4)
    .setTitle(
      `📬 ${isUpdate ? "Réponse mise à jour" : "Réponse"} à votre ticket #${ticket.id.slice(-8)}`
    )
    .addFields(
      {
        name: "Type",
        value: ticket.type === "BUG" ? "🐛 Bug" : "💡 Amélioration",
        inline: true,
      },
      {
        name: "Statut",
        value: STATUS_TEXT[ticket.status] || ticket.status,
        inline: true,
      },
      {
        name: "Votre demande",
        value: truncate(ticket.description || "Aucune description", 1024),
      },
      { name: "Réponse du support", value: truncate(ticket.answer, 1024) }
    )
    .setFooter({ text: "Retrouvez tous vos tickets avec /mytickets" })
    .setTimestamp();
}

/**
 * Sends a DM for every ticket whose answer changed since the last DM.
 * The answer is written by the web interface; the bot only compares it with
 * `notifiedAnswer`, so it works whatever tool updates the ticket.
 */
export async function notifyTicketAnswers(client: Client) {
  const pending = await prisma.$queryRaw<
    Array<PendingTicket & { notifiedAnswer: string | null }>
  >`
    SELECT "id", "userId", "type"::text AS "type", "status"::text AS "status",
           "description", "answer", "notifiedAnswer"
    FROM "tickets"
    WHERE "notifyOnAnswer" = true
      AND "answer" IS NOT NULL
      AND btrim("answer") <> ''
      AND "answer" IS DISTINCT FROM "notifiedAnswer"
    ORDER BY "updatedAt" ASC
    LIMIT 25
  `;

  for (const ticket of pending) {
    try {
      const user = await client.users.fetch(ticket.userId);
      await user.send({
        embeds: [buildAnswerEmbed(ticket, ticket.notifiedAnswer !== null)],
      });
      logger.info(`Sent ticket answer DM for ticket ${ticket.id}`);
    } catch (error: any) {
      if (!PERMANENT_DM_ERRORS.has(error?.code)) {
        // Transient failure (network, rate limit): retry on next check
        logger.warn(`Could not DM ticket answer for ${ticket.id}, will retry:`, error);
        continue;
      }
      logger.warn(
        `User ${ticket.userId} has DMs closed, answer notification cancelled for ticket ${ticket.id}`
      );
    }

    // Record the exact answer handled; if it was edited meanwhile, the next check sends the new one
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { notifiedAnswer: ticket.answer },
    });
  }
}

export function startTicketAnswerNotifier(client: Client) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await notifyTicketAnswers(client);
    } catch (error) {
      logger.error("Error checking ticket answers:", error);
    } finally {
      running = false;
    }
  };
  run();
  return setInterval(run, CHECK_INTERVAL_MS);
}
