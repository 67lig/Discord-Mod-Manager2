import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  AutoModerationRuleKeywordPresetType,
  AutoModerationActionType,
  AutoModerationRuleTriggerType,
  ChannelSelectMenuBuilder,
  AttachmentBuilder,
  type Interaction,
  type Guild,
  type GuildMember,
  type TextChannel,
  type CategoryChannel,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type ChatInputCommandInteraction,
  type ChannelSelectMenuInteraction,
} from "discord.js";

import { logger } from "../lib/logger.js";
import {
  OWNER_ID,
  REGULAR_CATEGORIES,
  FARM_CATEGORY,
  ALL_CATEGORIES,
  BOT_COLOR,
  SUCCESS_COLOR,
  ERROR_COLOR,
  WARNING_COLOR,
  GOLD_COLOR,
  BUILD_TICKET_ROLE_ID,
  TICKET_LOG_CHANNEL_ID,
  TRANSCRIPT_CHANNEL_ID,
} from "./config.js";
import { storage } from "./storage.js";

const TOKEN = process.env["DISCORD_BOT_TOKEN"];
if (!TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");

const FOOTER = { text: "Powered by tickets.bot" };

function ticketTag(n: number) {
  return `#${String(n).padStart(4, "0")}`;
}

export function createBotClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("ready", async () => {
    logger.info({ tag: client.user?.tag }, "Bot ready");
    await registerCommands(client);
    for (const guild of client.guilds.cache.values()) {
      await setupAutoMod(guild).catch((e) =>
        logger.warn({ err: e, guild: guild.name }, "AutoMod failed"),
      );
    }
  });

  client.on("guildCreate", async (guild) => {
    await setupAutoMod(guild).catch(() => {});
  });

  client.on("interactionCreate", (i) => {
    handleInteraction(i).catch((e) => logger.error({ err: e }, "Interaction error"));
  });

  client.login(TOKEN).catch((e) => logger.error({ err: e }, "Login failed"));
  return client;
}

async function registerCommands(client: Client) {
  if (!client.user) return;
  const rest = new REST().setToken(TOKEN!);
  const cmds = [
    new SlashCommandBuilder().setName("panel").setDescription("Owner control panel"),
    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close this ticket")
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false)),
    new SlashCommandBuilder()
      .setName("rename")
      .setDescription("Rename this ticket channel")
      .addStringOption((o) => o.setName("name").setDescription("New name").setRequired(true)),
    new SlashCommandBuilder()
      .setName("add")
      .setDescription("Add a user to this ticket")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder()
      .setName("remove")
      .setDescription("Remove a user from this ticket")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder().setName("tickets").setDescription("List active tickets (staff)"),
  ].map((c) => c.toJSON());

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
    for (const guild of client.guilds.cache.values()) {
      await rest
        .put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: cmds })
        .catch(() => {});
    }
    logger.info("Commands registered");
  } catch (e) {
    logger.error({ err: e }, "Command registration failed");
  }
}

async function setupAutoMod(guild: Guild) {
  const existing = await guild.autoModerationRules.fetch();
  if (!existing.some((r) => r.name === "Bot – Keyword Filter")) {
    await guild.autoModerationRules
      .create({
        name: "Bot – Keyword Filter",
        eventType: 1,
        triggerType: AutoModerationRuleTriggerType.Keyword,
        triggerMetadata: {
          keywordFilter: [],
          regexPatterns: [],
          presets: [
            AutoModerationRuleKeywordPresetType.Profanity,
            AutoModerationRuleKeywordPresetType.SexualContent,
            AutoModerationRuleKeywordPresetType.Slurs,
          ],
        },
        actions: [
          { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: "Your message was blocked." } },
        ],
        enabled: true,
        reason: "Bot AutoMod",
      })
      .catch(() => {});
  }
  if (!existing.some((r) => r.name === "Bot – Mention Spam")) {
    await guild.autoModerationRules
      .create({
        name: "Bot – Mention Spam",
        eventType: 1,
        triggerType: AutoModerationRuleTriggerType.MentionSpam,
        triggerMetadata: { mentionTotalLimit: 6, mentionRaidProtectionEnabled: true },
        actions: [
          { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: "Too many mentions." } },
        ],
        enabled: true,
        reason: "Bot AutoMod",
      })
      .catch(() => {});
  }
}

async function handleInteraction(i: Interaction) {
  if (i.isChatInputCommand()) return handleCommand(i);
  if (i.isButton()) return handleButton(i);
  if (i.isStringSelectMenu()) return handleStringSelect(i);
  if (i.isChannelSelectMenu()) return handleChannelSelect(i);
  if (i.isModalSubmit()) return handleModal(i);
}

