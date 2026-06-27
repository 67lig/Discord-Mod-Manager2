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
  Colors,
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
  TICKET_CATEGORIES,
  BOT_COLOR,
  SUCCESS_COLOR,
  ERROR_COLOR,
  WARNING_COLOR,
  GOLD_COLOR,
  BUILD_TICKET_ROLE_ID,
  TICKET_LOG_CHANNEL_ID,
} from "./config.js";
import { storage } from "./storage.js";

const TOKEN = process.env["DISCORD_BOT_TOKEN"];
if (!TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");

const EMBED_FOOTER = { text: "Ticket System" };

function ticketTag(n: number) {
  return `#${String(n).padStart(4, "0")}`;
}

export function createBotClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("ready", async () => {
    logger.info({ tag: client.user?.tag }, "Discord bot ready");
    await registerCommands(client);
    for (const guild of client.guilds.cache.values()) {
      await setupAutoMod(guild).catch((e) =>
        logger.warn({ err: e, guild: guild.name }, "AutoMod setup failed"),
      );
    }
  });

  client.on("guildCreate", async (guild) => {
    await setupAutoMod(guild).catch((e) =>
      logger.warn({ err: e, guild: guild.name }, "AutoMod setup on join failed"),
    );
  });

  client.on("interactionCreate", (interaction) => {
    handleInteraction(interaction).catch((e) =>
      logger.error({ err: e }, "Interaction handler error"),
    );
  });

  client.login(TOKEN).catch((e) => {
    logger.error({ err: e }, "Failed to login to Discord");
  });

  return client;
}

async function registerCommands(client: Client) {
  if (!client.user) return;
  const rest = new REST().setToken(TOKEN!);
  const commands = [
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Open the owner control panel")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close this ticket channel")
      .addStringOption((o) =>
        o.setName("reason").setDescription("Reason for closing").setRequired(false),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("rename")
      .setDescription("Rename this ticket channel")
      .addStringOption((o) =>
        o.setName("name").setDescription("New channel name").setRequired(true),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("add")
      .setDescription("Add a user to this ticket")
      .addUserOption((o) => o.setName("user").setDescription("User to add").setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName("remove")
      .setDescription("Remove a user from this ticket")
      .addUserOption((o) => o.setName("user").setDescription("User to remove").setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName("tickets")
      .setDescription("List all active tickets")
      .toJSON(),
  ];

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    for (const guild of client.guilds.cache.values()) {
      await rest
        .put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands })
        .catch(() => {});
    }
    logger.info("Slash commands registered");
  } catch (e) {
    logger.error({ err: e }, "Failed to register commands");
  }
}

async function setupAutoMod(guild: Guild) {
  const existing = await guild.autoModerationRules.fetch();
  const hasKeyword = existing.some((r) => r.name === "Skelly Bot – Keyword Filter");
  const hasMention = existing.some((r) => r.name === "Skelly Bot – Mention Spam");

  if (!hasKeyword) {
    await guild.autoModerationRules
      .create({
        name: "Skelly Bot – Keyword Filter",
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
          {
            type: AutoModerationActionType.BlockMessage,
            metadata: { customMessage: "Your message was blocked by AutoMod." },
          },
        ],
        enabled: true,
        reason: "Skelly Bot AutoMod setup",
      })
      .catch(() => {});
  }

  if (!hasMention) {
    await guild.autoModerationRules
      .create({
        name: "Skelly Bot – Mention Spam",
        eventType: 1,
        triggerType: AutoModerationRuleTriggerType.MentionSpam,
        triggerMetadata: { mentionTotalLimit: 6, mentionRaidProtectionEnabled: true },
        actions: [
          {
            type: AutoModerationActionType.BlockMessage,
            metadata: { customMessage: "Too many mentions — message blocked." },
          },
        ],
        enabled: true,
        reason: "Skelly Bot AutoMod setup",
      })
      .catch(() => {});
  }
}

