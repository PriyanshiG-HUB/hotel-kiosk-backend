import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import { validate } from '../middleware/validation';
import { IdVerificationController } from '../controllers/idVerification.controller';

const router = Router();

// Rate limiting for check-in completion
const checkInLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { message: 'Too many check-in requests. Please wait.', code: 'rate_limit_exceeded' },
});

router.use(checkInLimiter);

// Complete check-in atomically
router.post(
  '/complete',
  [body('bookingId').notEmpty().withMessage('Booking ID is required')],
  validate,
  IdVerificationController.completeCheckIn
);

export default router;