function isOwner(id: string) { return id === OWNER_ID; }
function isStaff(m: GuildMember) {
  return isOwner(m.id) || m.permissions.has(PermissionFlagsBits.ManageChannels) || m.permissions.has(PermissionFlagsBits.Administrator);
}

async function logToChannel(guild: Guild, channelId: string, embed: EmbedBuilder) {
  const ch = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
}

async function closeTicket(
  guild: Guild,
  ticket: NonNullable<ReturnType<typeof storage.getTicket>>,
  channel: TextChannel,
  closedByTag: string,
  closedById: string,
  reason: string,
) {
  const cat = ALL_CATEGORIES.find((c) => c.id === ticket.categoryId);

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  let transcript = `Ticket Transcript — ${ticketTag(ticket.ticketNumber)}\n`;
  transcript += `Category: ${cat?.label ?? ticket.categoryId}\n`;
  transcript += `Opened by: ${ticket.username} (${ticket.userId})\n`;
  transcript += `Closed by: ${closedByTag}\n`;
  transcript += `Reason: ${reason}\n`;
  transcript += `Date: ${new Date().toUTCString()}\n`;
  transcript += `\n${"─".repeat(50)}\n\n`;
  if (messages) {
    for (const msg of [...messages.values()].reverse()) {
      if (msg.author.bot) continue;
      const ts = new Date(msg.createdTimestamp).toUTCString();
      transcript += `[${ts}] ${msg.author.username}: ${msg.content}`;
      if (msg.attachments.size > 0) transcript += ` [${msg.attachments.size} attachment(s)]`;
      transcript += "\n";
    }
  }

  const file = new AttachmentBuilder(Buffer.from(transcript, "utf8"), {
    name: `transcript-${ticketTag(ticket.ticketNumber)}.txt`,
  });

  const transcriptCh = guild.channels.cache.get(TRANSCRIPT_CHANNEL_ID) as TextChannel | undefined;
  const logCh = guild.channels.cache.get(TICKET_LOG_CHANNEL_ID) as TextChannel | undefined;

  const openedTs = Math.floor(new Date(ticket.createdAt).getTime() / 1000);

  const closeEmbed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle("Ticket Closed")
    .addFields(
      { name: "# Ticket ID",    value: `${ticket.ticketNumber}`,                              inline: true },
      { name: "✅ Opened By",   value: `<@${ticket.userId}>`,                                 inline: true },
      { name: "🔴 Closed By",  value: `<@${closedById}>`,                                    inline: true },
      { name: "⏰ Open Time",   value: `<t:${openedTs}:F>`,                                   inline: true },
      { name: "👤 Claimed By",  value: ticket.claimedById ? `<@${ticket.claimedById}>` : "Not claimed", inline: true },
      { name: "❓ Reason",      value: reason },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  let transcriptMsgUrl = "";
  if (transcriptCh) {
    const transcriptMsg = await transcriptCh
      .send({ embeds: [closeEmbed], files: [file] })
      .catch(() => null);
    if (transcriptMsg) {
      transcriptMsgUrl = `https://discord.com/channels/${guild.id}/${transcriptCh.id}/${transcriptMsg.id}`;
      const editRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`edit_reason_${guild.id}_${transcriptCh.id}_${transcriptMsg.id}`)
          .setLabel("Edit Reason")
          .setStyle(ButtonStyle.Secondary),
      );
      await transcriptMsg.edit({ components: [editRow] }).catch(() => {});
    }
  }

  const logEmbed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle("Ticket Closed")
    .addFields(
      { name: "# Ticket ID",   value: `${ticket.ticketNumber}`,                              inline: true },
      { name: "✅ Opened By",  value: `<@${ticket.userId}>`,                                 inline: true },
      { name: "🔴 Closed By", value: `<@${closedById}>`,                                    inline: true },
      { name: "⏰ Open Time",  value: `<t:${openedTs}:F>`,                                   inline: true },
      { name: "👤 Claimed By", value: ticket.claimedById ? `<@${ticket.claimedById}>` : "Not claimed", inline: true },
      { name: "❓ Reason",     value: reason },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  if (logCh) {
    const logButtons: ButtonBuilder[] = [];
    if (transcriptMsgUrl) {
      logButtons.push(
        new ButtonBuilder().setLabel("View Transcript").setStyle(ButtonStyle.Link).setURL(transcriptMsgUrl),
      );
    }
    const logRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...logButtons);
    await logCh
      .send({ embeds: [logEmbed], ...(logButtons.length > 0 ? { components: [logRow] } : {}) })
      .catch(() => {});
  }
}

