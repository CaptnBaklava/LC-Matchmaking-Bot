const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const config = require('../config');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`Ready! Logged in as ${client.user.tag}`);

    try {
      // Get all command data
      const commands = [];
      const commandsPath = path.join(__dirname, '..', 'commands');
      const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

      for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        commands.push(command.data.toJSON());
      }

      console.log(`Registering ${commands.length} application (/) commands.`);

      const rest = new REST({ version: '9' }).setToken(config.token);

      // Register commands globally if no guild ID is provided
      if (!config.guildId) {
        await rest.put(
          Routes.applicationCommands(config.clientId),
          { body: commands },
        );
        console.log('Successfully registered application commands globally');
      } else {
        // Register commands for a specific guild (faster for development)
        await rest.put(
          Routes.applicationGuildCommands(config.clientId, config.guildId),
          { body: commands },
        );
        console.log(`Successfully registered application commands for guild ${config.guildId}`);
      }

      // Set custom status
      client.user.setActivity('🎲 Dice games', { type: 'PLAYING' });
    } catch (error) {
      console.error('Error registering application commands:', error);
    }
  },
};