async function handleInteraction(interaction: Interaction) {
  if (interaction.isChatInputCommand()) return handleCommand(interaction);
  if (interaction.isButton()) return handleButton(interaction);
  if (interaction.isStringSelectMenu()) return handleStringSelect(interaction);
  if (interaction.isChannelSelectMenu()) return handleChannelSelect(interaction);
  if (interaction.isModalSubmit()) return handleModal(interaction);
}

function isOwner(id: string) {
  return id === OWNER_ID;
}

function isStaffMember(member: GuildMember) {
  return (
    isOwner(member.id) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

async function sendLog(guild: Guild, embed: EmbedBuilder) {
  const logChannel = guild.channels.cache.get(TICKET_LOG_CHANNEL_ID) as TextChannel | undefined;
  if (logChannel) {
    await logChannel.send({ embeds: [embed] }).catch(() => {});
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  const { commandName, user, channel, guild } = interaction;

  if (commandName === "panel") {
    if (!isOwner(user.id)) {
      await interaction.reply({ content: "❌ You are not authorized to use this command.", flags: 64 });
      return;
    }
    await interaction.reply({ embeds: [buildMainPanelEmbed()], components: [buildMainPanelRow()], flags: 64 });
    return;
  }

  if (commandName === "tickets") {
    if (!guild) return;
    const member = interaction.member as GuildMember;
    if (!isStaffMember(member)) {
      await interaction.reply({ content: "❌ Staff only.", flags: 64 });
      return;
    }
    const tickets = storage.getTicketsByGuild(guild.id);
    const embed = new EmbedBuilder()
      .setColor(BOT_COLOR)
      .setTitle(`📋 Active Tickets — ${tickets.length} open`)
      .setFooter(EMBED_FOOTER)
      .setTimestamp();
    if (tickets.length === 0) {
      embed.setDescription("No open tickets right now.");
    } else {
      embed.setDescription(
        tickets
          .slice(0, 25)
          .map((t) => {
            const cat = TICKET_CATEGORIES.find((c) => c.id === t.categoryId);
            return `${cat?.emoji ?? "🎫"} **${ticketTag(t.ticketNumber)}** <#${t.channelId}> · ${cat?.label} · <@${t.userId}>`;
          })
          .join("\n"),
      );
    }
    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  if (commandName === "close") {
    if (!channel || !guild) return;
    const ticket = storage.getTicket(channel.id);
    if (!ticket) {
      await interaction.reply({ content: "❌ This is not a ticket channel.", flags: 64 });
      return;
    }
    const member = interaction.member as GuildMember;
    if (!isStaffMember(member) && ticket.userId !== user.id) {
      await interaction.reply({ content: "❌ You do not have permission to close this ticket.", flags: 64 });
      return;
    }
    const reason = interaction.options.getString("reason") ?? "No reason provided";
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(WARNING_COLOR)
          .setTitle("🔒 Closing Ticket")
          .setDescription(`This ticket will be deleted in **5 seconds**.\n**Reason:** ${reason}`)
          .setFooter(EMBED_FOOTER),
      ],
    });
    const cat = TICKET_CATEGORIES.find((c) => c.id === ticket.categoryId);
    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(ERROR_COLOR)
        .setTitle(`🔒 Ticket Closed — ${ticketTag(ticket.ticketNumber)}`)
        .addFields(
          { name: "Category", value: `${cat?.emoji ?? ""} ${cat?.label ?? ticket.categoryId}`, inline: true },
          { name: "Opened by", value: `<@${ticket.userId}>`, inline: true },
          { name: "Closed by", value: `<@${user.id}>`, inline: true },
          { name: "Reason", value: reason, inline: false },
          { name: "Opened", value: `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:R>`, inline: true },
        )
        .setFooter(EMBED_FOOTER)
        .setTimestamp(),
    );
    setTimeout(async () => {
      storage.removeTicket(channel.id);
      await (channel as TextChannel).delete("Ticket closed").catch(() => {});
    }, 5000);
    return;
  }

  if (commandName === "rename") {
    if (!channel || !guild) return;
    const ticket = storage.getTicket(channel.id);
    if (!ticket) {
      await interaction.reply({ content: "❌ This is not a ticket channel.", flags: 64 });
      return;
    }
    const member = interaction.member as GuildMember;
    if (!isStaffMember(member)) {
      await interaction.reply({ content: "❌ Only staff can rename tickets.", flags: 64 });
      return;
    }
    const raw = interaction.options.getString("name", true);
    const newName = raw.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90);
    await (channel as TextChannel).setName(newName);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Renamed to **${newName}**`).setFooter(EMBED_FOOTER)],
    });
    return;
  }

  if (commandName === "add") {
    if (!channel || !guild) return;
    const ticket = storage.getTicket(channel.id);
    if (!ticket) {
      await interaction.reply({ content: "❌ This is not a ticket channel.", flags: 64 });
      return;
    }
    const target = interaction.options.getUser("user", true);
    await (channel as TextChannel).permissionOverwrites.edit(target.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Added <@${target.id}> to this ticket.`).setFooter(EMBED_FOOTER)],
    });
    return;
  }

  if (commandName === "remove") {
    if (!channel || !guild) return;
    const ticket = storage.getTicket(channel.id);
    if (!ticket) {
      await interaction.reply({ content: "❌ This is not a ticket channel.", flags: 64 });
      return;
    }
    const target = interaction.options.getUser("user", true);
    await (channel as TextChannel).permissionOverwrites.delete(target.id);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Removed <@${target.id}> from this ticket.`).setFooter(EMBED_FOOTER)],
    });
    return;
  }
}

async function handleButton(interaction: ButtonInteraction) {
  const { customId, user, guild } = interaction;

  if (customId.startsWith("tc_")) {
    await handleTicketCreate(interaction, customId.slice(3));
    return;
  }

  if (customId === "ticket_close") {
    if (!guild || !interaction.channel) return;
    const ticket = storage.getTicket(interaction.channel.id);
    if (!ticket) {
      await interaction.reply({ content: "❌ This is not a ticket channel.", flags: 64 });
      return;
    }
    const member = interaction.member as GuildMember;
    if (!isStaffMember(member) && ticket.userId !== user.id) {
      await interaction.reply({ content: "❌ You do not have permission to close this ticket.", flags: 64 });
      return;
    }
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(WARNING_COLOR)
          .setTitle("🔒 Closing Ticket")
          .setDescription("This ticket will be deleted in **5 seconds**.")
          .setFooter(EMBED_FOOTER),
      ],
    });
    const cat = TICKET_CATEGORIES.find((c) => c.id === ticket.categoryId);
    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(ERROR_COLOR)
        .setTitle(`🔒 Ticket Closed — ${ticketTag(ticket.ticketNumber)}`)
        .addFields(
          { name: "Category", value: `${cat?.emoji ?? ""} ${cat?.label ?? ticket.categoryId}`, inline: true },
          { name: "Opened by", value: `<@${ticket.userId}>`, inline: true },
          { name: "Closed by", value: `<@${user.id}>`, inline: true },
          { name: "Opened", value: `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:R>`, inline: true },
        )
        .setFooter(EMBED_FOOTER)
        .setTimestamp(),
    );
    setTimeout(async () => {
      storage.removeTicket(interaction.channel!.id);
      await (interaction.channel as TextChannel).delete("Ticket closed").catch(() => {});
    }, 5000);
    return;
  }

  if (!isOwner(user.id) && customId.startsWith("panel_") || !isOwner(user.id) && customId.startsWith("t_") || !isOwner(user.id) && customId.startsWith("f_")) {
    await interaction.reply({ content: "❌ Not authorized.", flags: 64 });
    return;
  }

  if (customId === "panel_server") {
    if (!guild) return;
    const g = await guild.fetch();
    await g.members.fetch().catch(() => {});
    const online = g.members.cache.filter(
      (m) => m.presence?.status !== "offline" && m.presence?.status !== undefined,
    ).size;
    const embed = new EmbedBuilder()
      .setColor(BOT_COLOR)
      .setTitle(`🖥️ Server Monitor — ${g.name}`)
      .setThumbnail(g.iconURL())
      .addFields(
        { name: "👥 Members", value: `${g.memberCount}`, inline: true },
        { name: "🟢 Online", value: `${online || "N/A"}`, inline: true },
        { name: "💬 Channels", value: `${g.channels.cache.size}`, inline: true },
        { name: "🎭 Roles", value: `${g.roles.cache.size}`, inline: true },
        { name: "😀 Emojis", value: `${g.emojis.cache.size}`, inline: true },
        { name: "🚀 Boosts", value: `${g.premiumSubscriptionCount ?? 0} (Level ${g.premiumTier})`, inline: true },
        { name: "🎫 Open Tickets", value: `${storage.getTicketsByGuild(g.id).length}`, inline: true },
        { name: "🏠 Owner", value: `<@${g.ownerId}>`, inline: true },
        { name: "📅 Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
      )
      .setFooter(EMBED_FOOTER)
      .setTimestamp();
    await interaction.update({ embeds: [embed], components: [backRow("panel_back")] });
    return;
  }

  if (customId === "panel_tickets") {
    const embed = new EmbedBuilder()
      .setColor(BOT_COLOR)
      .setTitle("🎫 Ticket Panel")
      .setDescription("Manage the ticket system. Send the panel to a channel, edit category messages, or view active tickets.")
      .setFooter(EMBED_FOOTER);
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("t_send").setLabel("Send Ticket Panel").setEmoji("📤").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("t_edit").setLabel("Edit Messages").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("t_active").setLabel("Active Tickets").setEmoji("📋").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("t_edit_panel_text").setLabel("Edit Panel Text").setEmoji("📝").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger),
    );
    await interaction.update({ embeds: [embed], components: [row1, row2] });
    return;
  }

  if (customId === "panel_farms") {
    const data = storage.getData();
    const embed = new EmbedBuilder()
      .setColor(GOLD_COLOR)
      .setTitle("🌾 Farm Panel")
      .setDescription("Manage farm listings and send farm information to a channel.")
      .addFields(
        { name: "Current Description", value: data.farmDescription.slice(0, 900) },
        { name: "Current Farm List", value: data.farmList.slice(0, 900) },
      )
      .setFooter(EMBED_FOOTER);
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("f_send").setLabel("Send Farm Info").setEmoji("📤").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("f_edit_desc").setLabel("Edit Description").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("f_edit_list").setLabel("Edit Farm List").setEmoji("🌱").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger),
    );
    await interaction.update({ embeds: [embed], components: [row1, row2] });
    return;
  }

  if (customId === "panel_back") {
    await interaction.update({ embeds: [buildMainPanelEmbed()], components: [buildMainPanelRow()] });
    return;
  }

  if (customId === "t_send") {
    const sel = new ChannelSelectMenuBuilder()
      .setCustomId("sel_ticket_ch")
      .setPlaceholder("Select a channel to send the ticket panel")
      .setChannelTypes(ChannelType.GuildText);
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(BOT_COLOR).setTitle("📤 Send Ticket Panel").setDescription("Choose a channel below.").setFooter(EMBED_FOOTER)],
      components: [
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(sel),
        backRow("panel_tickets"),
      ],
    });
    return;
  }

  if (customId === "t_edit") {
    const select = new StringSelectMenuBuilder()
      .setCustomId("sel_edit_cat")
      .setPlaceholder("Choose a category to edit")
      .addOptions(
        TICKET_CATEGORIES.map((cat) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(cat.label)
            .setValue(cat.id)
            .setEmoji(cat.emoji)
            .setDescription("Edit the message for this category"),
        ),
      );
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(BOT_COLOR).setTitle("✏️ Edit Category Messages").setDescription("Select a category to edit its welcome message.").setFooter(EMBED_FOOTER)],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        backRow("panel_tickets"),
      ],
    });
    return;
  }

  if (customId === "t_edit_panel_text") {
    const data = storage.getData();
    const modal = new ModalBuilder().setCustomId("mod_panel_text").setTitle("Edit Ticket Panel Text");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("panel_title").setLabel("Panel Title").setStyle(TextInputStyle.Short).setValue(data.ticketPanelTitle).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("panel_desc").setLabel("Panel Description").setStyle(TextInputStyle.Paragraph).setValue(data.ticketPanelDesc).setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (customId === "t_active") {
    if (!guild) return;
    const tickets = storage.getTicketsByGuild(guild.id);
    const embed = new EmbedBuilder()
      .setColor(BOT_COLOR)
      .setTitle(`📋 Active Tickets — ${tickets.length} open`)
      .setFooter(EMBED_FOOTER)
      .setTimestamp();
    if (tickets.length === 0) {
      embed.setDescription("No open tickets right now.");
    } else {
      embed.setDescription(
        tickets
          .slice(0, 20)
          .map((t) => {
            const cat = TICKET_CATEGORIES.find((c) => c.id === t.categoryId);
            return `${cat?.emoji ?? "🎫"} **${ticketTag(t.ticketNumber)}** <#${t.channelId}> · ${cat?.label} · <@${t.userId}> · <t:${Math.floor(new Date(t.createdAt).getTime() / 1000)}:R>`;
          })
          .join("\n"),
      );
    }
    await interaction.update({ embeds: [embed], components: [backRow("panel_tickets")] });
    return;
  }

  if (customId === "f_edit_desc") {
    const modal = new ModalBuilder().setCustomId("mod_farm_desc").setTitle("Edit Farm Description");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("farm_desc").setLabel("Farm Description").setStyle(TextInputStyle.Paragraph).setValue(storage.getData().farmDescription).setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (customId === "f_edit_list") {
    const modal = new ModalBuilder().setCustomId("mod_farm_list").setTitle("Edit Available Farms");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("farm_list").setLabel("Available Farms").setStyle(TextInputStyle.Paragraph).setValue(storage.getData().farmList).setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (customId === "f_send") {
    const sel = new ChannelSelectMenuBuilder()
      .setCustomId("sel_farm_ch")
      .setPlaceholder("Select a channel to send farm info")
      .setChannelTypes(ChannelType.GuildText);
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(GOLD_COLOR).setTitle("📤 Send Farm Info").setDescription("Choose a channel below.").setFooter(EMBED_FOOTER)],
      components: [
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(sel),
        backRow("panel_farms"),
      ],
    });
    return;
  }
}