async function handleCommand(i: ChatInputCommandInteraction) {
  const { commandName, user, channel, guild } = i;

  if (commandName === "panel") {
    if (!isOwner(user.id)) {
      await i.reply({ embeds: [errEmbed("You are not authorized.")], flags: 64 });
      return;
    }
    await i.reply({ embeds: [panelEmbed()], components: [panelRow()], flags: 64 });
    return;
  }

  if (commandName === "tickets") {
    if (!guild) return;
    const member = i.member as GuildMember;
    if (!isStaff(member)) { await i.reply({ embeds: [errEmbed("Staff only.")], flags: 64 }); return; }
    const list = storage.getTicketsByGuild(guild.id);
    const embed = new EmbedBuilder()
      .setColor(BOT_COLOR)
      .setTitle(`Active Tickets — ${list.length} open`)
      .setDescription(
        list.length === 0
          ? "No open tickets."
          : list.slice(0, 25).map((t) => {
              const cat = ALL_CATEGORIES.find((c) => c.id === t.categoryId);
              return `**${ticketTag(t.ticketNumber)}** <#${t.channelId}> — ${cat?.label ?? t.categoryId} — <@${t.userId}>`;
            }).join("\n"),
      )
      .setFooter(FOOTER)
      .setTimestamp();
    await i.reply({ embeds: [embed], flags: 64 });
    return;
  }

  if (commandName === "close") {
    if (!channel || !guild) return;
    const ticket = storage.getTicket(channel.id);
    if (!ticket) { await i.reply({ embeds: [errEmbed("Not a ticket channel.")], flags: 64 }); return; }
    const member = i.member as GuildMember;
    if (!isStaff(member) && ticket.userId !== user.id) {
      await i.reply({ embeds: [errEmbed("No permission to close this ticket.")], flags: 64 }); return;
    }
    const reason = i.options.getString("reason") ?? "No reason specified";
    await i.reply({ embeds: [infoEmbed("Closing ticket in 5 seconds. A transcript will be saved.")] });
    await closeTicket(guild, ticket, channel as TextChannel, user.username, user.id, reason);
    setTimeout(async () => {
      storage.removeTicket(channel.id);
      await (channel as TextChannel).delete("Ticket closed").catch(() => {});
    }, 5000);
    return;
  }

  if (commandName === "rename") {
    if (!channel || !guild) return;
    const ticket = storage.getTicket(channel.id);
    if (!ticket) { await i.reply({ embeds: [errEmbed("Not a ticket channel.")], flags: 64 }); return; }
    if (!isStaff(i.member as GuildMember)) { await i.reply({ embeds: [errEmbed("Staff only.")], flags: 64 }); return; }
    const newName = i.options.getString("name", true).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90);
    await (channel as TextChannel).setName(newName);
    await i.reply({ embeds: [okEmbed(`Channel renamed to **${newName}**`)] });
    return;
  }

  if (commandName === "add") {
    if (!channel || !guild) return;
    if (!storage.getTicket(channel.id)) { await i.reply({ embeds: [errEmbed("Not a ticket channel.")], flags: 64 }); return; }
    const target = i.options.getUser("user", true);
    await (channel as TextChannel).permissionOverwrites.edit(target.id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
    });
    await i.reply({ embeds: [okEmbed(`Added <@${target.id}> to this ticket.`)] });
    return;
  }

  if (commandName === "remove") {
    if (!channel || !guild) return;
    if (!storage.getTicket(channel.id)) { await i.reply({ embeds: [errEmbed("Not a ticket channel.")], flags: 64 }); return; }
    const target = i.options.getUser("user", true);
    await (channel as TextChannel).permissionOverwrites.delete(target.id);
    await i.reply({ embeds: [okEmbed(`Removed <@${target.id}> from this ticket.`)] });
    return;
  }
}

