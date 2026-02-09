export const syncUserBalances = (io, userIds = []) => {
  if (!io) return;

  if (typeof io.syncUserBalances === 'function') {
    io.syncUserBalances(userIds);
    return;
  }

  // Fallback: emit a generic event until a dedicated syncUserBalances is wired.
  if (typeof io.emit === 'function') {
    io.emit('sync_user_balances', { userIds });
  }
};