async function handleStringSelect(interaction: StringSelectMenuInteraction) {
  const { customId, values, user } = interaction;
  if (customId === "sel_edit_cat") {
    if (!isOwner(user.id)) return;
    const categoryId = values[0]!;
    const cat = TICKET_CATEGORIES.find((c) => c.id === categoryId);
    if (!cat) return;
    const current = storage.getCategoryMessage(categoryId) ?? cat.description;
    const modal = new ModalBuilder().setCustomId(`mod_cat_${categoryId}`).setTitle(`Edit: ${cat.label}`);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("cat_message").setLabel("Category Welcome Message").setStyle(TextInputStyle.Paragraph).setValue(current).setRequired(true),
      ),
    );
    await interaction.showModal(modal);
  }
}

async function handleChannelSelect(interaction: ChannelSelectMenuInteraction) {
  const { customId, values, guild } = interaction;
  if (!guild) return;

  if (customId === "sel_ticket_ch") {
    if (!isOwner(interaction.user.id)) return;
    const ch = guild.channels.cache.get(values[0]!) as TextChannel | undefined;
    if (!ch) return;
    await ch.send({ embeds: [buildTicketPanelEmbed()], components: buildTicketPanelRows() });
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Ticket panel sent to <#${ch.id}>!`).setFooter(EMBED_FOOTER)],
      components: [backRow("panel_tickets")],
    });
    return;
  }

  if (customId === "sel_farm_ch") {
    if (!isOwner(interaction.user.id)) return;
    const ch = guild.channels.cache.get(values[0]!) as TextChannel | undefined;
    if (!ch) return;
    await ch.send({ embeds: [buildFarmEmbed()] });
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Farm info sent to <#${ch.id}>!`).setFooter(EMBED_FOOTER)],
      components: [backRow("panel_farms")],
    });
    return;
  }
}

