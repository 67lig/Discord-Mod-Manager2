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
  ChannelSelectMenuBuilder,
} from "discord.js";

import { logger } from "../lib/logger.js";
import { OWNER_ID, TICKET_CATEGORIES, BOT_COLOR, SUCCESS_COLOR, ERROR_COLOR, WARNING_COLOR, GOLD_COLOR } from "./config.js";
import { storage } from "./storage.js";

const TOKEN = process.env["DISCORD_BOT_TOKEN"];
if (!TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");

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
      .addUserOption((o) =>
        o.setName("user").setDescription("User to add").setRequired(true),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("remove")
      .setDescription("Remove a user from this ticket")
      .addUserOption((o) =>
        o.setName("user").setDescription("User to remove").setRequired(true),
      )
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
          keywordFilter: ["*n*gger*", "*f*ggot*", "*k*ke*", "*ch*nk*"],
          regexPatterns: [],
          presets: [AutoModerationRuleKeywordPresetType.Profanity],
        },
        actions: [
          {
            type: AutoModerationActionType.BlockMessage,
            metadata: { customMessage: "Your message was blocked by AutoMod." },
          },
          { type: AutoModerationActionType.SendAlertMessage, metadata: { channel: undefined } },
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

  if (commandName === "close") {
    if (!channel || !guild) return;
    const ticket = storage.getTicket(channel.id);
    if (!ticket) {
      await interaction.reply({ content: "❌ This is not a ticket channel.", flags: 64 });
      return;
    }
    const member = interaction.member as GuildMember;
    const isStaff = member.permissions.has(PermissionFlagsBits.ManageChannels) || isOwner(user.id);
    if (!isStaff && ticket.userId !== user.id) {
      await interaction.reply({ content: "❌ You do not have permission to close this ticket.", flags: 64 });
      return;
    }
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(WARNING_COLOR).setDescription("🔒 Closing ticket in 5 seconds...")] });
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
    const isStaff = member.permissions.has(PermissionFlagsBits.ManageChannels) || isOwner(user.id);
    if (!isStaff) {
      await interaction.reply({ content: "❌ Only staff can rename tickets.", flags: 64 });
      return;
    }
    const newName = interaction.options.getString("name", true).toLowerCase().replace(/[^a-z0-9-]/g, "-");
    await (channel as TextChannel).setName(newName);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Channel renamed to **${newName}**`)] });
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
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Added <@${target.id}> to this ticket.`)] });
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
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Removed <@${target.id}> from this ticket.`)] });
    return;
  }
}

async function handleButton(interaction: ButtonInteraction) {
  const { customId, user, guild } = interaction;

  if (!isOwner(user.id) && customId.startsWith("panel_")) {
    await interaction.reply({ content: "❌ Not authorized.", flags: 64 });
    return;
  }

  if (customId === "panel_server") {
    if (!guild) return;
    const g = await guild.fetch();
    await g.members.fetch().catch(() => {});
    const online = g.members.cache.filter((m) => m.presence?.status !== "offline" && m.presence?.status !== undefined).size;
    const embed = new EmbedBuilder()
      .setColor(BOT_COLOR)
      .setTitle(`🖥️ Server Monitor — ${g.name}`)
      .setThumbnail(g.iconURL())
      .addFields(
        { name: "👥 Members", value: `${g.memberCount}`, inline: true },
        { name: "🟢 Online", value: `${online || "Unavailable"}`, inline: true },
        { name: "💬 Channels", value: `${g.channels.cache.size}`, inline: true },
        { name: "🎭 Roles", value: `${g.roles.cache.size}`, inline: true },
        { name: "😀 Emojis", value: `${g.emojis.cache.size}`, inline: true },
        { name: "🚀 Boosts", value: `${g.premiumSubscriptionCount ?? 0} (Level ${g.premiumTier})`, inline: true },
        { name: "🎫 Open Tickets", value: `${storage.getTicketsByGuild(g.id).length}`, inline: true },
        { name: "🏠 Owner", value: `<@${g.ownerId}>`, inline: true },
        { name: "📅 Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
      )
      .setFooter({ text: "Skelly Bot • Server Monitor" })
      .setTimestamp();
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel_back").setLabel("← Back").setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ embeds: [embed], components: [backRow] });
    return;
  }

  if (customId === "panel_tickets") {
    const embed = new EmbedBuilder()
      .setColor(BOT_COLOR)
      .setTitle("🎫 Ticket Panel")
      .setDescription("Manage the ticket system. Use the buttons below to send the ticket panel, edit category messages, or view active tickets.")
      .setFooter({ text: "Skelly Bot • Ticket Management" });
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("t_send").setLabel("📤 Send Ticket Panel").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("t_edit").setLabel("✏️ Edit Category Messages").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("t_active").setLabel("📋 View Active Tickets").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("t_edit_panel_text").setLabel("📝 Edit Panel Text").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel_back").setLabel("← Back").setStyle(ButtonStyle.Danger),
    );
    await interaction.update({ embeds: [embed], components: [row1, row2] });
    return;
  }

  if (customId === "panel_farms") {
    const data = storage.getData();
    const embed = new EmbedBuilder()
      .setColor(GOLD_COLOR)
      .setTitle("🌾 Farm Panel")
      .setDescription("Manage the farm listings and information.")
      .addFields(
        { name: "Current Description", value: data.farmDescription.slice(0, 1000) },
        { name: "Current Farm List", value: data.farmList.slice(0, 1000) },
      )
      .setFooter({ text: "Skelly Bot • Farm Management" });
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("f_send").setLabel("📤 Send Farm Info").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("f_edit_desc").setLabel("✏️ Edit Description").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("f_edit_list").setLabel("🌱 Edit Farm List").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel_back").setLabel("← Back").setStyle(ButtonStyle.Danger),
    );
    await interaction.update({ embeds: [embed], components: [row1, row2] });
    return;
  }

  if (customId === "panel_back") {
    await interaction.update({ embeds: [buildMainPanelEmbed()], components: [buildMainPanelRow()] });
    return;
  }

  if (customId === "t_send") {
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId("sel_ticket_ch")
      .setPlaceholder("Select a channel to send the ticket panel")
      .setChannelTypes(ChannelType.GuildText);
    const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect);
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel_tickets").setLabel("← Back").setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(BOT_COLOR).setTitle("📤 Send Ticket Panel").setDescription("Select the channel where the ticket panel should be sent.")],
      components: [row, backRow],
    });
    return;
  }

  if (customId === "t_edit") {
    const options = TICKET_CATEGORIES.map((cat) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(cat.label)
        .setValue(cat.id)
        .setEmoji(cat.emoji)
        .setDescription("Edit the message for this category"),
    );
    const select = new StringSelectMenuBuilder()
      .setCustomId("sel_edit_cat")
      .setPlaceholder("Choose a category to edit")
      .addOptions(options);
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel_tickets").setLabel("← Back").setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(BOT_COLOR).setTitle("✏️ Edit Category Messages").setDescription("Select a ticket category to edit its message.")],
      components: [row, backRow],
    });
    return;
  }

  if (customId === "t_edit_panel_text") {
    const data = storage.getData();
    const modal = new ModalBuilder().setCustomId("mod_panel_text").setTitle("Edit Panel Text");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("panel_title")
          .setLabel("Panel Title")
          .setStyle(TextInputStyle.Short)
          .setValue(data.ticketPanelTitle)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("panel_desc")
          .setLabel("Panel Description")
          .setStyle(TextInputStyle.Paragraph)
          .setValue(data.ticketPanelDesc)
          .setRequired(true),
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
      .setTitle(`📋 Active Tickets (${tickets.length})`)
      .setFooter({ text: "Skelly Bot • Active Tickets" })
      .setTimestamp();
    if (tickets.length === 0) {
      embed.setDescription("No open tickets right now.");
    } else {
      const list = tickets
        .slice(0, 20)
        .map((t) => {
          const cat = TICKET_CATEGORIES.find((c) => c.id === t.categoryId);
          return `${cat?.emoji ?? "🎫"} <#${t.channelId}> — ${cat?.label ?? t.categoryId} — <@${t.userId}> — <t:${Math.floor(new Date(t.createdAt).getTime() / 1000)}:R>`;
        })
        .join("\n");
      embed.setDescription(list);
    }
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel_tickets").setLabel("← Back").setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ embeds: [embed], components: [backRow] });
    return;
  }

  if (customId === "f_edit_desc") {
    const data = storage.getData();
    const modal = new ModalBuilder().setCustomId("mod_farm_desc").setTitle("Edit Farm Description");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("farm_desc")
          .setLabel("Farm Description")
          .setStyle(TextInputStyle.Paragraph)
          .setValue(data.farmDescription)
          .setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (customId === "f_edit_list") {
    const data = storage.getData();
    const modal = new ModalBuilder().setCustomId("mod_farm_list").setTitle("Edit Available Farms");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("farm_list")
          .setLabel("Available Farms List")
          .setStyle(TextInputStyle.Paragraph)
          .setValue(data.farmList)
          .setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (customId === "f_send") {
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId("sel_farm_ch")
      .setPlaceholder("Select a channel to send farm info")
      .setChannelTypes(ChannelType.GuildText);
    const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect);
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel_farms").setLabel("← Back").setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(GOLD_COLOR).setTitle("📤 Send Farm Info").setDescription("Select the channel where the farm info should be sent.")],
      components: [row, backRow],
    });
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
    const isStaff =
      member.permissions.has(PermissionFlagsBits.ManageChannels) || isOwner(user.id);
    if (!isStaff && ticket.userId !== user.id) {
      await interaction.reply({ content: "❌ You do not have permission to close this ticket.", flags: 64 });
      return;
    }
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(WARNING_COLOR).setDescription("🔒 Closing ticket in 5 seconds...")],
    });
    setTimeout(async () => {
      storage.removeTicket(interaction.channel!.id);
      await (interaction.channel as TextChannel).delete("Ticket closed").catch(() => {});
    }, 5000);
    return;
  }

  if (customId.startsWith("tc_")) {
    const categoryId = customId.slice(3);
    await handleTicketCreate(interaction, categoryId);
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
        new TextInputBuilder()
          .setCustomId("cat_message")
          .setLabel("Ticket Category Message")
          .setStyle(TextInputStyle.Paragraph)
          .setValue(current)
          .setRequired(true),
      ),
    );
    await interaction.showModal(modal);
    return;
  }
}

