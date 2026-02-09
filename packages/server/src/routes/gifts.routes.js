import express from 'express';
import giftsController from '../controller/gifts.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/send', giftsController.send);

export default router;
