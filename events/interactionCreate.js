const { ActionRowBuilder } = require('discord.js');
const { createDiceButtons, createRerollAllButton, createRerollUnselectedButton, formatDiceValues, hasTriple } = require('../utils/diceUtils');
const stateManager = require('../utils/stateManager');

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction, client) {
    try {
      // Handle slash commands
      if (interaction.isCommand()) {
        const command = client.commands.get(interaction.commandName);
        
        if (!command) return;
        
        try {
          await command.execute(interaction);
        } catch (error) {
          console.error(`Error executing command ${interaction.commandName}:`, error);
          
          const content = '❌ There was an error while executing this command.';
          if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content, components: [] });
          } else {
            await interaction.reply({ content, ephemeral: true });
          }
        }
      } 
      // Handle button interactions
      else if (interaction.isButton()) {
        const messageId = interaction.message.id;
        const state = stateManager.get(messageId);
        
        // Validate state exists
        if (!state) {
          return await interaction.reply({
            content: '❌ This game has expired or does not exist. Start a new game with `/roll`',
            ephemeral: true  // Keep this one ephemeral (private) to avoid cluttering the chat
          });
        }
        
        // Validate user is the one who started the game
        if (state.userId !== interaction.user.id) {
          return await interaction.reply({
            content: '❌ You cannot interact with someone else\'s dice game.',
            ephemeral: true
          });
        }
        
        // Check if this is the "Reroll All" button
        if (interaction.customId === 'rerollAll') {
          // Check if we've reached the maximum number of rolls
          if (state.rollCount >= state.maxRolls) {
            return await interaction.reply({
              content: `❌ You've already used all ${state.maxRolls} rolls.`,
              ephemeral: true
            });
          }
          
          // Reroll all dice (clear kept dice array)
          state.kept = [];
          state.dice = state.dice.map(() => Math.floor(Math.random() * 6) + 1);
          state.rollCount++;
        } 
        // Check if this is the "Roll Unselected" button
        else if (interaction.customId === 'rerollUnselected') {
          // Check if we've reached the maximum number of rolls
          if (state.rollCount >= state.maxRolls) {
            return await interaction.reply({
              content: `❌ You've already used all ${state.maxRolls} rolls.`,
              ephemeral: true
            });
          }
          
          // Check if we have any kept dice
          if (state.kept.length === 0) {
            return await interaction.reply({
              content: `ℹ️ You need to select at least one die to keep before using Roll Unselected.`,
              ephemeral: true
            });
          }
          
          // Reroll only non-kept dice
          state.dice = state.dice.map((val, i) => 
            state.kept.includes(i) ? val : Math.floor(Math.random() * 6) + 1
          );
          state.rollCount++;
        }
        // Handle individual dice buttons
        else if (interaction.customId.startsWith('die')) {
          // Get clicked die index
          const index = parseInt(interaction.customId.replace('die', ''));
          
          // Toggle keep status for this die
          if (!state.kept.includes(index)) {
            state.kept.push(index);
          } else {
            // Allow un-marking dice that were previously marked
            state.kept = state.kept.filter(i => i !== index);
          }
          
          // No automatic rerolling when clicking dice
          // No roll count increment
        } else {
          // Not a recognized button
          return;
        }
        
        // Create updated buttons
        const buttons = state.dice.map((value, i) => 
          createDiceButtons(value, i, state.kept.includes(i))
        );
        
        // Check if all dice are kept, max rolls reached, or player has a triple
        if (state.kept.length === 3 || state.rollCount > state.maxRolls || hasTriple(state.dice)) {
          // Game over - show final result
          const sum = state.dice.reduce((a, b) => a + b, 0);
          
          // Check if player has a triple
          const tripleMessage = hasTriple(state.dice) 
            ? `\n🔥 **TRIPLE ${state.dice[0]}s!** 🔥 Impressive!` 
            : '';
            
          await interaction.update({
            content: `🎲 **${interaction.user.username}'s Final Result**: ${formatDiceValues(state.dice)}\n` +
                     `Total: **${sum}** (${state.rollCount}/${state.maxRolls} rolls)` +
                     tripleMessage,
            components: []
          });
          
          // Clean up state
          stateManager.remove(messageId);
        } else {
          // Game continues - update UI
          // Create buttons for reroll actions
          const rerollAllButton = createRerollAllButton();
          const rerollUnselectedButton = createRerollUnselectedButton();
          
          // Add both buttons to a row
          const actionButtons = new ActionRowBuilder().addComponents([
            rerollAllButton,
            rerollUnselectedButton
          ]);
          
          // Check if player rolled a triple (to notify them even if the game continues)
          const tripleNotice = hasTriple(state.dice) 
            ? `\n🔥 **You rolled TRIPLE ${state.dice[0]}s!** The game will end after this roll.` 
            : '';
          
          await interaction.update({
            content: `🎲 **${interaction.user.username}'s Roll ${state.rollCount}/${state.maxRolls}**\n` +
                     `Current dice: ${formatDiceValues(state.dice)}\n` +
                     `Kept: ${state.kept.length}/3 - Click dice to select/unselect them, then use the buttons below to roll:` +
                     tripleNotice,
            components: [
              new ActionRowBuilder().addComponents(buttons),
              actionButtons
            ]
          });
          
          // Update state
          stateManager.set(messageId, state);
        }
      }
    } catch (error) {
      console.error('Error handling interaction:', error);
      
      try {
        // Attempt to notify the user of the error
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ There was an error processing your interaction.',
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error('Could not send error message to user:', replyError);
      }
    }
  },
};
