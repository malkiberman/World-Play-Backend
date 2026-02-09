import giftService from '../services/gift.service.js';
import { syncUserBalances } from '../utils/syncUserBalances.js';

const giftsController = {
  // POST /api/gifts/send
  async send(req, res) {
    try {
      const senderId = req.user.id;
      const { gameId, receiverId, amount } = req.body;

      if (!gameId || !receiverId || amount === undefined) {
        return res.status(400).json({
          error: 'Missing required fields: gameId, receiverId, amount',
        });
      }

      const result = await giftService.sendGift(senderId, {
        gameId,
        receiverId,
        amount,
      });

      const io = req.app.get('io');
      syncUserBalances(io, [senderId, receiverId, result.hostId]);

      return res.status(201).json({
        message: 'Gift sent successfully',
        result,
      });
    } catch (error) {
      console.error('Send Gift Error:', error);
      return res.status(400).json({ error: error.message });
    }
  },
};

export default giftsController;