async function handleButton(i: ButtonInteraction) {
  const { customId, user, guild } = i;

  if (customId === "ticket_close") {
    if (!guild || !i.channel) return;
    const ticket = storage.getTicket(i.channel.id);
    if (!ticket) { await i.reply({ embeds: [errEmbed("Not a ticket channel.")], flags: 64 }); return; }
    const member = i.member as GuildMember;
    if (!isStaff(member) && ticket.userId !== user.id) {
      await i.reply({ embeds: [errEmbed("No permission.")], flags: 64 }); return;
    }
    await i.reply({ embeds: [infoEmbed("Closing ticket in 5 seconds. A transcript will be saved.")] });
    await closeTicket(guild, ticket, i.channel as TextChannel, user.username, user.id, "No reason specified");
    setTimeout(async () => {
      storage.removeTicket(i.channel!.id);
      await (i.channel as TextChannel).delete("Ticket closed").catch(() => {});
    }, 5000);
    return;
  }

  if (customId.startsWith("join_ticket_")) {
    const ticketChannelId = customId.slice("join_ticket_".length);
    if (!guild) return;
    const ticket = storage.getTicket(ticketChannelId);
    if (!ticket) { await i.reply({ embeds: [errEmbed("This ticket no longer exists.")], flags: 64 }); return; }
    const member = i.member as GuildMember;
    if (!isStaff(member)) { await i.reply({ embeds: [errEmbed("Staff only.")], flags: 64 }); return; }

    const ticketCh = guild.channels.cache.get(ticketChannelId) as TextChannel | undefined;
    if (!ticketCh) { await i.reply({ embeds: [errEmbed("Ticket channel not found.")], flags: 64 }); return; }

    const joined = storage.joinTicket(ticketChannelId, user.id);
    if (!joined) {
      await i.reply({ embeds: [errEmbed("You have already joined this ticket.")], flags: 64 }); return;
    }

    await ticketCh.permissionOverwrites.edit(user.id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true,
    }).catch(() => {});

    const updatedTicket = storage.getTicket(ticketChannelId);
    const staffCount = updatedTicket?.joinedStaff?.length ?? 1;

    const oldEmbed = i.message.embeds[0];
    if (oldEmbed) {
      const updatedEmbed = EmbedBuilder.from(oldEmbed);
      const fields = (updatedEmbed.data.fields ?? []).map((f) =>
        f.name === "👤 Staff In Ticket" ? { ...f, value: String(staffCount) } : f,
      );
      updatedEmbed.setFields(fields);
      await i.update({ embeds: [updatedEmbed], components: i.message.components as never }).catch(() => {});
    } else {
      await i.deferUpdate().catch(() => {});
    }

    await ticketCh.send({ embeds: [okEmbed(`<@${user.id}> has joined the ticket.`)] }).catch(() => {});
    return;
  }

  if (customId === "ticket_claim") {
    if (!guild || !i.channel) return;
    const ticket = storage.getTicket(i.channel.id);
    if (!ticket) { await i.reply({ embeds: [errEmbed("Not a ticket channel.")], flags: 64 }); return; }
    const member = i.member as GuildMember;
    if (!isStaff(member)) { await i.reply({ embeds: [errEmbed("Staff only.")], flags: 64 }); return; }
    if (ticket.claimedById) {
      await i.reply({ embeds: [errEmbed(`This ticket is already claimed by <@${ticket.claimedById}>.`)], flags: 64 }); return;
    }
    storage.claimTicket(i.channel.id, user.username, user.id);
    await i.reply({ embeds: [okEmbed(`Ticket claimed by <@${user.id}>.`)] });
    return;
  }

  if (customId.startsWith("edit_reason_")) {
    const [, , guildId, channelId, messageId] = customId.split("_");
    const modal = new ModalBuilder()
      .setCustomId(`mod_edit_reason_${guildId}_${channelId}_${messageId}`)
      .setTitle("Edit Close Reason");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("new_reason")
          .setLabel("New Reason")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
    await i.showModal(modal);
    return;
  }

  if (!isOwner(user.id)) {
    if (customId.startsWith("panel_") || customId.startsWith("t_") || customId.startsWith("f_")) {
      await i.reply({ embeds: [errEmbed("Not authorized.")], flags: 64 }); return;
    }
  }

  switch (customId) {
    case "panel_back":
      await i.update({ embeds: [panelEmbed()], components: [panelRow()] }); return;

    case "panel_server": {
      if (!guild) return;
      const g = await guild.fetch();
      await g.members.fetch().catch(() => {});
      const online = g.members.cache.filter((m) => m.presence?.status !== "offline" && !!m.presence?.status).size;
      const embed = new EmbedBuilder()
        .setColor(BOT_COLOR)
        .setTitle(`Server Monitor — ${g.name}`)
        .setThumbnail(g.iconURL())
        .addFields(
          { name: "Members", value: `${g.memberCount}`, inline: true },
          { name: "Online", value: `${online || "N/A"}`, inline: true },
          { name: "Channels", value: `${g.channels.cache.size}`, inline: true },
          { name: "Roles", value: `${g.roles.cache.size}`, inline: true },
          { name: "Boosts", value: `${g.premiumSubscriptionCount ?? 0} (Level ${g.premiumTier})`, inline: true },
          { name: "Open Tickets", value: `${storage.getTicketsByGuild(g.id).length}`, inline: true },
          { name: "Owner", value: `<@${g.ownerId}>`, inline: true },
          { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
        )
        .setFooter(FOOTER)
        .setTimestamp();
      await i.update({ embeds: [embed], components: [backRow("panel_back")] }); return;
    }

    case "panel_tickets": {
      const embed = new EmbedBuilder()
        .setColor(BOT_COLOR)
        .setTitle("Ticket Panel")
        .setDescription("Manage the ticket system. Send the ticket panel, edit category messages, or view active tickets.")
        .setFooter(FOOTER);
      await i.update({
        embeds: [embed],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("t_send").setLabel("Send Ticket Panel").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("t_edit").setLabel("Edit Messages").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("t_active").setLabel("Active Tickets").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("t_edit_text").setLabel("Edit Panel Text").setStyle(ButtonStyle.Secondary),
          ),
          backRow("panel_back"),
        ],
      }); return;
    }

    case "panel_farms": {
      const data = storage.getData();
      const embed = new EmbedBuilder()
        .setColor(GOLD_COLOR)
        .setTitle("Farm Panel")
        .addFields(
          { name: "Description", value: data.farmDescription.slice(0, 900) },
          { name: "Farm List", value: data.farmList.slice(0, 900) },
        )
        .setFooter(FOOTER);
      await i.update({
        embeds: [embed],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("f_send_panel").setLabel("Send Farm Ticket Panel").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("f_send_info").setLabel("Send Farm Info").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("f_edit_desc").setLabel("Edit Description").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("f_edit_list").setLabel("Edit Farm List").setStyle(ButtonStyle.Secondary),
          ),
          backRow("panel_back"),
        ],
      }); return;
    }

    case "t_send": {
      const sel = new ChannelSelectMenuBuilder().setCustomId("sel_ticket_ch").setPlaceholder("Select a channel").setChannelTypes(ChannelType.GuildText);
      await i.update({
        embeds: [new EmbedBuilder().setColor(BOT_COLOR).setTitle("Send Ticket Panel").setDescription("Select the channel to send the ticket panel to.").setFooter(FOOTER)],
        components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(sel), backRow("panel_tickets")],
      }); return;
    }

    case "t_edit": {
      const options = REGULAR_CATEGORIES.map((cat) =>
        new StringSelectMenuOptionBuilder().setLabel(cat.label).setValue(cat.id).setDescription("Edit this category's message"),
      );
      const sel = new StringSelectMenuBuilder().setCustomId("sel_edit_cat").setPlaceholder("Choose a category").addOptions(options);
      await i.update({
        embeds: [new EmbedBuilder().setColor(BOT_COLOR).setTitle("Edit Category Messages").setDescription("Select a category to edit its welcome message.").setFooter(FOOTER)],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sel), backRow("panel_tickets")],
      }); return;
    }

    case "t_edit_text": {
      const data = storage.getData();
      const modal = new ModalBuilder().setCustomId("mod_panel_text").setTitle("Edit Ticket Panel Text");
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("panel_title").setLabel("Title").setStyle(TextInputStyle.Short).setValue(data.ticketPanelTitle).setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("panel_desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setValue(data.ticketPanelDesc).setRequired(true),
        ),
      );
      await i.showModal(modal); return;
    }

    case "t_active": {
      if (!guild) return;
      const list = storage.getTicketsByGuild(guild.id);
      const embed = new EmbedBuilder()
        .setColor(BOT_COLOR)
        .setTitle(`Active Tickets — ${list.length} open`)
        .setDescription(
          list.length === 0
            ? "No open tickets."
            : list.slice(0, 20).map((t) => {
                const cat = ALL_CATEGORIES.find((c) => c.id === t.categoryId);
                return `**${ticketTag(t.ticketNumber)}** <#${t.channelId}> — ${cat?.label} — <@${t.userId}> — <t:${Math.floor(new Date(t.createdAt).getTime() / 1000)}:R>`;
              }).join("\n"),
        )
        .setFooter(FOOTER)
        .setTimestamp();
      await i.update({ embeds: [embed], components: [backRow("panel_tickets")] }); return;
    }

    case "f_send_panel": {
      const sel = new ChannelSelectMenuBuilder().setCustomId("sel_farm_panel_ch").setPlaceholder("Select a channel").setChannelTypes(ChannelType.GuildText);
      await i.update({
        embeds: [new EmbedBuilder().setColor(GOLD_COLOR).setTitle("Send Farm Ticket Panel").setDescription("Select the channel to send the farm ticket panel to.").setFooter(FOOTER)],
        components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(sel), backRow("panel_farms")],
      }); return;
    }

    case "f_send_info": {
      const sel = new ChannelSelectMenuBuilder().setCustomId("sel_farm_info_ch").setPlaceholder("Select a channel").setChannelTypes(ChannelType.GuildText);
      await i.update({
        embeds: [new EmbedBuilder().setColor(GOLD_COLOR).setTitle("Send Farm Info").setDescription("Select the channel to send farm information to.").setFooter(FOOTER)],
        components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(sel), backRow("panel_farms")],
      }); return;
    }

    case "f_edit_desc": {
      const modal = new ModalBuilder().setCustomId("mod_farm_desc").setTitle("Edit Farm Description");
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("farm_desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setValue(storage.getData().farmDescription).setRequired(true),
        ),
      );
      await i.showModal(modal); return;
    }

    case "f_edit_list": {
      const modal = new ModalBuilder().setCustomId("mod_farm_list").setTitle("Edit Farm List");
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("farm_list").setLabel("Available Farms").setStyle(TextInputStyle.Paragraph).setValue(storage.getData().farmList).setRequired(true),
        ),
      );
      await i.showModal(modal); return;
    }
  }
}