async function handleChannelSelect(interaction: ChannelSelectMenuInteraction) {
  const { customId, values, guild } = interaction;
  if (!guild) return;

  if (customId === "sel_ticket_ch") {
    if (!isOwner(interaction.user.id)) return;
    const channelId = values[0];
    if (!channelId) return;
    const target = guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (!target) return;
    await target.send({ embeds: [buildTicketPanelEmbed()], components: buildTicketPanelRows() });
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Ticket panel sent to <#${channelId}>!`)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("panel_tickets").setLabel("← Back").setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }

  if (customId === "sel_farm_ch") {
    if (!isOwner(interaction.user.id)) return;
    const channelId = values[0];
    if (!channelId) return;
    const target = guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (!target) return;
    await target.send({ embeds: [buildFarmEmbed()] });
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Farm info sent to <#${channelId}>!`)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("panel_farms").setLabel("← Back").setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }
}

async function handleModal(interaction: ModalSubmitInteraction) {
  const { customId, guild, user } = interaction;

  if (customId === "mod_farm_desc") {
    const desc = interaction.fields.getTextInputValue("farm_desc");
    storage.updateFarmDescription(desc);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription("✅ Farm description updated!")], flags: 64 });
    return;
  }

  if (customId === "mod_farm_list") {
    const list = interaction.fields.getTextInputValue("farm_list");
    storage.updateFarmList(list);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription("✅ Farm list updated!")], flags: 64 });
    return;
  }

  if (customId === "mod_panel_text") {
    const title = interaction.fields.getTextInputValue("panel_title");
    const desc = interaction.fields.getTextInputValue("panel_desc");
    storage.updatePanelText(title, desc);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription("✅ Panel text updated! Resend the panel to apply changes.")], flags: 64 });
    return;
  }

  if (customId.startsWith("mod_cat_")) {
    const categoryId = customId.slice(8);
    const message = interaction.fields.getTextInputValue("cat_message");
    storage.setCategoryMessage(categoryId, message);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setDescription(`✅ Category message updated!`)], flags: 64 });
    return;
  }
}

