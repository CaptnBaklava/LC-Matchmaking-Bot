
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const Database = require('better-sqlite3');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// === DATABASE SETUP ===
const db = new Database('matchmaking.db');

// Drop existing table to ensure clean schema
db.exec('DROP TABLE IF EXISTS players');

// Create table with correct schema
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    user_id TEXT PRIMARY KEY,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    elo INTEGER DEFAULT 500
  );
`);

function calculateEloChange(playerElo, opponentElo, won) {
  const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  const actualScore = won ? 1 : 0;
  const K = 32; // K-factor
  return Math.round(K * (actualScore - expectedScore));
}

// === MATCHMAKING QUEUES ===
const casualQueue = [];
const rankedQueue = [];
const ongoingRankedMatches = new Map(); // user_id -> opponent_id

// === BOT SETUP ===
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName('join').setDescription('Join the casual matchmaking queue.'),
    new SlashCommandBuilder().setName('joinranked').setDescription('Join the ranked matchmaking queue.'),
    new SlashCommandBuilder()
      .setName('report')
      .setDescription('Report the result of a ranked match.')
      .addUserOption(option =>
        option.setName('opponent').setDescription('Your opponent').setRequired(true))
      .addStringOption(option =>
        option.setName('result').setDescription('win or loss').setRequired(true)
          .addChoices({ name: 'win', value: 'win' }, { name: 'loss', value: 'loss' })),
    new SlashCommandBuilder().setName('leaderboard').setDescription('View top ranked players.'),
    new SlashCommandBuilder().setName('resetleaderboard').setDescription('Reset all player stats.')
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });

  setInterval(() => {
    fetch("https://" + process.env.REPL_SLUG + "." + process.env.REPL_OWNER + ".repl.co").then(() => console.log("🔁 Pinged self"));
  }, 10 * 60 * 1000);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  if (interaction.commandName === 'join') {
    if (casualQueue.includes(userId)) {
      return interaction.reply({ content: 'You are already in the casual queue.', ephemeral: true });
    }

    casualQueue.push(userId);
    await interaction.reply('✅ You have joined the casual queue.');

    if (casualQueue.length >= 2) {
      const p1 = casualQueue.shift();
      const p2 = casualQueue.shift();
      await interaction.followUp(`<@${p1}> vs <@${p2}> — Casual Match Found! 🎮`);
    }
  }

  if (interaction.commandName === 'joinranked') {
    if (rankedQueue.includes(userId)) {
      return interaction.reply({ content: 'You are already in the ranked queue.', ephemeral: true });
    }

    rankedQueue.push(userId);
    await interaction.reply('✅ You have joined the ranked queue.');

    if (rankedQueue.length >= 2) {
      const p1 = rankedQueue.shift();
      const p2 = rankedQueue.shift();
      ongoingRankedMatches.set(p1, p2);
      ongoingRankedMatches.set(p2, p1);
      await interaction.followUp(`<@${p1}> vs <@${p2}> — **Ranked Match** Found! 🏆`);
    }
  }

  if (interaction.commandName === 'report') {
    const opponent = interaction.options.getUser('opponent');
    const result = interaction.options.getString('result');

    if (!ongoingRankedMatches.has(userId) || ongoingRankedMatches.get(userId) !== opponent.id) {
      return interaction.reply({ content: '⚠️ No active match with this opponent.', ephemeral: true });
    }

    const isWinner = result === 'win';

    // Get or create players with default ELO
    const getPlayer = db.prepare('INSERT OR IGNORE INTO players (user_id) VALUES (?)');
    getPlayer.run(userId);
    getPlayer.run(opponent.id);

    const players = db.prepare('SELECT user_id, elo FROM players WHERE user_id IN (?, ?)').all(userId, opponent.id);
    const playerElo = players.find(p => p.user_id === userId)?.elo || 500;
    const opponentElo = players.find(p => p.user_id === opponent.id)?.elo || 500;

    const eloChange = calculateEloChange(playerElo, opponentElo, isWinner);

    const updateStats = db.prepare(`
      UPDATE players 
      SET wins = wins + ?, losses = losses + ?, elo = elo + ?
      WHERE user_id = ?
    `);

    if (isWinner) {
      updateStats.run(1, 0, eloChange, userId);
      updateStats.run(0, 1, -eloChange, opponent.id);
    } else {
      updateStats.run(0, 1, eloChange, userId);
      updateStats.run(1, 0, -eloChange, opponent.id);
    }

    ongoingRankedMatches.delete(userId);
    ongoingRankedMatches.delete(opponent.id);

    await interaction.reply(`✅ Result recorded. ${isWinner ? 'Win' : 'Loss'} for <@${userId}>.`);
  }

  if (interaction.commandName === 'leaderboard') {
    const rows = db.prepare(`SELECT * FROM players ORDER BY elo DESC LIMIT 10`).all();

    if (rows.length === 0) {
      return interaction.reply('🏆 No ranked games played yet.');
    }

    const leaderboard = rows.map((row, i) =>
      `${i + 1}. <@${row.user_id}> — ${row.elo} ELO (${row.wins}W / ${row.losses}L)`
    ).join('\n');

    await interaction.reply(`🏆 **Top Ranked Players**:\n${leaderboard}`);
  }

  if (interaction.commandName === 'resetleaderboard') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '⚠️ Only administrators can reset the leaderboard.', ephemeral: true });
    }
    
    db.exec('DELETE FROM players');
    await interaction.reply('🗑️ Leaderboard has been reset.');
  }
});

client.login(TOKEN);

// === EXPRESS SERVER ===
const app = express();
app.get('/', (req, res) => res.send('Bot is alive.'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Express server running on port ${PORT}`));