async function handleStringSelect(i: StringSelectMenuInteraction) {
  const { customId, values, user, guild } = i;

  if (customId === "sel_ticket_topic") {
    await handleTicketCreate(i, values[0]!, false);
    return;
  }

  if (customId === "sel_farm_topic") {
    await handleTicketCreate(i, "buy-farms", true);
    return;
  }

  if (customId === "sel_edit_cat" && isOwner(user.id)) {
    const cat = ALL_CATEGORIES.find((c) => c.id === values[0]!);
    if (!cat) return;
    const current = storage.getCategoryMessage(cat.id) ?? cat.description;
    const modal = new ModalBuilder().setCustomId(`mod_cat_${cat.id}`).setTitle(`Edit: ${cat.label}`);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("cat_message").setLabel("Welcome Message").setStyle(TextInputStyle.Paragraph).setValue(current).setRequired(true),
      ),
    );
    await i.showModal(modal);
    return;
  }
}

async function handleChannelSelect(i: ChannelSelectMenuInteraction) {
  const { customId, values, guild } = i;
  if (!guild || !isOwner(i.user.id)) return;
  const ch = guild.channels.cache.get(values[0]!) as TextChannel | undefined;
  if (!ch) return;

  if (customId === "sel_ticket_ch") {
    await ch.send({ embeds: [ticketPanelEmbed()], components: ticketPanelComponents() });
    await i.update({ embeds: [okEmbed(`Ticket panel sent to <#${ch.id}>`)], components: [backRow("panel_tickets")] });
    return;
  }

  if (customId === "sel_farm_panel_ch") {
    await ch.send({ embeds: [farmTicketPanelEmbed()], components: farmTicketComponents() });
    await i.update({ embeds: [okEmbed(`Farm ticket panel sent to <#${ch.id}>`)], components: [backRow("panel_farms")] });
    return;
  }

  if (customId === "sel_farm_info_ch") {
    await ch.send({ embeds: [farmInfoEmbed()] });
    await i.update({ embeds: [okEmbed(`Farm info sent to <#${ch.id}>`)], components: [backRow("panel_farms")] });
    return;
  }
}