async function handleTicketCreate(interaction: ButtonInteraction, categoryId: string) {
  const { user, guild } = interaction;
  if (!guild) return;

  const cat = TICKET_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return;

  await interaction.deferReply({ flags: 64 });

  const existingChannelId = storage.hasOpenTicket(user.id, categoryId, guild.id);
  if (existingChannelId) {
    const existingChannel = guild.channels.cache.get(existingChannelId);
    if (existingChannel) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(WARNING_COLOR)
            .setDescription(`⚠️ You already have an open **${cat.label}** ticket: <#${existingChannelId}>`),
        ],
      });
      return;
    } else {
      storage.removeTicket(existingChannelId);
    }
  }

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

  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "user";
  const channelName = `${cat.channelPrefix}-${safeName}`;

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: discordCategory.id,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
      },
      {
        id: guild.members.me!.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
      },
    ],
  });

  const customMsg = storage.getCategoryMessage(categoryId) ?? cat.description;
  const welcomeEmbed = new EmbedBuilder()
    .setColor(cat.color)
    .setTitle(`${cat.emoji} ${cat.label} Ticket`)
    .setDescription(customMsg)
    .addFields(
      { name: "👤 Opened by", value: `<@${user.id}>`, inline: true },
      { name: "📅 Created", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: "Describe your issue below. Staff will be with you shortly." })
    .setTimestamp();

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("🔒 Close Ticket")
      .setStyle(ButtonStyle.Danger),
  );

  await ticketChannel.send({ content: `<@${user.id}>`, embeds: [welcomeEmbed], components: [closeRow] });

  storage.addTicket(ticketChannel.id, {
    userId: user.id,
    username: user.username,
    categoryId,
    guildId: guild.id,
    channelId: ticketChannel.id,
    createdAt: new Date().toISOString(),
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(cat.color)
        .setDescription(`${cat.emoji} Your **${cat.label}** ticket has been created: <#${ticketChannel.id}>`),
    ],
  });
}

function buildMainPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle("⚙️ Owner Control Panel")
    .setDescription("Welcome to the Skelly Bot control panel. Select a section below to manage your server.")
    .addFields(
      { name: "🖥️ Server Monitor", value: "View live server statistics", inline: true },
      { name: "🎫 Ticket Panel", value: "Manage the ticket system", inline: true },
      { name: "🌾 Farm Panel", value: "Manage farm listings", inline: true },
    )
    .setFooter({ text: `Skelly Bot • Owner Panel` })
    .setTimestamp();
}

function buildMainPanelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("panel_server").setLabel("🖥️ Server Monitor").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("panel_tickets").setLabel("🎫 Ticket Panel").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("panel_farms").setLabel("🌾 Farm Panel").setStyle(ButtonStyle.Success),
  );
}

function buildTicketPanelEmbed(): EmbedBuilder {
  const data = storage.getData();
  const embed = new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle(data.ticketPanelTitle)
    .setDescription(data.ticketPanelDesc)
    .setFooter({ text: "Skelly Bot • Ticket System" })
    .setTimestamp();

  for (const cat of TICKET_CATEGORIES) {
    const msg = storage.getCategoryMessage(cat.id) ?? cat.description;
    embed.addFields({ name: `${cat.emoji} ${cat.label}`, value: msg.slice(0, 200) });
  }

  return embed;
}

function buildTicketPanelRows(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  const row2 = new ActionRowBuilder<ButtonBuilder>();

  TICKET_CATEGORIES.forEach((cat, i) => {
    const btn = new ButtonBuilder()
      .setCustomId(`tc_${cat.id}`)
      .setLabel(cat.label)
      .setEmoji(cat.emoji)
      .setStyle(ButtonStyle.Primary);
    if (i < 3) row1.addComponents(btn);
    else row2.addComponents(btn);
  });

  return [row1, row2];
}

function buildFarmEmbed(): EmbedBuilder {
  const data = storage.getData();
  return new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setTitle("🌾 Buy Farms")
    .setDescription(data.farmDescription)
    .addFields({ name: "📋 Available Farms", value: data.farmList.slice(0, 1024) })
    .setFooter({ text: "Skelly Bot • Farm Information" })
    .setTimestamp();
}
