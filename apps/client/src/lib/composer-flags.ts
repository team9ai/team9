// Toggle for the model-control picker in message composers.
//   - Dashboard ("What can I help you with today?"): changes the bot's
//     agent default (applies to all future conversations with that bot).
//   - In-channel DM composer: changes the session-level model via
//     `useChannelModel` (applies to this conversation only).
// Keep these two pickers independent — they control the two dimensions
// (agent default vs session override) of the three-tier resolver on
// agent-pi.
export const SHOW_COMPOSER_MODEL_CONTROL = true;