async function handleModal(i: ModalSubmitInteraction) {
  const { customId } = i;
  if (customId === "mod_farm_desc") {
    storage.updateFarmDescription(i.fields.getTextInputValue("farm_desc"));
    await i.reply({ embeds: [okEmbed("Farm description updated.")], flags: 64 }); return;
  }
  if (customId === "mod_farm_list") {
    storage.updateFarmList(i.fields.getTextInputValue("farm_list"));
    await i.reply({ embeds: [okEmbed("Farm list updated.")], flags: 64 }); return;
  }
  if (customId.startsWith("mod_edit_reason_")) {
    const parts = customId.split("_");
    const [, , , guildId, channelId, messageId] = parts;
    const newReason = i.fields.getTextInputValue("new_reason");
    if (!guildId || !channelId || !messageId) {
      await i.reply({ embeds: [errEmbed("Invalid data.")], flags: 64 }); return;
    }
    const guild = i.guild ?? client.guilds.cache.get(guildId);
    if (!guild) { await i.reply({ embeds: [errEmbed("Guild not found.")], flags: 64 }); return; }
    const ch = guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (!ch) { await i.reply({ embeds: [errEmbed("Channel not found.")], flags: 64 }); return; }
    const msg = await ch.messages.fetch(messageId).catch(() => null);
    if (!msg) { await i.reply({ embeds: [errEmbed("Message not found.")], flags: 64 }); return; }
    const oldEmbed = msg.embeds[0];
    if (!oldEmbed) { await i.reply({ embeds: [errEmbed("No embed to edit.")], flags: 64 }); return; }
    const updatedEmbed = EmbedBuilder.from(oldEmbed);
    const fields = updatedEmbed.data.fields ?? [];
    const reasonIdx = fields.findIndex((f) => f.name === "❓ Reason");
    if (reasonIdx >= 0) {
      fields[reasonIdx]!.value = newReason;
      updatedEmbed.setFields(fields);
    }
    await msg.edit({ embeds: [updatedEmbed] }).catch(() => {});
    await i.reply({ embeds: [okEmbed(`Reason updated to: **${newReason}**`)], flags: 64 });
    return;
  }

  if (customId === "mod_panel_text") {
    storage.updatePanelText(i.fields.getTextInputValue("panel_title"), i.fields.getTextInputValue("panel_desc"));
    await i.reply({ embeds: [okEmbed("Panel text updated. Resend the panel to apply.")], flags: 64 }); return;
  }
  if (customId.startsWith("mod_cat_")) {
    storage.setCategoryMessage(customId.slice(8), i.fields.getTextInputValue("cat_message"));
    await i.reply({ embeds: [okEmbed("Category message updated.")], flags: 64 }); return;
  }
}

