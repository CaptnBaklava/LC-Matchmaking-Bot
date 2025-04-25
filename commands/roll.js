const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder } = require('discord.js');
const { createDiceButtons, createRerollAllButton, createRerollUnselectedButton } = require('../utils/diceUtils');
const stateManager = require('../utils/stateManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll 3 dice and keep/reroll them'),
    
  async execute(interaction) {
    try {
      // Roll 3 initial dice
      const diceCount = 3;
      const dice = Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
      
      // Create buttons for each die
      const buttons = dice.map((value, index) => createDiceButtons(value, index));
      
      // Create action buttons for the second row
      const rerollAllButton = createRerollAllButton();
      const rerollUnselectedButton = createRerollUnselectedButton();
      
      // Create action row with both buttons
      const actionButtons = new ActionRowBuilder().addComponents([
        rerollAllButton,
        rerollUnselectedButton
      ]);
      
      // Reply with the initial roll - visible to everyone
      const message = await interaction.reply({
        content: `🎲 **${interaction.user.username} rolled 3 dice!**\nClick dice to select/unselect them, then use the buttons below to roll:`,
        components: [
          new ActionRowBuilder().addComponents(buttons),
          actionButtons
        ],
        ephemeral: false,  // Make sure it's not ephemeral (visible to everyone)
        fetchReply: true
      });
      
      // Store the initial game state
      stateManager.set(message.id, {
        dice,
        kept: [],
        userId: interaction.user.id,
        rollCount: 1,
        maxRolls: 3
      });
      
      return true;
    } catch (error) {
      console.error('Error executing roll command:', error);
      
      // If we already replied, edit the reply with the error
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: '❌ There was an error while executing this command.',
          components: []
        }).catch(console.error);
      } else {
        await interaction.reply({
          content: '❌ There was an error while executing this command.',
          ephemeral: true
        }).catch(console.error);
      }
      
      return false;
    }
  }
};
