export const OWNER_ID = "1491457883219693720";
export const BUILD_TICKET_ROLE_ID = "1518626190813040752";
export const TICKET_LOG_CHANNEL_ID = "1475866995470893087";
export const TRANSCRIPT_CHANNEL_ID = "1450662194063867939";

export const MOD_ROLE_IDS = [
  "1450662192365047822",
  "1450662192365047823",
  "1450662192365047824",
  "1450662192365047825",
];

export const STAFF_ROLE_IDS = [
  "1520248946637930516",
];

export const BOT_COLOR = 0x5865f2;
export const SUCCESS_COLOR = 0x57f287;
export const ERROR_COLOR = 0xed4245;
export const WARNING_COLOR = 0xfee75c;
export const GOLD_COLOR = 0xf1c40f;

export interface TicketCategory {
  id: string;
  label: string;
  description: string;
  color: number;
  channelPrefix: string;
  discordCategoryName: string;
  isFarm?: boolean;
}

export const REGULAR_CATEGORIES: TicketCategory[] = [
  {
    id: "support",
    label: "Reports & Support",
    description:
      "For users who need help with server features, commands, roles, bots, or general issues. This ticket should be used when you encounter technical problems or require help from staff members. This also serves to document rule violations together with suspicious activities and harassment incidents and scam attempts and all other types of unacceptable behavior. Please provide clear evidence (screenshots, usernames, timestamps) when possible.",
    color: 0x5865f2,
    channelPrefix: "support",
    discordCategoryName: "Support Tickets",
  },
  {
    id: "giveaway",
    label: "Giveaway",
    description:
      "If you have won a giveaway, please create a ticket and you will be paid out. Make sure to provide proof of your win when opening the ticket.",
    color: 0x5865f2,
    channelPrefix: "giveaway",
    discordCategoryName: "Giveaway Tickets",
  },
  {
    id: "skellys",
    label: "Buy/Sell Skellys",
    description:
      "For purchase questions, payment issues, donation inquiries, reward claims, buying/selling Skelly Spawners, or anything not covered under Support or Reports. The system also allows users to ask questions about their items, perks, and the current status of their transactions.",
    color: 0x5865f2,
    channelPrefix: "skellys",
    discordCategoryName: "Skelly Tickets",
  },
];

export const FARM_CATEGORY: TicketCategory = {
  id: "buy-farms",
  label: "Buy Farms",
  description:
    "Buy Farms – For users interested in purchasing a farm. Use this ticket for farm availability, pricing, purchase inquiries, or any questions related to buying a farm.",
  color: SUCCESS_COLOR,
  channelPrefix: "farm",
  discordCategoryName: "Farm Tickets",
  isFarm: true,
};

export const ALL_CATEGORIES: TicketCategory[] = [...REGULAR_CATEGORIES, FARM_CATEGORY];