async function handleTicketCreate(
  i: StringSelectMenuInteraction,
  categoryId: string,
  isFarm: boolean,
) {
  const { user, guild } = i;
  if (!guild) return;

  const cat = ALL_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return;

  await i.deferReply({ flags: 64 });

  const existingId = storage.hasOpenTicket(user.id, categoryId, guild.id);
  if (existingId && guild.channels.cache.get(existingId)) {
    await i.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(WARNING_COLOR)
          .setDescription(`You already have an open **${cat.label}** ticket: <#${existingId}>`)
          .setFooter(FOOTER),
      ],
    });
    return;
  }
  if (existingId) storage.removeTicket(existingId);

  let discordCategory = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === cat.discordCategoryName,
  ) as CategoryChannel | undefined;

  if (!discordCategory) {
    discordCategory = await guild.channels.create({
      name: cat.discordCategoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
    });
  }

  const ticketNum = storage.nextTicketNumber();
  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18) || "user";
  const channelName = `${cat.channelPrefix}-${safeName}`;

  const overwrites: Parameters<Guild["channels"]["create"]>[0]["permissionOverwrites"] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
    },
    {
      id: guild.members.me!.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
    },
  ];

  if (isFarm) {
    overwrites.push({
      id: BUILD_TICKET_ROLE_ID,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
    });
  }

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: discordCategory.id,
    topic: `Ticket ${ticketTag(ticketNum)} | ${cat.label} | ${user.tag}`,
    permissionOverwrites: overwrites,
  });

  const customMsg = storage.getCategoryMessage(categoryId) ?? cat.description;

  const welcomeEmbed = new EmbedBuilder()
    .setColor(cat.color)
    .setTitle(`${cat.label} — ${ticketTag(ticketNum)}`)
    .setDescription(customMsg)
    .addFields(
      { name: "Opened by", value: `<@${user.id}>`, inline: true },
      { name: "Ticket", value: ticketTag(ticketNum), inline: true },
      { name: "Opened", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_claim").setLabel("Claim Ticket").setStyle(ButtonStyle.Secondary),
  );

  const ping = isFarm ? `<@${user.id}> <@&${BUILD_TICKET_ROLE_ID}>` : `<@${user.id}>`;
  await ticketChannel.send({ content: ping, embeds: [welcomeEmbed], components: [controlRow] });

  storage.addTicket(ticketChannel.id, {
    userId: user.id,
    username: user.username,
    categoryId,
    guildId: guild.id,
    channelId: ticketChannel.id,
    createdAt: new Date().toISOString(),
    ticketNumber: ticketNum,
  });

  const logCh = guild.channels.cache.get(TICKET_LOG_CHANNEL_ID) as TextChannel | undefined;
  if (logCh) {
    const joinEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("Join Ticket")
      .setDescription(`${channelName} with ID: ${ticketNum} has been opened. Press the button below to join it.`)
      .addFields(
        { name: "✅ Opened By",     value: `<@${user.id}>`, inline: true },
        { name: "🔵 Panel",         value: cat.label,       inline: true },
        { name: "👤 Staff In Ticket", value: "0",           inline: true },
      )
      .setFooter(FOOTER)
      .setTimestamp();

    const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`join_ticket_${ticketChannel.id}`)
        .setLabel("+ Join Ticket")
        .setStyle(ButtonStyle.Primary),
    );

    await logCh.send({ embeds: [joinEmbed], components: [joinRow] }).catch(() => {});
  }

  await i.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(cat.color)
        .setTitle("Ticket Created")
        .setDescription(`Your **${cat.label}** ticket has been created: <#${ticketChannel.id}>`)
        .addFields({ name: "Ticket Number", value: ticketTag(ticketNum), inline: true })
        .setFooter(FOOTER),
    ],
  });
}

