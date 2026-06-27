export const OWNER_ID = "1491457883219693720";

export const BUILD_TICKET_ROLE_ID = "1518626190813040752";
export const TICKET_LOG_CHANNEL_ID = "1475866995470893087";

export const BOT_COLOR = 0x5865f2;
export const SUCCESS_COLOR = 0x57f287;
export const ERROR_COLOR = 0xed4245;
export const WARNING_COLOR = 0xfee75c;
export const GOLD_COLOR = 0xf1c40f;

export interface TicketCategory {
  id: string;
  label: string;
  emoji: string;
  description: string;
  color: number;
  channelPrefix: string;
  discordCategoryName: string;
}

export const TICKET_CATEGORIES: TicketCategory[] = [
  {
    id: "support",
    label: "Support",
    emoji: "🛠️",
    description:
      "**Support** – For users who need help with server features, commands, roles, bots, or general issues. This ticket should be used when you encounter technical problems or require assistance from staff members.",
    color: 0x5865f2,
    channelPrefix: "support",
    discordCategoryName: "🛠️ Support Tickets",
  },
  {
    id: "reports",
    label: "Reports",
    emoji: "🚨",
    description:
      "**Reports** – Use this ticket to report rule violations, suspicious activity, harassment, scam attempts, or any other unacceptable behavior. Please provide clear evidence such as screenshots, usernames, and timestamps whenever possible.",
    color: 0xed4245,
    channelPrefix: "report",
    discordCategoryName: "🚨 Report Tickets",
  },
  {
    id: "giveaway",
    label: "Giveaway",
    emoji: "🎉",
    description:
      "**Giveaway** – If you have won a giveaway, please create a ticket to claim your prize. Make sure to provide proof of your win when opening the ticket.",
    color: 0xfee75c,
    channelPrefix: "giveaway",
    discordCategoryName: "🎉 Giveaway Tickets",
  },
  {
    id: "skellys",
    label: "Buy/Sell Skellys",
    emoji: "💀",
    description:
      "**Buy/Sell Skellys** – For users looking to buy or sell Skelly Spawners. This ticket should be used for all Skelly-related transactions, questions, or payment issues involving Skelly Spawners.",
    color: 0x9b59b6,
    channelPrefix: "skellys",
    discordCategoryName: "💀 Skelly Tickets",
  },
  {
    id: "purchases",
    label: "Purchases/Payments",
    emoji: "💳",
    description:
      "**Purchases/Payments** – For purchase questions, payment issues, donation inquiries, reward claims, transaction status, perks, or anything not covered under Support, Reports, Giveaway, Buy/Sell Skellys, or Buy Farms.",
    color: 0x2ecc71,
    channelPrefix: "purchase",
    discordCategoryName: "💳 Purchase Tickets",
  },
  {
    id: "buy-farms",
    label: "Buy Farms",
    emoji: "🌾",
    description:
      "**Buy Farms** – For users interested in purchasing a farm. Use this ticket for farm availability, pricing, purchase inquiries, or any questions related to buying a farm.",
    color: 0xe67e22,
    channelPrefix: "farm",
    discordCategoryName: "🌾 Farm Tickets",
  },
];