async function handleModal(interaction: ModalSubmitInteraction) {
  const { customId } = interaction;

  if (customId === "mod_farm_desc") {
    storage.updateFarmDescription(interaction.fields.getTextInputValue("farm_desc"));
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription("✅ Farm description updated!").setFooter(EMBED_FOOTER)], flags: 64 });
    return;
  }
  if (customId === "mod_farm_list") {
    storage.updateFarmList(interaction.fields.getTextInputValue("farm_list"));
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription("✅ Farm list updated!").setFooter(EMBED_FOOTER)], flags: 64 });
    return;
  }
  if (customId === "mod_panel_text") {
    storage.updatePanelText(
      interaction.fields.getTextInputValue("panel_title"),
      interaction.fields.getTextInputValue("panel_desc"),
    );
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription("✅ Panel text updated! Resend the panel to apply.").setFooter(EMBED_FOOTER)], flags: 64 });
    return;
  }
  if (customId.startsWith("mod_cat_")) {
    const categoryId = customId.slice(8);
    storage.setCategoryMessage(categoryId, interaction.fields.getTextInputValue("cat_message"));
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription("✅ Category message updated!").setFooter(EMBED_FOOTER)], flags: 64 });
    return;
  }
}

async function handleTicketCreate(interaction: ButtonInteraction, categoryId: string) {
  const { user, guild } = interaction;
  if (!guild) return;

  const cat = TICKET_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return;

  await interaction.deferReply({ flags: 64 });

  const existingId = storage.hasOpenTicket(user.id, categoryId, guild.id);
  if (existingId) {
    const existing = guild.channels.cache.get(existingId);
    if (existing) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(WARNING_COLOR)
            .setTitle("Ticket Already Open")
            .setDescription(`You already have an open **${cat.label}** ticket: <#${existingId}>`)
            .setFooter(EMBED_FOOTER),
        ],
      });
      return;
    }
    storage.removeTicket(existingId);
  }

  let discordCategory = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === cat.discordCategoryName,
  ) as CategoryChannel | undefined;

  if (!discordCategory) {
    discordCategory = await guild.channels.create({
      name: cat.discordCategoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ],
    });
  }

  const ticketNum = storage.nextTicketNumber();
  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18) || "user";
  const channelName = `${cat.channelPrefix}-${safeName}`;

  const permOverwrites: Parameters<Guild["channels"]["create"]>[0]["permissionOverwrites"] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: guild.members.me!.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (categoryId === "buy-farms") {
    permOverwrites.push({
      id: BUILD_TICKET_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: discordCategory.id,
    topic: `Ticket ${ticketTag(ticketNum)} | ${cat.label} | Opened by ${user.tag}`,
    permissionOverwrites,
  });

  const customMsg = storage.getCategoryMessage(categoryId) ?? cat.description;

  const welcomeEmbed = new EmbedBuilder()
    .setColor(cat.color)
    .setTitle(`${cat.emoji} ${cat.label} — ${ticketTag(ticketNum)}`)
    .setDescription(customMsg)
    .addFields(
      { name: "Opened by", value: `<@${user.id}>`, inline: true },
      { name: "Category", value: `${cat.emoji} ${cat.label}`, inline: true },
      { name: "Ticket", value: ticketTag(ticketNum), inline: true },
      { name: "Created", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
    )
    .setFooter({ text: `Ticket System • ${ticketTag(ticketNum)}` })
    .setTimestamp();

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
  );

  const isFarm = categoryId === "buy-farms";
  const pingContent = isFarm
    ? `<@${user.id}> <@&${BUILD_TICKET_ROLE_ID}>`
    : `<@${user.id}>`;

  await ticketChannel.send({ content: pingContent, embeds: [welcomeEmbed], components: [controlRow] });

  storage.addTicket(ticketChannel.id, {
    userId: user.id,
    username: user.username,
    categoryId,
    guildId: guild.id,
    channelId: ticketChannel.id,
    createdAt: new Date().toISOString(),
    ticketNumber: ticketNum,
  });

  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(cat.color)
      .setTitle(`${cat.emoji} New Ticket — ${ticketTag(ticketNum)}`)
      .addFields(
        { name: "Category", value: `${cat.emoji} ${cat.label}`, inline: true },
        { name: "Opened by", value: `<@${user.id}> (${user.tag})`, inline: true },
        { name: "Channel", value: `<#${ticketChannel.id}>`, inline: true },
      )
      .setFooter(EMBED_FOOTER)
      .setTimestamp(),
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(cat.color)
        .setTitle("Ticket Created")
        .setDescription(`${cat.emoji} Your **${cat.label}** ticket has been created: <#${ticketChannel.id}>`)
        .addFields({ name: "Ticket Number", value: ticketTag(ticketNum), inline: true })
        .setFooter(EMBED_FOOTER),
    ],
  });
}