function backRow(target: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(target).setLabel("Back").setStyle(ButtonStyle.Secondary),
  );
}

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle("Owner Control Panel")
    .setDescription("Select a section below.")
    .addFields(
      { name: "Server Monitor", value: "Live server statistics", inline: true },
      { name: "Ticket Panel", value: "Manage the ticket system", inline: true },
      { name: "Farm Panel", value: "Manage farm listings", inline: true },
    )
    .setFooter(FOOTER)
    .setTimestamp();
}

function panelRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("panel_server").setLabel("Server Monitor").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_tickets").setLabel("Ticket Panel").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_farms").setLabel("Farm Panel").setStyle(ButtonStyle.Success),
  );
}

function ticketPanelEmbed() {
  const data = storage.getData();
  const embed = new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle(data.ticketPanelTitle)
    .setFooter(FOOTER)
    .setTimestamp();

  let desc = data.ticketPanelDesc ? data.ticketPanelDesc + "\n\n" : "";
  for (const cat of REGULAR_CATEGORIES) {
    const msg = storage.getCategoryMessage(cat.id) ?? cat.description;
    desc += `**${cat.label}** – ${msg}\n\n`;
  }
  embed.setDescription(desc.trim());
  return embed;
}

function ticketPanelComponents() {
  const options = REGULAR_CATEGORIES.map((cat) =>
    new StringSelectMenuOptionBuilder().setLabel(cat.label).setValue(cat.id).setDescription(cat.description.slice(0, 100)),
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId("sel_ticket_topic")
    .setPlaceholder("Select A Topic")
    .addOptions(options);
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function farmTicketPanelEmbed() {
  const data = storage.getData();
  const desc = storage.getCategoryMessage("buy-farms") ?? FARM_CATEGORY.description;
  return new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setTitle("Buy Farms")
    .setDescription(`**${FARM_CATEGORY.label}** – ${desc}\n\n${data.farmList}`)
    .setFooter(FOOTER)
    .setTimestamp();
}

function farmTicketComponents() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("sel_farm_topic")
    .setPlaceholder("Open a Farm Ticket")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Buy Farms")
        .setValue("buy-farms")
        .setDescription("Open a farm purchase ticket"),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function farmInfoEmbed() {
  const data = storage.getData();
  return new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setTitle("Buy Farms")
    .setDescription(data.farmDescription)
    .addFields({ name: "Available Farms", value: data.farmList.slice(0, 1024) })
    .setFooter(FOOTER)
    .setTimestamp();
}

function closedLogEmbed(ticket: NonNullable<ReturnType<typeof storage.getTicket>>, closedBy: string, reason: string) {
  const cat = ALL_CATEGORIES.find((c) => c.id === ticket!.categoryId);
  return new EmbedBuilder()
    .setColor(ERROR_COLOR)
    .setTitle(`Ticket Closed — ${ticketTag(ticket!.ticketNumber)}`)
    .addFields(
      { name: "Category", value: cat?.label ?? ticket!.categoryId, inline: true },
      { name: "Opened by", value: `<@${ticket!.userId}>`, inline: true },
      { name: "Closed by", value: closedBy, inline: true },
      { name: "Reason", value: reason },
    )
    .setFooter(FOOTER)
    .setTimestamp();
}

function okEmbed(msg: string) {
  return new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(msg).setFooter(FOOTER);
}
function errEmbed(msg: string) {
  return new EmbedBuilder().setColor(ERROR_COLOR).setDescription(msg).setFooter(FOOTER);
}
function infoEmbed(msg: string) {
  return new EmbedBuilder().setColor(BOT_COLOR).setDescription(msg).setFooter(FOOTER);
}
