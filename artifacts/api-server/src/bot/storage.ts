import fs from "fs";
import path from "path";

export interface TicketEntry {
  userId: string;
  username: string;
  categoryId: string;
  guildId: string;
  channelId: string;
  createdAt: string;
  ticketNumber: number;
  claimedBy?: string;
  claimedById?: string;
}

interface BotData {
  tickets: Record<string, TicketEntry>;
  ticketCounter: number;
  farmDescription: string;
  farmList: string;
  categoryMessages: Record<string, string>;
  ticketPanelTitle: string;
  ticketPanelDesc: string;
}

const DATA_FILE = path.resolve(process.cwd(), "bot-data.json");

function defaultData(): BotData {
  return {
    tickets: {},
    ticketCounter: 0,
    farmDescription:
      "Buy Farms – For users interested in purchasing a farm. Use this ticket for farm availability, pricing, purchase inquiries, or any questions related to buying a farm.",
    farmList: "available farms:\n\n(No farms currently listed. Check back soon!)",
    categoryMessages: {},
    ticketPanelTitle: "🎫 Support Tickets",
    ticketPanelDesc:
      "Need help or have a question? Click one of the buttons below to open a ticket. Our staff will assist you as soon as possible.",
  };
}

function loadData(): BotData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return { ...defaultData(), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
    }
  } catch {}
  return defaultData();
}

function saveData(data: BotData): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let _data = loadData();

export const storage = {
  getData: () => _data,

  nextTicketNumber(): number {
    _data.ticketCounter = (_data.ticketCounter ?? 0) + 1;
    saveData(_data);
    return _data.ticketCounter;
  },

  addTicket(channelId: string, ticket: TicketEntry) {
    _data.tickets[channelId] = ticket;
    saveData(_data);
  },

  removeTicket(channelId: string) {
    delete _data.tickets[channelId];
    saveData(_data);
  },

  claimTicket(channelId: string, username: string, userId: string) {
    if (_data.tickets[channelId]) {
      _data.tickets[channelId]!.claimedBy = username;
      _data.tickets[channelId]!.claimedById = userId;
      saveData(_data);
    }
  },

  getTicket(channelId: string): TicketEntry | undefined {
    return _data.tickets[channelId];
  },

  getTicketsByGuild(guildId: string): (TicketEntry & { channelId: string })[] {
    return Object.entries(_data.tickets)
      .filter(([, t]) => t.guildId === guildId)
      .map(([channelId, t]) => ({ ...t, channelId }));
  },

  hasOpenTicket(userId: string, categoryId: string, guildId: string): string | null {
    const entry = Object.entries(_data.tickets).find(
      ([, t]) => t.userId === userId && t.categoryId === categoryId && t.guildId === guildId,
    );
    return entry ? entry[0] : null;
  },

  updateFarmDescription(desc: string) {
    _data.farmDescription = desc;
    saveData(_data);
  },

  updateFarmList(list: string) {
    _data.farmList = list;
    saveData(_data);
  },

  setCategoryMessage(categoryId: string, message: string) {
    _data.categoryMessages[categoryId] = message;
    saveData(_data);
  },

  getCategoryMessage(categoryId: string): string | undefined {
    return _data.categoryMessages[categoryId];
  },

  updatePanelText(title: string, desc: string) {
    _data.ticketPanelTitle = title;
    _data.ticketPanelDesc = desc;
    saveData(_data);
  },
};