function backRow(target: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(target).setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Secondary),
  );
}

function buildMainPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle("⚙️ Owner Control Panel")
    .setDescription("Select a section below to manage your server.")
    .addFields(
      { name: "🖥️ Server Monitor", value: "Live server statistics", inline: true },
      { name: "🎫 Ticket Panel", value: "Manage the ticket system", inline: true },
      { name: "🌾 Farm Panel", value: "Manage farm listings", inline: true },
    )
    .setFooter(EMBED_FOOTER)
    .setTimestamp();
}

function buildMainPanelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("panel_server").setLabel("Server Monitor").setEmoji("🖥️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_tickets").setLabel("Ticket Panel").setEmoji("🎫").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_farms").setLabel("Farm Panel").setEmoji("🌾").setStyle(ButtonStyle.Success),
  );
}

function buildTicketPanelEmbed(): EmbedBuilder {
  const data = storage.getData();
  const embed = new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle(data.ticketPanelTitle)
    .setDescription(data.ticketPanelDesc)
    .setFooter(EMBED_FOOTER)
    .setTimestamp();

  for (const cat of TICKET_CATEGORIES) {
    const msg = storage.getCategoryMessage(cat.id) ?? cat.description;
    embed.addFields({ name: `${cat.emoji} ${cat.label}`, value: msg.slice(0, 200) });
  }

  return embed;
}

function buildTicketPanelRows(): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < TICKET_CATEGORIES.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const cat of TICKET_CATEGORIES.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`tc_${cat.id}`)
          .setLabel(cat.label)
          .setEmoji(cat.emoji)
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildFarmEmbed(): EmbedBuilder {
  const data = storage.getData();
  return new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setTitle("🌾 Buy Farms")
    .setDescription(data.farmDescription)
    .addFields({ name: "📋 Available Farms", value: data.farmList.slice(0, 1024) })
    .setFooter(EMBED_FOOTER)
    .setTimestamp();
}
