import prisma from '../config/prisma.js';
import { Prisma } from '@prisma/client';

const GIFT_RECEIVER_RATIO = new Prisma.Decimal('0.35');
const MAX_GIFT_AMOUNT = new Prisma.Decimal('5000');

const giftService = {
  async sendGift(senderId, { gameId, receiverId, amount }) {
    const giftAmount = new Prisma.Decimal(amount);

    if (giftAmount.lte(0)) {
      throw new Error('Gift amount must be greater than 0');
    }

    if (giftAmount.gt(MAX_GIFT_AMOUNT)) {
      throw new Error('Gift amount exceeds the maximum allowed');
    }

    return prisma.$transaction(async (tx) => {
      const [sender, receiver, game] = await Promise.all([
        tx.user.findUnique({ where: { id: senderId } }),
        tx.user.findUnique({ where: { id: receiverId } }),
        tx.game.findUnique({ where: { id: gameId } }),
      ]);

      if (!sender) throw new Error('Sender not found');
      if (!receiver) throw new Error('Receiver not found');
      if (!game) throw new Error('Game not found');

      if (sender.walletBalance.lt(giftAmount)) {
        throw new Error('Insufficient balance');
      }

      const receiverShare = giftAmount
        .mul(GIFT_RECEIVER_RATIO)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
      const hostShare = giftAmount.minus(receiverShare); // Host gets remainder

      const hostId = game.hostId;

      await Promise.all([
        tx.user.update({
          where: { id: senderId },
          data: { walletBalance: { decrement: giftAmount } },
        }),
        tx.user.update({
          where: { id: receiverId },
          data: { walletBalance: { increment: receiverShare } },
        }),
        tx.user.update({
          where: { id: hostId },
          data: { walletBalance: { increment: hostShare } },
        }),
      ]);

      await tx.gameParticipant.upsert({
        where: { gameId_userId: { gameId, userId: receiverId } },
        update: { score: { increment: receiverShare } },
        create: {
          gameId,
          userId: receiverId,
          role: 'PLAYER',
          score: receiverShare,
        },
      });

      const metadata = {
        senderId,
        receiverId,
        gameId,
        originalAmount: giftAmount.toString(),
      };

      const [receiverTransaction, hostTransaction] = await Promise.all([
        tx.transaction.create({
          data: {
            userId: receiverId,
            type: 'GIFT',
            status: 'SUCCESS',
            currency: 'COIN',
            amount: receiverShare,
            gameId,
            metadata,
            description: 'Gift received',
          },
        }),
        tx.transaction.create({
          data: {
            userId: hostId,
            type: 'GIFT',
            status: 'SUCCESS',
            currency: 'COIN',
            amount: hostShare,
            gameId,
            metadata,
            description: 'Host gift share',
          },
        }),
      ]);

      return {
        senderId,
        receiverId,
        hostId,
        giftAmount,
        receiverShare,
        hostShare,
        transactions: [receiverTransaction, hostTransaction],
      };
    });
  },
};

export default giftService;
