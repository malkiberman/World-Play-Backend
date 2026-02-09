import * as gameRules from '../services/validation.service.js';
import permissionsService from './permissions.service.js';
import prisma from '../config/prisma.js';
import { Prisma } from '@prisma/client';

const WINNER_RATIO = new Prisma.Decimal('0.85');

const questionService = {
  /**
   * ?????????? ???????? ???????? ???? ??????????????
   */
  async createQuestion(gameId, userId, { questionText, rewardType, options }) {
    // 1. ???????????? ?????????????? ??????????????
    const game = await gameRules.ensureGameExists(gameId);
    gameRules.validateGameIsActive(game);
    gameRules.validateQuestionData(questionText, options);
    await permissionsService.ensureModerator(gameId, userId);
    // 2. ?????????? ?????????? ???? ???????????????? ?????????????????? ??????

    return await prisma.question.create({
      data: {
        gameId,
        questionText,
        rewardType: rewardType || 'STANDARD',
        isResolved: false,
        options: {
          create: options.map((option) => ({
            text: option.text,
            isCorrect: option.isCorrect || false,
            linkedPlayerId: option.linkedPlayerId || null,
          })),
        },
      },
      include: {
        options: true,
      },
    });
  },
  /**
   * ?????????? ???????????? ???????????? ???????????? ??????????
   */
  async resolveQuestion(questionId, userId, correctOptionId) {
    // ??. ???????? ???????????? ???? ?????????? ?????? ?????????? ?????????? ???????? ?????? ??????????
    const question = await prisma.question.findUnique({
      where: { id: questionId },
    });

    if (!question) throw new Error('Question not found');

    // ??. ?????????? ??????????: ?????? ???????????? ?????? ???????? ?????????? ?????????????? ???????
    await permissionsService.ensureModerator(question.gameId, userId);

    return await prisma.$transaction(async (tx) => {
      let payoutUserIds = [];
      // Ensure option belongs to question
      const option = await tx.questionOption.findUnique({
        where: { id: correctOptionId },
      });

      if (!option || option.questionId !== questionId) {
        throw new Error('Invalid option for this question');
      }

      // ?????????? ???????????? ????????????
      await tx.questionOption.updateMany({
        where: { questionId },
        data: { isCorrect: false },
      });

      // ?????????? ???????????? ????????????
      const correctOption = await tx.questionOption.update({
        where: { id: correctOptionId },
        data: { isCorrect: true },
      });

      // ?????????? ??????????
      await tx.question.update({
        where: { id: questionId },
        data: { isResolved: true },
      });

      // Winner Payout (Who will win)
      if (question.rewardType === 'WINNER_TAKES_ALL') {
        if (!correctOption.linkedPlayerId) {
          throw new Error('Correct option is missing linkedPlayerId');
        }

        const wagersSum = await tx.userAnswer.aggregate({
          where: { questionId },
          _sum: { wager: true },
        });

        const totalWagers = new Prisma.Decimal(wagersSum._sum.wager || 0);

        if (totalWagers.gt(0)) {
          const winnerShare = totalWagers
            .mul(WINNER_RATIO)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
          const hostShare = totalWagers.minus(winnerShare); // Host gets remainder

          const game = await tx.game.findUnique({
            where: { id: question.gameId },
          });

          if (!game) throw new Error('Game not found');

          const winnerId = correctOption.linkedPlayerId;
          const hostId = game.hostId;
          payoutUserIds = [winnerId, hostId];

          await Promise.all([
            tx.user.update({
              where: { id: winnerId },
              data: { walletBalance: { increment: winnerShare } },
            }),
            tx.user.update({
              where: { id: hostId },
              data: { walletBalance: { increment: hostShare } },
            }),
            tx.gameParticipant.upsert({
              where: { gameId_userId: { gameId: question.gameId, userId: winnerId } },
              update: { score: { increment: winnerShare } },
              create: {
                gameId: question.gameId,
                userId: winnerId,
                role: 'PLAYER',
                score: winnerShare,
              },
            }),
            tx.transaction.create({
              data: {
                userId: winnerId,
                type: 'DIRECT_WIN',
                status: 'SUCCESS',
                currency: 'COIN',
                amount: winnerShare,
                gameId: question.gameId,
                metadata: {
                  questionId,
                  correctOptionId,
                  totalWagers: totalWagers.toString(),
                  hostId,
                },
                description: 'Winner payout',
              },
            }),
            tx.transaction.create({
              data: {
                userId: hostId,
                type: 'DIRECT_WIN',
                status: 'SUCCESS',
                currency: 'COIN',
                amount: hostShare,
                gameId: question.gameId,
                metadata: {
                  questionId,
                  correctOptionId,
                  totalWagers: totalWagers.toString(),
                  winnerId,
                },
                description: 'Host payout (winner question)',
              },
            }),
          ]);
        }
      }

      // 2. ?????????? ?????????? ????????????????
      const updatedQuestion = await tx.question.findUnique({
        where: { id: questionId },
        include: { options: true },
      });

      return { question: updatedQuestion, payoutUserIds };
    });
  },
};

export default questionService;
